/**
 * MCP Apps views in the assistant chat (SEP-1865, extension io.modelcontextprotocol/ui).
 *
 * A connected MCP server can attach a view to a tool: `_meta.ui.resourceUri = 'ui://…'`, an HTML
 * resource the host renders next to the tool's result (alldone.team does this for Judy). When an
 * assistant run calls such a tool, the run records a view under the assistant comment
 * (`mcpAppViews/{viewId}`, server-written, readable only by the person the run acted for), and
 * the chat renders it in a sandboxed frame (components/ChatsView/ChatDV/EditorView/McpAppView.js).
 *
 * The frame never gets a token. Everything it needs from its server goes through
 * `mcpAppSecondGen` with the view id, which re-derives every fact from the stored view: the
 * person must be the one the view was recorded for and still a member of the project, the server
 * must still be enabled on that assistant, the resource must be the view's own, and a tool must be
 * one the server allows the app to call (`visibility` includes "app"). The call then runs with the
 * same secret the assistant run used for that person (resolveMcpSecret), so a view can do no more
 * than the person's own assistant could.
 *
 * A view outlives the connection it was opened with (AT-2952): a member can remove the server from
 * the assistant, or remove and add it again, which gives it a new id. The view therefore keeps the
 * non-secret address of its server (`serverUrl`, `serverTransport`, `serverAuthType`). Opening it
 * finds the server by id, then by that address on the SAME assistant, so a re-added server serves
 * its old views again. When the assistant no longer has it at all, the request fails with
 * `details.reason: 'server_disconnected'` and the browser offers one click to connect it again
 * (`action: 'reconnect'`). That click is an ordinary connect by somebody allowed to edit the
 * assistant (connectAssistantMcpServer) and is offered only for servers that need no stored secret
 * (`none`, `alldone_app`); nothing is ever reconnected without that click, because removing a
 * server is a deliberate choice.
 */

const crypto = require('crypto')
const { serverAllowsMcpTool } = require('../Assistant/mcpAppGroups')

const VIEWS_COLLECTION = 'mcpAppViews'
const UI_SCHEME = 'ui://'
// What is kept of the tool result for the view's first paint. A larger result is dropped: the view
// then loads its data through its own app tools, which every alldone.team view does anyway.
const MAX_STORED_RESULT_BYTES = 200 * 1024
const MAX_STORED_ARGUMENTS_BYTES = 20 * 1024
const MAX_RESOURCE_BYTES = 5 * 1024 * 1024
// Servers a click can connect again without asking for credentials: alldone_app mints a token for
// the person per call, and `none` has nothing to store. A bearer or OAuth server needs its secret.
const RECONNECTABLE_AUTH_TYPES = new Set(['none', 'alldone_app'])
const GLOBAL_PROJECT_ID = 'globalProject'

/** The view a tool declares, from its `_meta` (current and legacy MCP Apps keys). */
function readToolUi(tool) {
    const meta = tool && typeof tool._meta === 'object' && tool._meta ? tool._meta : {}
    const ui = meta.ui && typeof meta.ui === 'object' ? meta.ui : {}
    const rawUri = typeof ui.resourceUri === 'string' ? ui.resourceUri : meta['ui/resourceUri']
    const resourceUri = typeof rawUri === 'string' && rawUri.startsWith(UI_SCHEME) ? rawUri.slice(0, 500) : null
    const visibility = Array.isArray(ui.visibility)
        ? ui.visibility.filter(value => value === 'model' || value === 'app')
        : null
    return { resourceUri, visibility: visibility && visibility.length ? visibility : null }
}

/** Visibility defaults to both: a tool without it is offered to the model and callable by the view. */
const isVisibleTo = (visibility, audience) => !Array.isArray(visibility) || visibility.includes(audience)

const jsonSize = value => {
    try {
        return Buffer.byteLength(JSON.stringify(value ?? null))
    } catch (_) {
        return Infinity
    }
}

const viewIdFor = ({ assistantCommentId, serverId, remoteToolName, toolCallId }) =>
    crypto
        .createHash('sha256')
        .update([assistantCommentId, serverId, remoteToolName, toolCallId || crypto.randomUUID()].join('|'))
        .digest('hex')
        .slice(0, 32)

/**
 * Records the view of a tool the assistant just ran. Best effort: a view that cannot be recorded
 * leaves the answer exactly as it was. Returns the view id, or null.
 */
async function recordMcpAppView({
    db,
    target,
    toolArgs,
    result,
    toolRuntimeContext,
    projectId,
    assistantId,
    requestUserId,
}) {
    if (!target?.uiResourceUri || !requestUserId || !projectId || !assistantId) return null
    const assistantCommentId = toolRuntimeContext?.assistantCommentId || null
    if (!assistantCommentId) return null
    const toolResult = {
        content: Array.isArray(result?.content) ? result.content : [],
        structuredContent: result?.structuredContent || null,
        isError: result?.isError === true,
    }
    const viewId = viewIdFor({
        assistantCommentId,
        serverId: target.serverId,
        remoteToolName: target.remoteToolName,
        toolCallId: toolRuntimeContext?.currentToolCallId,
    })
    await db
        .collection(VIEWS_COLLECTION)
        .doc(viewId)
        .set({
            viewId,
            userId: requestUserId,
            projectId,
            assistantId,
            objectType: toolRuntimeContext?.objectType || null,
            objectId: toolRuntimeContext?.objectId || null,
            assistantCommentId,
            serverId: target.serverId,
            serverLabel: target.serverLabel || target.serverId,
            // The server's non-secret address, so the view can find it again after it was removed and
            // added back under a new id, and so it can be connected again with one click (AT-2952).
            ...serverAddressFields(target.serverConfig),
            // The app's own name (alldone.team's `_meta` app, e.g. "Judy Job"), for the pane's label.
            appName: target.appName || null,
            toolName: target.remoteToolName,
            resourceUri: target.uiResourceUri,
            toolArguments: jsonSize(toolArgs) <= MAX_STORED_ARGUMENTS_BYTES ? toolArgs || {} : {},
            toolResult: jsonSize(toolResult) <= MAX_STORED_RESULT_BYTES ? toolResult : null,
            createdAt: Date.now(),
        })
    return viewId
}

class McpAppError extends Error {
    constructor(code, message, details) {
        super(message)
        this.code = code
        if (details !== undefined) this.details = details
    }
}

const normalizeServerUrl = value => {
    if (typeof value !== 'string' || !value) return ''
    try {
        return new URL(value).toString()
    } catch (_) {
        return ''
    }
}
const normalizeLabel = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')
const authTypeOf = server => String(server?.authType || 'none').toLowerCase()

/** The non-secret fields that say where a view's server is. Never a token. */
function serverAddressFields(serverConfig) {
    const url = normalizeServerUrl(serverConfig?.url)
    if (!url) return {}
    return {
        serverUrl: url,
        serverTransport: serverConfig.transport || 'http',
        serverAuthType: authTypeOf(serverConfig),
    }
}

/** The assistant's servers a view may use: configured, enabled, with an address. */
const enabledServers = assistant =>
    (Array.isArray(assistant?.mcpServers) ? assistant.mcpServers : []).filter(
        server => server && typeof server === 'object' && server.enabled !== false && server.url
    )

/**
 * The server a view runs on, among the servers currently enabled on its own assistant: the one it
 * was recorded with, else one at the same address with the same sign-in (the same server removed
 * and added again), else, for a view recorded before the address was kept, the only one with the
 * same label. Only ever a server of that assistant, so a view can do no more than the assistant.
 */
function findViewServer(servers, view) {
    const byId = servers.find(server => server.id === view.serverId)
    if (byId) return byId
    const url = normalizeServerUrl(view.serverUrl)
    if (url) {
        const authType = view.serverAuthType ? String(view.serverAuthType).toLowerCase() : null
        return (
            servers.find(
                server => normalizeServerUrl(server.url) === url && (!authType || authTypeOf(server) === authType)
            ) || null
        )
    }
    const label = normalizeLabel(view.serverLabel)
    if (!label) return null
    const sameLabel = servers.filter(server => normalizeLabel(server.label) === label)
    return sameLabel.length === 1 ? sameLabel[0] : null
}

/** Why a view's server cannot be connected again with one click, or null when it can. */
function reconnectBlocker(view) {
    if (view.projectId === GLOBAL_PROJECT_ID) return 'not_allowed'
    if (!normalizeServerUrl(view.serverUrl)) return 'unknown_server'
    if (!RECONNECTABLE_AUTH_TYPES.has(String(view.serverAuthType || 'none').toLowerCase())) {
        return 'needs_credentials'
    }
    return null
}

function disconnectedError(view, assistant) {
    const blocker = reconnectBlocker(view)
    return new McpAppError('failed-precondition', 'This app is no longer connected to the assistant.', {
        reason: 'server_disconnected',
        appName: view.appName || null,
        serverLabel: view.serverLabel || null,
        assistantName: (assistant && typeof assistant.displayName === 'string' && assistant.displayName) || null,
        canReconnect: !blocker,
        reconnectBlocker: blocker,
    })
}

/**
 * The browser's requests for one view: `resource` (its HTML) or `callTool` (a server tool the view
 * may call). `deps` holds the I/O, so the access rules are testable on their own.
 */
async function handleMcpAppRequest({ uid, data }, deps) {
    if (!uid) throw new McpAppError('unauthenticated', 'Sign in first.')
    const viewId = typeof data?.viewId === 'string' ? data.viewId : ''
    if (!/^[a-f0-9]{32}$/.test(viewId)) throw new McpAppError('invalid-argument', 'Unknown view.')
    const view = await deps.getView(viewId)
    // A view of somebody else answers exactly like a missing one.
    if (!view || view.userId !== uid) throw new McpAppError('not-found', 'Unknown view.')
    if (!(await deps.isProjectMember(view.projectId, uid))) throw new McpAppError('permission-denied', 'No access.')
    const assistant = await deps.getAssistant(view.projectId, view.assistantId)
    const server = findViewServer(enabledServers(assistant), view)

    if (data.action === 'reconnect') return reconnectViewServer({ uid, view, assistant, server }, deps)

    if (!server) throw disconnectedError(view, assistant)
    // A view recorded before it kept its server's address learns it now, so it can find the server
    // again (or offer to reconnect it) if the server is removed later. Best effort.
    if (!normalizeServerUrl(view.serverUrl) && deps.updateView) {
        const address = serverAddressFields(server)
        if (address.serverUrl) {
            await Promise.resolve(deps.updateView(viewId, address)).catch(error =>
                console.warn('🔌 MCP: view address not stored', { viewId, error: error?.message })
            )
        }
    }
    const secret = await deps.resolveMcpSecret({
        authType: server.authType,
        projectId: view.projectId,
        assistantId: view.assistantId,
        serverId: server.id,
        requestUserId: uid,
        serverUrl: server.url,
    })

    if (data.action === 'resource') {
        const read = await deps.readResource(server, secret, view.resourceUri)
        const content = (read?.contents || []).find(item => item?.uri === view.resourceUri) || read?.contents?.[0]
        const html = typeof content?.text === 'string' ? content.text : ''
        if (!html || Buffer.byteLength(html) > MAX_RESOURCE_BYTES) {
            throw new McpAppError('failed-precondition', 'The app view could not be loaded.')
        }
        const ui = content?._meta?.ui || {}
        return {
            html,
            csp: ui.csp && typeof ui.csp === 'object' ? ui.csp : null,
            prefersBorder: ui.prefersBorder === true,
            toolName: view.toolName,
            toolArguments: view.toolArguments || {},
            toolResult: view.toolResult || null,
            serverLabel: view.serverLabel,
        }
    }

    if (data.action === 'callTool') {
        const name = typeof data.name === 'string' ? data.name : ''
        const tools = await deps.listTools(server, secret)
        const tool = tools.find(item => item?.name === name)
        // A view reaches only the tools its assistant may use: Connor's Story view never calls Judy.
        if (!tool || !serverAllowsMcpTool(server, tool) || !isVisibleTo(readToolUi(tool).visibility, 'app')) {
            throw new McpAppError('permission-denied', `The app may not call ${name || 'that tool'}.`)
        }
        const args =
            data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments) ? data.arguments : {}
        return deps.callTool(server, secret, name, args)
    }

    throw new McpAppError('invalid-argument', 'Unknown action.')
}

/**
 * The view's "connect again" button. Idempotent: a server that is already back answers
 * `alreadyConnected` and changes nothing. Otherwise it is an ordinary connect, with the view's own
 * stored address and its original id (so every older view of that server finds it again), run by
 * connectAssistantMcpServer, which checks that the person may edit the assistant and validates the
 * server by listing its tools as that person.
 */
async function reconnectViewServer({ uid, view, assistant, server }, deps) {
    if (server) return { reconnected: false, alreadyConnected: true }
    if (!assistant) throw new McpAppError('not-found', 'The assistant no longer exists.')
    const error = disconnectedError(view, assistant)
    if (!error.details.canReconnect) throw error
    await deps.connectServer({
        userId: uid,
        projectId: view.projectId,
        assistantId: view.assistantId,
        server: {
            id: view.serverId,
            label: view.serverLabel || view.appName || 'MCP server',
            url: normalizeServerUrl(view.serverUrl),
            transport: view.serverTransport || 'http',
            authType: String(view.serverAuthType || 'none').toLowerCase(),
        },
    })
    return { reconnected: true, alreadyConnected: false }
}

/** The production I/O for handleMcpAppRequest. */
function createMcpAppDeps(admin) {
    const db = admin.firestore()
    const mcpClient = require('../Assistant/mcpClient')
    const { resolveMcpSecret, connectAssistantMcpServer } = require('./mcpAssistantConnect')
    return {
        getView: async viewId => {
            const snap = await db.collection(VIEWS_COLLECTION).doc(viewId).get()
            return snap.exists ? snap.data() : null
        },
        isProjectMember: async (projectId, uid) => {
            const snap = await db.doc(`projects/${projectId}`).get()
            const userIds = snap.exists ? snap.data()?.userIds : null
            return Array.isArray(userIds) && userIds.includes(uid)
        },
        // The assistant whose servers the view may use; its server list is the one an assistant run
        // uses (getAssistantMcpServers in assistantHelper), filtered by enabledServers above.
        getAssistant: async (projectId, assistantId) => {
            if (!projectId || !assistantId) return null
            const snap = await db.doc(`assistants/${projectId}/items/${assistantId}`).get()
            return snap.exists ? snap.data() || {} : null
        },
        updateView: (viewId, fields) => db.collection(VIEWS_COLLECTION).doc(viewId).update(fields),
        // No secret: only servers that need none are offered a reconnect (RECONNECTABLE_AUTH_TYPES).
        connectServer: ({ userId, projectId, assistantId, server }) =>
            connectAssistantMcpServer({ userId, projectId, assistantId, server, secret: null }),
        resolveMcpSecret,
        readResource: (server, secret, uri) => mcpClient.readResource(server, secret, uri),
        listTools: (server, secret) => mcpClient.listTools(server, secret),
        callTool: (server, secret, name, args) => mcpClient.callTool(server, secret, name, args),
    }
}

module.exports = {
    createMcpAppDeps,
    VIEWS_COLLECTION,
    MAX_STORED_RESULT_BYTES,
    McpAppError,
    readToolUi,
    isVisibleTo,
    findViewServer,
    reconnectBlocker,
    recordMcpAppView,
    handleMcpAppRequest,
}
