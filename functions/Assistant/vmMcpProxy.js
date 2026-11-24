// VM MCP proxy: the agent in a VM sandbox uses the MCP tools of its project's assistants without
// any credential entering the sandbox.
//
// Why: a VM run started by one assistant (say the CTO) could not reach a tool another assistant of
// the project carries (Connor's Story Builder on alldone.team/mcp). The VM had no MCP config at
// all, so the agent tried alldone.team itself and got a 401 (AM-1317).
//
// How: the runner points the agent at ONE MCP server, this function, with a short-lived per-job
// token minted like the LLM proxy's (same signing secret, its own audience `vm_mcp`, so neither
// token works on the other proxy). On every request the proxy reads the job from
// `pendingWebhooks/{cid}`, which the sandbox cannot write, and decides the tools from it:
//
//   - every enabled MCP server of the assistant that started the run, as its own assistant runs see
//     them (only when that assistant has `mcp_servers` in its Tools Access);
//   - the alldone.team specialist servers (`managedBy: 'alldone.team'`, `authType: 'alldone_app'`)
//     of every other assistant in the project that has `mcp_servers` on. These store no token and
//     act only as the requesting user, with their own alldone.team data and Gold, so they give the
//     run nothing the user does not already have. Other assistants' own servers are NOT offered:
//     their stored credential was granted to that assistant, possibly by another member.
//
// Calls go through mcpClient with resolveMcpSecret, exactly like an assistant's own run, as the
// user who started the job. The sandbox only ever holds the per-job token.

const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { mintProxyToken, verifyProxyToken, isProxyEnabled, getProxyBaseUrl } = require('./vmLlmProxy')
const { serverAllowsMcpTool, readMcpToolApp, MAX_MCP_TOOLS } = require('./mcpAppGroups')
const { isManagedMcpServer } = require('../Assistants/managedMcpServers')
const { isProjectMemberData } = require('../shared/privacyAccess')
const { BROWSER_TOOL_NAMES } = require('./browser/browserToolContract')

const REGION = 'europe-west1'
const FUNCTION_NAME = 'vmMcpProxy'
const TOKEN_AUDIENCE = 'vm_mcp'
// The server name the agent sees; its tools appear as mcp__project_tools__<tool>.
const VM_MCP_SERVER_NAME = 'project_tools'
const MCP_SERVERS_TOOL_KEY = 'mcp_servers'
const ALLDONE_APP_AUTH = 'alldone_app'
const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted', 'cancel_requested']
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
// tools/list and tools/call each need the tool list; one listing serves a job for this long.
const TOOL_CACHE_TTL_MS = 60 * 1000
const MAX_CACHED_JOBS = 200

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const slug = value =>
    String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')

// ----- URL and token -----

/**
 * The URL the sandbox calls. An explicit VM_LLM_PROXY_BASE_URL (emulator, tunnel) that ends in the
 * LLM proxy's function name is followed to this function's name next to it; otherwise the deployed
 * function URL. Null when neither can be resolved.
 */
function getVmMcpProxyUrl(env) {
    const resolved = env || getEnvFunctions()
    const override = resolved && resolved.VM_LLM_PROXY_BASE_URL
    if (override) {
        const trimmed = String(override).replace(/\/+$/, '')
        if (/\/vmLlmProxy$/.test(trimmed)) return trimmed.replace(/\/vmLlmProxy$/, `/${FUNCTION_NAME}`)
    }
    const llmBase = getProxyBaseUrl(override ? { ...resolved, VM_LLM_PROXY_BASE_URL: '' } : resolved)
    if (!llmBase) return null
    return llmBase.replace(/\/vmLlmProxy$/, `/${FUNCTION_NAME}`)
}

/** A per-job token for this proxy only. Carries the job and the user; everything else is read per request. */
function mintVmMcpToken({ correlationId, userId, expiresAtMs }, env) {
    return mintProxyToken({ correlationId, agent: TOKEN_AUDIENCE, userId, expiresAtMs }, env)
}

function verifyVmMcpToken(token, { env = null, nowMs = Date.now() } = {}) {
    return verifyProxyToken(token, { expectedAgent: TOKEN_AUDIENCE, env, nowMs })
}

/**
 * What the runner hands the agent: the proxy URL and a token. Null when the proxy cannot be
 * configured, in which case the run simply has no project tools.
 */
function buildVmMcpAccess({ vmJob, ttlMs, env = null }) {
    const resolved = env || getEnvFunctions()
    if (!isProxyEnabled(resolved)) return null
    const url = getVmMcpProxyUrl(resolved)
    if (!url || !vmJob?.correlationId || !vmJob?.requestUserId) return null
    const token = mintVmMcpToken(
        {
            correlationId: vmJob.correlationId,
            userId: vmJob.requestUserId,
            expiresAtMs: Date.now() + (Number(ttlMs) || 0),
        },
        resolved
    )
    return { serverName: VM_MCP_SERVER_NAME, url, token }
}

// ----- Which servers a run may use -----

const hasMcpServersTool = assistantData =>
    Array.isArray(assistantData?.allowedTools) && assistantData.allowedTools.includes(MCP_SERVERS_TOOL_KEY)

const isUsableServer = server => isObject(server) && server.enabled !== false && typeof server.url === 'string'

const isSpecialistServer = server =>
    isUsableServer(server) && isManagedMcpServer(server) && server.authType === ALLDONE_APP_AUTH

const readAppIds = server =>
    Array.isArray(server?.appIds) ? server.appIds.filter(id => typeof id === 'string' && id) : []

/**
 * The servers a VM run of `assistantId` in `projectId` may use, from the project's assistant
 * documents. Pure: takes [{ id, data }]. Each entry is { server, ownerAssistantId }; the owner is
 * whose stored secret a non-alldone.team server authenticates with.
 *
 * Every alldone_app server (the specialists', and one the invoking assistant added itself) is
 * merged into one entry per URL, with the union of their `appIds`, so alldone.team is listed once
 * however many specialists the project has. An entry without `appIds` lifts the filter.
 */
function selectVmMcpServers(assistantDocs, assistantId) {
    const own = []
    const alldoneAppByUrl = new Map()
    const addAlldoneApp = server => {
        const key = server.url.replace(/\/+$/, '')
        const appIds = readAppIds(server)
        const existing = alldoneAppByUrl.get(key)
        if (!existing) {
            alldoneAppByUrl.set(key, {
                server: { ...server, appIds: appIds.length ? appIds : null },
                ownerAssistantId: null,
            })
            return
        }
        if (existing.server.appIds === null || !appIds.length) {
            existing.server.appIds = null
            return
        }
        existing.server.appIds = Array.from(new Set([...existing.server.appIds, ...appIds]))
    }

    for (const doc of Array.isArray(assistantDocs) ? assistantDocs : []) {
        if (!doc || !hasMcpServersTool(doc.data)) continue
        const servers = Array.isArray(doc.data.mcpServers) ? doc.data.mcpServers : []
        const isInvoker = !!assistantId && doc.id === assistantId
        for (const server of servers) {
            if (!isUsableServer(server)) continue
            if (server.authType === ALLDONE_APP_AUTH) {
                if (isInvoker || isSpecialistServer(server)) addAlldoneApp(server)
                continue
            }
            if (isInvoker) own.push({ server, ownerAssistantId: doc.id })
        }
    }

    const merged = Array.from(alldoneAppByUrl.values()).map(entry => {
        const { appIds, ...rest } = entry.server
        return { ...entry, server: appIds ? { ...rest, appIds } : rest }
    })
    return [...own, ...merged]
}

async function loadVmMcpServers({ db, projectId, assistantId }) {
    if (!projectId) return []
    const snap = await db.collection(`assistants/${projectId}/items`).get()
    const docs = snap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }))
    return selectVmMcpServers(docs, assistantId)
}

// ----- Tools -----

const isModelVisible = tool => {
    const { readToolUi } = require('../MCP/mcpAppViews')
    const { visibility } = readToolUi(tool)
    return !Array.isArray(visibility) || visibility.includes('model')
}

const normalizeInputSchema = schema =>
    isObject(schema) && schema.type === 'object' ? schema : { type: 'object', properties: {} }

/**
 * List the tools of every selected server as the requesting user. A server that fails is skipped,
 * as in an assistant run, so one bad server cannot take the others down. Names stay the remote
 * names; a name two servers share gets its server's label in front.
 */
async function listVmMcpTools({ servers, projectId, requestUserId, deps = {} }) {
    const mcpClient = deps.mcpClient || require('./mcpClient')
    const resolveMcpSecret = deps.resolveMcpSecret || require('../MCP/mcpAssistantConnect').resolveMcpSecret

    const perServer = await Promise.all(
        servers.map(async ({ server, ownerAssistantId }) => {
            try {
                const secret = await resolveMcpSecret({
                    authType: server.authType,
                    projectId,
                    assistantId: ownerAssistantId,
                    serverId: server.id,
                    requestUserId,
                    serverUrl: server.url,
                })
                const tools = await mcpClient.listTools(server, secret)
                return tools
                    .filter(tool => tool && typeof tool.name === 'string' && tool.name)
                    .filter(tool => serverAllowsMcpTool(server, tool) && isModelVisible(tool))
                    .map(tool => ({ tool, server, ownerAssistantId }))
            } catch (error) {
                console.warn('🔌 VM MCP: failed to list tools for server', {
                    projectId,
                    serverId: server.id,
                    error: error && error.message ? error.message : String(error),
                })
                return []
            }
        })
    )

    const all = perServer.flat()
    const nameCounts = all.reduce(
        (counts, { tool }) => counts.set(tool.name, (counts.get(tool.name) || 0) + 1),
        new Map()
    )
    const seen = new Set()
    const targets = []
    for (const { tool, server, ownerAssistantId } of all) {
        const name =
            nameCounts.get(tool.name) > 1
                ? `${slug(server.label || server.id).slice(0, 20)}__${tool.name}`.slice(0, 64)
                : tool.name
        if (seen.has(name)) continue
        seen.add(name)
        const app = readMcpToolApp(tool)
        targets.push({
            name,
            remoteName: tool.name,
            server,
            ownerAssistantId,
            appName: app ? app.name : server.label || server.id,
            appSummary: app ? app.summary : '',
            definition: {
                name,
                ...(typeof tool.title === 'string' ? { title: tool.title } : {}),
                description: String(tool.description || `Run ${tool.name} on ${server.label || 'MCP server'}`),
                inputSchema: normalizeInputSchema(tool.inputSchema),
                ...(isObject(tool.outputSchema) ? { outputSchema: tool.outputSchema } : {}),
                ...(isObject(tool.annotations) ? { annotations: tool.annotations } : {}),
            },
        })
        if (targets.length >= MAX_MCP_TOOLS) break
    }
    return targets
}

/** Apps and their tool counts, in first-seen order, for the agent's prompt. Pure. */
function summarizeVmMcpTools(targets) {
    const apps = new Map()
    for (const target of targets) {
        const key = target.appName
        const app = apps.get(key) || { name: target.appName, summary: target.appSummary, toolCount: 0 }
        app.toolCount += 1
        apps.set(key, app)
    }
    return Array.from(apps.values())
}

// ----- The shared Alldone browser (AT-3141) -----

// Alldone's own MCP endpoint (`<base>/mcpServer`, see index.js). Its browser_* tools drive the
// shared browser the user can watch and take over; a session is bound to a task with `taskId`.
const ALLDONE_MCP_PATH = '/mcpServer'

const toOrigin = url => {
    try {
        return new URL(String(url || '').trim()).origin
    } catch (_) {
        return null
    }
}

/** The origins Alldone's own MCP server answers on in this environment. */
function getAlldoneMcpOrigins(env = process.env) {
    const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
    return Array.from(new Set([toOrigin(getBaseUrl()), toOrigin(env.MCP_BASE_URL)].filter(Boolean)))
}

/** Pure: whether `url` is Alldone's own MCP endpoint on one of `origins`. */
function isAlldoneMcpServerUrl(url, origins) {
    let parsed
    try {
        parsed = new URL(String(url || ''))
    } catch (_) {
        return false
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) return false
    if (!(Array.isArray(origins) ? origins : []).includes(parsed.origin)) return false
    return parsed.pathname.replace(/\/+$/, '') === ALLDONE_MCP_PATH
}

/**
 * Pure. The shared Alldone browser among a run's project tools, or null.
 *
 * Only a tool name is not enough: other MCP servers (Playwright MCP, for one) also call their tools
 * browser_navigate, browser_click, …, and they start a browser nobody can watch. So the shared
 * browser counts as available only when Alldone's own MCP server offers the complete browser_*
 * family and every one of those tools takes the `taskId` that binds the session to the task. A
 * partial family fails closed: a browser that can click but not look is not a usable shared browser.
 *
 * Returns { toolNames }: the names the agent sees (a clashing name carries a server prefix), in
 * BROWSER_TOOL_NAMES order.
 */
function findSharedBrowserTools(targets, origins) {
    const byRemoteName = new Map()
    for (const target of Array.isArray(targets) ? targets : []) {
        if (!target || !BROWSER_TOOL_NAMES.includes(target.remoteName)) continue
        if (!isAlldoneMcpServerUrl(target.server?.url, origins)) continue
        const properties = target.definition?.inputSchema?.properties
        if (!isObject(properties) || !isObject(properties.taskId)) continue
        if (!byRemoteName.has(target.remoteName)) byRemoteName.set(target.remoteName, target.name)
    }
    if (!BROWSER_TOOL_NAMES.every(name => byRemoteName.has(name))) return null
    return { toolNames: BROWSER_TOOL_NAMES.map(name => byRemoteName.get(name)) }
}

/**
 * At launch: what this run's project tools are, for the prompt and to decide whether the agent gets
 * the MCP server at all. Never throws: a failure means a run without project tools.
 *
 * `sharedBrowser` is set only when the shared Alldone browser is really among them
 * (findSharedBrowserTools); the VM prompt points the agent at it only then.
 */
async function describeVmProjectTools({ projectId, assistantId, requestUserId, db = admin.firestore(), deps = {} }) {
    try {
        if (!projectId || !requestUserId) return null
        const servers = await loadVmMcpServers({ db, projectId, assistantId })
        if (!servers.length) return null
        const targets = await listVmMcpTools({ servers, projectId, requestUserId, deps })
        if (!targets.length) return null
        let sharedBrowser = null
        try {
            const origins = deps.alldoneMcpOrigins || getAlldoneMcpOrigins()
            sharedBrowser = findSharedBrowserTools(targets, origins)
        } catch (error) {
            console.warn('🔌 VM MCP: could not check for the shared browser', { projectId, error: error.message })
        }
        return {
            enabled: true,
            serverName: VM_MCP_SERVER_NAME,
            toolCount: targets.length,
            apps: summarizeVmMcpTools(targets),
            sharedBrowser,
        }
    } catch (error) {
        console.warn('🔌 VM MCP: could not describe project tools', { projectId, error: error.message })
        return null
    }
}

// ----- Request handling -----

const toolCache = new Map()

function readCachedTargets(correlationId, nowMs) {
    const entry = toolCache.get(correlationId)
    if (entry && entry.expiresAt > nowMs) return entry.targets
    toolCache.delete(correlationId)
    return null
}

function writeCachedTargets(correlationId, targets, nowMs) {
    if (toolCache.size >= MAX_CACHED_JOBS) toolCache.delete(toolCache.keys().next().value)
    toolCache.set(correlationId, { targets, expiresAt: nowMs + TOOL_CACHE_TTL_MS })
}

/**
 * The job a token may act for, read from server-side state: it must exist, belong to the token's
 * user, still be running, and the user must still be a member of its project.
 */
async function loadActiveJob({ db, correlationId, userId }) {
    if (!correlationId || !userId) return { allowed: false, status: 401, message: 'Invalid token' }
    const pendingSnap = await db.doc(`pendingWebhooks/${correlationId}`).get()
    const job = pendingSnap.exists ? pendingSnap.data() || {} : null
    if (!job || job.kind !== 'vm_job' || job.userId !== userId) {
        return { allowed: false, status: 403, message: 'This token is not authorized for a VM task' }
    }
    if (TERMINAL_JOB_STATUSES.includes(job.status)) {
        return { allowed: false, status: 403, message: 'The VM task is no longer active' }
    }
    const projectSnap = await db.doc(`projects/${job.projectId}`).get()
    if (!projectSnap.exists || !isProjectMemberData(projectSnap.data(), userId)) {
        return { allowed: false, status: 403, message: 'The requesting user is no longer a member of this project' }
    }
    return { allowed: true, job }
}

async function getJobTargets({ db, correlationId, job, nowMs, deps }) {
    const cached = readCachedTargets(correlationId, nowMs)
    if (cached) return cached
    const servers = await loadVmMcpServers({ db, projectId: job.projectId, assistantId: job.assistantId })
    const targets = servers.length
        ? await listVmMcpTools({ servers, projectId: job.projectId, requestUserId: job.userId, deps })
        : []
    writeCachedTargets(correlationId, targets, nowMs)
    return targets
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } })
const toolError = text => ({ content: [{ type: 'text', text }], isError: true })

async function callTarget({ target, args, job, correlationId, deps }) {
    const mcpClient = deps.mcpClient || require('./mcpClient')
    const resolveMcpSecret = deps.resolveMcpSecret || require('../MCP/mcpAssistantConnect').resolveMcpSecret
    const startedAt = Date.now()
    try {
        const secret = await resolveMcpSecret({
            authType: target.server.authType,
            projectId: job.projectId,
            assistantId: target.ownerAssistantId,
            serverId: target.server.id,
            requestUserId: job.userId,
            serverUrl: target.server.url,
        })
        const raw = await mcpClient.callTool(target.server, secret, target.remoteName, isObject(args) ? args : {})
        console.log('🔌 VM MCP: tool call', {
            correlationId,
            serverId: target.server.id,
            tool: target.remoteName,
            isError: raw?.isError === true,
            durationMs: Date.now() - startedAt,
        })
        return {
            content: Array.isArray(raw?.content) ? raw.content : [],
            ...(isObject(raw?.structuredContent) ? { structuredContent: raw.structuredContent } : {}),
            ...(raw?.isError === true ? { isError: true } : {}),
        }
    } catch (error) {
        const message = String(error && error.message ? error.message : error).slice(0, 300)
        console.warn('🔌 VM MCP: tool call failed', {
            correlationId,
            serverId: target.server.id,
            tool: target.remoteName,
            error: message,
            durationMs: Date.now() - startedAt,
        })
        return toolError(`${target.server.label || 'MCP server'} → ${target.remoteName} failed: ${message}`)
    }
}

const SERVER_INSTRUCTIONS =
    "Tools of this Alldone project's assistants (for example an alldone.team specialist's app). " +
    'Every call runs as the user who started this task, with their own accounts, permissions and Gold.'

/** One JSON-RPC message. Returns the response, or null for a notification. */
async function handleRpcMessage(message, context) {
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return rpcError(isObject(message) ? message.id : null, -32600, 'Invalid Request')
    }
    const { id, method, params = {} } = message
    const isNotification = !Object.prototype.hasOwnProperty.call(message, 'id')
    if (isNotification) return null

    switch (method) {
        case 'initialize': {
            const requested = params && params.protocolVersion
            return rpcResult(id, {
                protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'alldone-vm-project-tools', version: '1.0.0' },
                instructions: SERVER_INSTRUCTIONS,
            })
        }
        case 'ping':
            return rpcResult(id, {})
        case 'tools/list': {
            const targets = await context.getTargets()
            return rpcResult(id, { tools: targets.map(target => target.definition) })
        }
        case 'tools/call': {
            const name = params && typeof params.name === 'string' ? params.name : ''
            const targets = await context.getTargets()
            const target = targets.find(item => item.name === name)
            if (!target) return rpcResult(id, toolError(`Unknown tool: ${name || '(none)'}`))
            return rpcResult(id, await context.callTarget(target, params.arguments))
        }
        default:
            return rpcError(id, -32601, `Method not found: ${method}`)
    }
}

function readBody(req) {
    if (isObject(req.body) || Array.isArray(req.body)) return req.body
    const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof req.body === 'string' ? req.body : ''
    if (!raw) return null
    return JSON.parse(raw)
}

/**
 * onRequest handler: a stateless Streamable HTTP MCP server that answers every POST with JSON.
 * Public endpoint; the only thing that authorizes a call is a valid per-job token for an active job.
 */
async function handleVmMcpRequest(
    req,
    res,
    { db = admin.firestore(), env = null, deps = {}, nowMs = Date.now() } = {}
) {
    try {
        const resolvedEnv = env || getEnvFunctions()
        if (!isProxyEnabled(resolvedEnv)) {
            res.status(503).json(rpcError(null, -32000, 'VM MCP proxy is not configured'))
            return
        }
        if ((req.method || 'GET').toUpperCase() !== 'POST') {
            // No server-to-client stream: the spec's answer to GET is 405.
            res.set('Allow', 'POST')
            res.status(405).send('Method Not Allowed')
            return
        }

        const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '')
        const verdict = verifyVmMcpToken(token, { env: resolvedEnv, nowMs })
        if (!verdict.valid) {
            console.warn('🔐 VM MCP: rejected request', { reason: verdict.reason })
            res.status(401).json(rpcError(null, -32001, 'Unauthorized'))
            return
        }
        const correlationId = verdict.payload.cid
        const access = await loadActiveJob({ db, correlationId, userId: verdict.payload.uid })
        if (!access.allowed) {
            res.status(access.status).json(rpcError(null, -32001, access.message))
            return
        }

        let body
        try {
            body = readBody(req)
        } catch (_) {
            res.status(400).json(rpcError(null, -32700, 'Parse error'))
            return
        }
        if (!body) {
            res.status(400).json(rpcError(null, -32600, 'Invalid Request'))
            return
        }

        let targetsPromise = null
        const context = {
            getTargets: () => {
                targetsPromise ||= getJobTargets({ db, correlationId, job: access.job, nowMs, deps })
                return targetsPromise
            },
            callTarget: (target, args) => callTarget({ target, args, job: access.job, correlationId, deps }),
        }

        const messages = Array.isArray(body) ? body : [body]
        const responses = []
        for (const message of messages) {
            const response = await handleRpcMessage(message, context)
            if (response) responses.push(response)
        }
        if (!responses.length) {
            res.status(202).end()
            return
        }
        res.status(200).json(Array.isArray(body) ? responses : responses[0])
    } catch (error) {
        console.error('🔌 VM MCP: request failed', { error: error && error.message ? error.message : String(error) })
        res.status(500).json(rpcError(null, -32603, 'Internal error'))
    }
}

module.exports = {
    handleVmMcpRequest,
    handleRpcMessage,
    buildVmMcpAccess,
    describeVmProjectTools,
    selectVmMcpServers,
    listVmMcpTools,
    summarizeVmMcpTools,
    findSharedBrowserTools,
    isAlldoneMcpServerUrl,
    getAlldoneMcpOrigins,
    loadActiveJob,
    mintVmMcpToken,
    verifyVmMcpToken,
    getVmMcpProxyUrl,
    VM_MCP_SERVER_NAME,
    FUNCTION_NAME,
    REGION,
    // for tests
    _toolCache: toolCache,
}
