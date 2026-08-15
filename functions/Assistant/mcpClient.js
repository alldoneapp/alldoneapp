/**
 * MCP client wrapper for assistant tool execution.
 *
 * Lets a project assistant act as an MCP *client*, reaching out to a remote
 * MCP server (Streamable HTTP or SSE) to discover and invoke tools. This is the
 * inverse direction of `functions/MCP/mcpServerSimple.js`, which exposes Alldone
 * itself as an MCP server to external clients.
 *
 * Constraints:
 *  - Remote transports only (HTTP / SSE). Cloud Functions cannot spawn a local
 *    stdio MCP server process, so `stdio` is intentionally unsupported.
 *  - The `@modelcontextprotocol/sdk` package is ESM-only ("type": "module").
 *    The functions runtime is CommonJS, so the SDK MUST be loaded via dynamic
 *    `import()` (a plain `require()` throws ERR_REQUIRE_ESM). This mirrors the
 *    `await import('./MCP/mcpServerSimple.js')` deferral used in index.js.
 *  - Each call opens a fresh client connection and closes it when done. Cloud
 *    Functions are effectively stateless per invocation, and Streamable HTTP is
 *    designed for short-lived request/response cycles, so there is no long-lived
 *    connection to reuse.
 */

const DEFAULT_TIMEOUT_MS = 30000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 60000

const CLIENT_INFO = { name: 'alldone-assistant', version: '1.0.0' }

// Cache the dynamically imported ESM modules so we only pay the import cost once
// per warm function instance.
let sdkModulesPromise = null
function loadSdk() {
    if (!sdkModulesPromise) {
        sdkModulesPromise = Promise.all([
            import('@modelcontextprotocol/sdk/client/index.js'),
            import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
            import('@modelcontextprotocol/sdk/client/sse.js'),
        ]).then(([clientMod, streamableMod, sseMod]) => ({
            Client: clientMod.Client,
            StreamableHTTPClientTransport: streamableMod.StreamableHTTPClientTransport,
            SSEClientTransport: sseMod.SSEClientTransport,
        }))
    }
    return sdkModulesPromise
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

function clampTimeout(timeoutMs) {
    const n = Number(timeoutMs)
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n))
}

/**
 * Validate + normalize a server config into a parsed URL + transport choice.
 * Throws on anything that isn't a remote https endpoint.
 */
function normalizeServerConfig(serverConfig) {
    if (!isObject(serverConfig)) {
        throw new Error('MCP server config is required')
    }

    const rawUrl = String(serverConfig.url || '').trim()
    if (!rawUrl) {
        throw new Error('MCP server URL is required')
    }

    let url
    try {
        url = new URL(rawUrl)
    } catch (_) {
        throw new Error(`MCP server URL is invalid: ${rawUrl}`)
    }

    // Remote only. Allow http exclusively for localhost (emulator/dev).
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
        throw new Error(`MCP server URL must use https (got ${url.protocol})`)
    }

    const rawTransport = String(serverConfig.transport || 'http').toLowerCase()
    const transport = rawTransport === 'sse' ? 'sse' : 'http'

    return { url, transport, timeoutMs: clampTimeout(serverConfig.timeoutMs) }
}

/**
 * Build the per-request auth headers from the server config + resolved secret.
 *
 *  - authType 'none'   -> no auth header
 *  - authType 'bearer' -> Authorization: Bearer <secret.token>
 *  - authType 'oauth'  -> Authorization: Bearer <secret.accessToken>
 *
 * For OAuth we currently inject the already-resolved access token as a bearer
 * header. Full refresh-on-401 via an OAuthClientProvider is a later layer; the
 * connect callable is responsible for refreshing before this runs.
 */
function buildAuthHeaders(serverConfig, secret) {
    const authType = String(serverConfig?.authType || 'none').toLowerCase()
    if (authType === 'none') return {}

    if (authType === 'bearer') {
        const token = String(secret?.token || '').trim()
        if (!token) throw new Error('MCP bearer auth is configured but no token was provided')
        return { Authorization: `Bearer ${token}` }
    }

    if (authType === 'oauth') {
        const accessToken = String(secret?.accessToken || secret?.token || '').trim()
        if (!accessToken) throw new Error('MCP OAuth auth is configured but no access token was provided')
        return { Authorization: `Bearer ${accessToken}` }
    }

    throw new Error(`Unsupported MCP authType: ${authType}`)
}

/**
 * Decide whether a failed Streamable HTTP connect should retry over SSE.
 * Only true for "this endpoint doesn't implement Streamable HTTP" signals
 * (404 / 405). Auth failures (401/403) and network errors are rethrown as-is so
 * the real cause isn't masked by a secondary SSE error.
 */
function shouldFallBackToSse(err) {
    const code = err && typeof err.code === 'number' ? err.code : null
    return code === 404 || code === 405
}

function createTransport(sdk, normalized, authHeaders) {
    const requestInit = {}
    if (authHeaders && Object.keys(authHeaders).length > 0) {
        requestInit.headers = authHeaders
    }

    if (normalized.transport === 'sse') {
        return new sdk.SSEClientTransport(normalized.url, {
            requestInit,
            // SSE GET stream cannot carry custom headers via fetch; mirror them here.
            eventSourceInit: authHeaders && Object.keys(authHeaders).length > 0 ? { headers: authHeaders } : undefined,
        })
    }

    return new sdk.StreamableHTTPClientTransport(normalized.url, { requestInit })
}

/**
 * Open a client, run `fn(client)`, and always close/cleanup afterwards.
 * For Streamable HTTP, if the initial connect fails we fall back to SSE once,
 * which covers older servers that only speak the deprecated HTTP+SSE transport.
 */
async function withClient(serverConfig, secret, fn) {
    const sdk = await loadSdk()
    const normalized = normalizeServerConfig(serverConfig)
    const authHeaders = buildAuthHeaders(serverConfig, secret)

    const tryConnect = async transportKind => {
        const client = new sdk.Client(CLIENT_INFO, { capabilities: {} })
        const transport = createTransport(sdk, { ...normalized, transport: transportKind }, authHeaders)
        await client.connect(transport, { timeout: normalized.timeoutMs })
        return client
    }

    let client
    try {
        client = await tryConnect(normalized.transport)
    } catch (err) {
        // Only fall back from Streamable HTTP to the legacy SSE transport when
        // the failure looks like "this server doesn't speak Streamable HTTP"
        // (e.g. 404/405), NOT when it's an auth failure (401/403) — otherwise a
        // bad token gets masked by a confusing secondary SSE error.
        if (normalized.transport === 'http' && shouldFallBackToSse(err)) {
            client = await tryConnect('sse')
        } else {
            throw err
        }
    }

    try {
        return await fn(client, normalized)
    } finally {
        try {
            await client.close()
        } catch (_) {
            // best-effort cleanup
        }
    }
}

/**
 * Discover the tools exposed by a remote MCP server.
 * Returns the raw `tools` array from the MCP `tools/list` response, each entry
 * shaped `{ name, description, inputSchema }`.
 */
async function listTools(serverConfig, secret) {
    return withClient(serverConfig, secret, async (client, normalized) => {
        const result = await client.listTools(undefined, { timeout: normalized.timeoutMs })
        return Array.isArray(result?.tools) ? result.tools : []
    })
}

/**
 * Invoke a single tool on a remote MCP server.
 * Returns the raw MCP `tools/call` result (`{ content, isError, ... }`).
 */
async function callTool(serverConfig, secret, name, args) {
    if (!name || typeof name !== 'string') {
        throw new Error('MCP tool name is required')
    }
    return withClient(serverConfig, secret, async (client, normalized) => {
        return client.callTool({ name, arguments: isObject(args) ? args : {} }, undefined, {
            timeout: normalized.timeoutMs,
        })
    })
}

module.exports = {
    listTools,
    callTool,
    // exported for unit testing
    normalizeServerConfig,
    buildAuthHeaders,
}
