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
 */

const crypto = require('crypto')

const VIEWS_COLLECTION = 'mcpAppViews'
const UI_SCHEME = 'ui://'
// What is kept of the tool result for the view's first paint. A larger result is dropped: the view
// then loads its data through its own app tools, which every alldone.team view does anyway.
const MAX_STORED_RESULT_BYTES = 200 * 1024
const MAX_STORED_ARGUMENTS_BYTES = 20 * 1024
const MAX_RESOURCE_BYTES = 5 * 1024 * 1024

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
            toolName: target.remoteToolName,
            resourceUri: target.uiResourceUri,
            toolArguments: jsonSize(toolArgs) <= MAX_STORED_ARGUMENTS_BYTES ? toolArgs || {} : {},
            toolResult: jsonSize(toolResult) <= MAX_STORED_RESULT_BYTES ? toolResult : null,
            createdAt: Date.now(),
        })
    return viewId
}

class McpAppError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
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
    const servers = await deps.getAssistantMcpServers(view.projectId, view.assistantId)
    const server = servers.find(item => item.id === view.serverId)
    if (!server) throw new McpAppError('failed-precondition', 'This app is no longer connected to the assistant.')
    const secret = await deps.resolveMcpSecret({
        authType: server.authType,
        projectId: view.projectId,
        assistantId: view.assistantId,
        serverId: server.id,
        requestUserId: uid,
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
        if (!tool || !isVisibleTo(readToolUi(tool).visibility, 'app')) {
            throw new McpAppError('permission-denied', `The app may not call ${name || 'that tool'}.`)
        }
        const args =
            data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments) ? data.arguments : {}
        return deps.callTool(server, secret, name, args)
    }

    throw new McpAppError('invalid-argument', 'Unknown action.')
}

/** The production I/O for handleMcpAppRequest. */
function createMcpAppDeps(admin) {
    const db = admin.firestore()
    const mcpClient = require('../Assistant/mcpClient')
    const { resolveMcpSecret } = require('./mcpAssistantConnect')
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
        // The same server list an assistant run uses (getAssistantMcpServers in assistantHelper).
        getAssistantMcpServers: async (projectId, assistantId) => {
            const snap = await db.doc(`assistants/${projectId}/items/${assistantId}`).get()
            const servers = snap.exists ? snap.data()?.mcpServers : null
            if (!Array.isArray(servers)) return []
            return servers.filter(
                server => server && typeof server === 'object' && server.enabled !== false && server.url
            )
        },
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
    recordMcpAppView,
    handleMcpAppRequest,
}
