/**
 * MCP tools grouped by the app they belong to.
 *
 * One MCP server can carry several apps: alldone.team/mcp serves Story Builder, Judy and Property
 * Screener over one connection, 133 tools and ~40k tokens of schemas in all. Sending them all in every
 * request is not affordable, and the old answer (keep the first 60 tools of all servers) silently hid
 * whole apps. So the tools are grouped by app and only what a run needs is loaded:
 *
 *  - With hosted tool search, every app is its own namespace with the app's own description, and the
 *    model searches only the app it needs.
 *  - Without tool search (OpenRouter models, unattended runs), a server whose tools fit
 *    `MCP_DIRECT_TOOL_LIMIT` is still sent whole. Above that, the model gets `open_mcp_app`, which lists
 *    the apps; opening one adds that app's tools from the next step of the same run on.
 *
 * A server names a tool's app in `_meta['team.alldone/app'] = { id, name, summary }` (alldone.team does).
 * A tool without it belongs to its server's app, so any other MCP server is one group of its own.
 */

const MCP_APP_META_KEY = 'team.alldone/app'
const OPEN_MCP_APP_TOOL_NAME = 'open_mcp_app'
// Without tool search, a server with at most this many tools is sent whole, as before.
const MCP_DIRECT_TOOL_LIMIT = 30
// Upper bound on tools taken from all MCP servers of one assistant, against runaway servers.
const MAX_MCP_TOOLS = 400

const clean = (value, max) =>
    String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)

const slug = value =>
    String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')

/** The app a remote tool names in its `_meta`, or null. Server-supplied, so it is trimmed and bounded. */
function readMcpToolApp(tool) {
    const raw = tool && tool._meta && tool._meta[MCP_APP_META_KEY]
    if (!raw || typeof raw !== 'object') return null
    const id = slug(raw.id).slice(0, 40)
    if (!id) return null
    return { id, name: clean(raw.name, 60) || id, summary: clean(raw.summary, 240) }
}

/** The group a tool belongs to: its app on that server, or the server itself. */
function getMcpAppKey(serverId, app) {
    return app ? `${serverId}:${app.id}` : String(serverId)
}

/**
 * The apps behind a list of MCP targets (from getReachableMcpTools), in first-seen order, each with a
 * namespace name that is unique, stable and safe for the Responses API.
 */
function describeMcpApps(targets) {
    const apps = new Map()
    for (const target of targets || []) {
        const key = target.appKey || String(target.serverId)
        if (!apps.has(key)) {
            apps.set(key, {
                key,
                name: target.appName || target.serverLabel || target.serverId,
                summary: target.appSummary || '',
                serverLabel: target.serverLabel || target.serverId,
                toolNames: [],
            })
        }
        apps.get(key).toolNames.push(target.toolName)
    }
    const usedNames = new Set()
    return [...apps.values()].map(app => {
        const base = `mcp_${slug(app.name).slice(0, 30) || 'app'}`
        let namespace = base
        for (let index = 2; usedNames.has(namespace); index++) namespace = `${base}_${index}`
        usedNames.add(namespace)
        return { ...app, namespace }
    })
}

const describeApp = app => {
    const where =
        app.name === app.serverLabel
            ? `MCP server "${app.serverLabel}"`
            : `${app.name} on MCP server "${app.serverLabel}"`
    return app.summary ? `${where}: ${app.summary}` : `${where}.`
}

/** Tool name → { namespace, description } for hosted tool search. */
function buildMcpNamespaceIndex(apps) {
    const index = new Map()
    for (const app of apps || []) {
        for (const toolName of app.toolNames) {
            index.set(toolName, { namespace: app.namespace, description: describeApp(app) })
        }
    }
    return index
}

function buildOpenMcpAppToolSchema(apps, openedKeys = []) {
    const opened = new Set(openedKeys)
    const lines = apps.map(
        app => `- ${app.key}: ${describeApp(app)} (${app.toolNames.length} tools${opened.has(app.key) ? ', open' : ''})`
    )
    return {
        type: 'function',
        function: {
            name: OPEN_MCP_APP_TOOL_NAME,
            description:
                'Open an app of a connected MCP server so its tools become available from your next step on. ' +
                'Open only the app the request needs; an app stays open for the rest of this run.\n' +
                lines.join('\n'),
            parameters: {
                type: 'object',
                properties: {
                    app: { type: 'string', enum: apps.map(app => app.key), description: 'The app to open.' },
                },
                required: ['app'],
                additionalProperties: false,
            },
        },
    }
}

/**
 * The MCP tool schemas for one model request.
 * @returns {{ schemas: object[], namespaceIndex: Map|null }}
 */
function selectMcpToolSchemas({ schemas = [], apps = [], toolSearch = false, openedKeys = [] }) {
    if (!schemas.length) return { schemas: [], namespaceIndex: null }
    if (toolSearch) return { schemas, namespaceIndex: buildMcpNamespaceIndex(apps) }
    if (schemas.length <= MCP_DIRECT_TOOL_LIMIT || !apps.length) return { schemas, namespaceIndex: null }
    const openedNames = new Set(apps.filter(app => openedKeys.includes(app.key)).flatMap(app => app.toolNames))
    return {
        schemas: [
            buildOpenMcpAppToolSchema(apps, openedKeys),
            ...schemas.filter(schema => openedNames.has(schema.function?.name)),
        ],
        namespaceIndex: null,
    }
}

/** Opens an app for the rest of the run; the open keys live on the run's tool runtime context. */
function openMcpApp(apps, appKey, toolRuntimeContext) {
    const app = (apps || []).find(item => item.key === appKey)
    if (!app) {
        return { success: false, error: `Unknown app "${appKey}".`, availableApps: (apps || []).map(item => item.key) }
    }
    if (toolRuntimeContext) {
        const opened = Array.isArray(toolRuntimeContext.openedMcpAppKeys) ? toolRuntimeContext.openedMcpAppKeys : []
        if (!opened.includes(app.key)) toolRuntimeContext.openedMcpAppKeys = [...opened, app.key]
    }
    return {
        success: true,
        app: app.key,
        name: app.name,
        toolCount: app.toolNames.length,
        message: `${app.name} is open. Its ${app.toolNames.length} tools are available from your next step on.`,
    }
}

module.exports = {
    MCP_APP_META_KEY,
    OPEN_MCP_APP_TOOL_NAME,
    MCP_DIRECT_TOOL_LIMIT,
    MAX_MCP_TOOLS,
    readMcpToolApp,
    getMcpAppKey,
    describeMcpApps,
    buildMcpNamespaceIndex,
    buildOpenMcpAppToolSchema,
    selectMcpToolSchemas,
    openMcpApp,
}
