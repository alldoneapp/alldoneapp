const crypto = require('crypto')

const MANIFEST_FILENAME = 'alldone-tools.json'
const MANIFEST_QUERY_FLAG = 'alldone_manifest'
const DEFAULT_FETCH_TIMEOUT_MS = 10000
const MIN_FETCH_TIMEOUT_MS = 1000
const MAX_FETCH_TIMEOUT_MS = 30000
const MAX_TOOLS = 50
const MAX_SCHEMA_SIZE_BYTES = 100000
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function normalizeToolToken(value, fallback = 'tool') {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return normalized || fallback
}

function uniqueUrls(urls) {
    const seen = new Set()
    const result = []
    urls.forEach(url => {
        if (typeof url !== 'string') return
        if (seen.has(url)) return
        seen.add(url)
        result.push(url)
    })
    return result
}

function toHttpsUrl(rawUrl) {
    const parsed = new URL(String(rawUrl || '').trim())
    if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs are supported for external tool discovery')
    }
    parsed.hash = ''
    return parsed
}

function clampTimeout(value, fallback = DEFAULT_FETCH_TIMEOUT_MS) {
    if (!Number.isFinite(value)) return fallback
    return Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(MAX_FETCH_TIMEOUT_MS, Math.round(value)))
}

function buildManifestCandidates(rawUrl) {
    const baseUrl = toHttpsUrl(rawUrl)
    const pathWithoutTrailingSlash = baseUrl.pathname.replace(/\/+$/g, '')

    const queryManifestUrl = new URL(baseUrl.toString())
    queryManifestUrl.searchParams.set(MANIFEST_QUERY_FLAG, '1')

    const pathManifestUrl = new URL(baseUrl.origin)
    pathManifestUrl.pathname = `${pathWithoutTrailingSlash || ''}/.well-known/${MANIFEST_FILENAME}`
    pathManifestUrl.search = ''

    const rootManifestUrl = new URL(baseUrl.origin)
    rootManifestUrl.pathname = `/.well-known/${MANIFEST_FILENAME}`
    rootManifestUrl.search = ''

    return {
        sourceUrl: baseUrl.toString(),
        sourceOrigin: baseUrl.origin,
        candidates: uniqueUrls([queryManifestUrl.toString(), pathManifestUrl.toString(), rootManifestUrl.toString()]),
    }
}

async function fetchJson(url, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const safeTimeoutMs = clampTimeout(timeoutMs)
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(safeTimeoutMs),
    })

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
    }

    const text = await response.text()
    if (!text || !text.trim()) {
        throw new Error('Empty response body')
    }

    let parsed
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        throw new Error('Response is not valid JSON')
    }

    return parsed
}

function normalizeInputSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return {
            type: 'object',
            properties: {},
            required: [],
        }
    }

    const serialized = JSON.stringify(schema)
    if (serialized.length > MAX_SCHEMA_SIZE_BYTES) {
        throw new Error(`inputSchema too large (${serialized.length} bytes)`)
    }

    const normalized = { ...schema }
    if (normalized.type !== 'object') normalized.type = 'object'
    if (!normalized.properties || typeof normalized.properties !== 'object' || Array.isArray(normalized.properties)) {
        normalized.properties = {}
    }
    if (!Array.isArray(normalized.required)) normalized.required = []

    return normalized
}

function normalizeExecution(execution, integrationOrigin) {
    const rawExecution = execution && typeof execution === 'object' ? execution : {}

    const methodRaw = String(rawExecution.method || 'POST').toUpperCase()
    const method = ALLOWED_METHODS.has(methodRaw) ? methodRaw : 'POST'

    let url = null

    if (typeof rawExecution.url === 'string' && rawExecution.url.trim()) {
        const parsedUrl = toHttpsUrl(rawExecution.url)
        if (parsedUrl.origin !== integrationOrigin) {
            throw new Error(`Execution URL origin mismatch: ${parsedUrl.origin}`)
        }
        url = parsedUrl.toString()
    } else if (typeof rawExecution.path === 'string' && rawExecution.path.trim()) {
        const safePath = rawExecution.path.trim().startsWith('/')
            ? rawExecution.path.trim()
            : `/${rawExecution.path.trim()}`
        const parsedUrl = new URL(integrationOrigin)
        parsedUrl.pathname = safePath
        parsedUrl.search = ''
        parsedUrl.hash = ''
        url = parsedUrl.toString()
    } else {
        throw new Error('Tool execution must define either execution.url or execution.path')
    }

    return {
        method,
        url,
        timeoutMs: clampTimeout(rawExecution.timeoutMs),
    }
}

function normalizeTool(tool, index, integrationOrigin, integrationId) {
    if (!tool || typeof tool !== 'object') return null

    const keyBase = tool.key || tool.id || tool.name || `tool_${index + 1}`
    const key = normalizeToolToken(keyBase, `tool_${index + 1}`)
    const name =
        String(tool.name || keyBase || key)
            .trim()
            .slice(0, 120) || key
    const description =
        String(tool.description || `Execute ${name} in ${integrationId}`)
            .trim()
            .slice(0, 500) || `Execute ${name} in ${integrationId}`

    const inputSchema = normalizeInputSchema(tool.inputSchema)
    const execution = normalizeExecution(tool.execution, integrationOrigin)

    return {
        key,
        name,
        description,
        inputSchema,
        execution,
    }
}

function normalizeManifest(manifest, sourceOrigin, sourceUrl, manifestUrl) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('Manifest root must be an object')
    }

    const integrationRaw = manifest.integration && typeof manifest.integration === 'object' ? manifest.integration : {}
    const declaredOrigin = integrationRaw.origin ? toHttpsUrl(integrationRaw.origin).origin : sourceOrigin

    if (declaredOrigin !== sourceOrigin) {
        throw new Error(`Manifest origin mismatch. Expected ${sourceOrigin}, received ${declaredOrigin}`)
    }

    const integrationIdSource = integrationRaw.id || `${sourceOrigin}${integrationRaw.slug || ''}` || sourceOrigin
    const integrationId = normalizeToolToken(integrationIdSource, 'external_integration')
    const integrationName =
        String(integrationRaw.name || integrationId)
            .trim()
            .slice(0, 120) || integrationId

    const rawTools = Array.isArray(manifest.tools) ? manifest.tools.slice(0, MAX_TOOLS) : []
    if (rawTools.length === 0) {
        throw new Error('Manifest does not define any tools')
    }

    const normalizedTools = rawTools
        .map((tool, index) => normalizeTool(tool, index, declaredOrigin, integrationId))
        .filter(Boolean)

    if (normalizedTools.length === 0) {
        throw new Error('No valid tools found in manifest')
    }

    return {
        success: true,
        version: String(manifest.version || '1.0'),
        sourceUrl,
        manifestUrl,
        discoveredAt: Date.now(),
        integrationId,
        integrationName,
        origin: declaredOrigin,
        tools: normalizedTools,
    }
}

async function discoverExternalToolsFromUrl(rawUrl) {
    const { sourceUrl, sourceOrigin, candidates } = buildManifestCandidates(rawUrl)
    const attempts = []

    for (let index = 0; index < candidates.length; index++) {
        const candidateUrl = candidates[index]
        try {
            const manifest = await fetchJson(candidateUrl)
            const normalized = normalizeManifest(manifest, sourceOrigin, sourceUrl, candidateUrl)
            return {
                ...normalized,
                attempts,
            }
        } catch (error) {
            attempts.push({
                url: candidateUrl,
                error: error.message,
            })
        }
    }

    const fingerprint = crypto.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 8)
    return {
        success: false,
        sourceUrl,
        error: `No valid manifest discovered for source (${fingerprint})`,
        attempts,
    }
}

module.exports = {
    discoverExternalToolsFromUrl,
}
