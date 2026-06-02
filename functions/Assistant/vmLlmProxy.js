// VM LLM proxy — keeps the platform-wide Anthropic/OpenAI keys OUT of the sandbox.
//
// Threat addressed: the VM agent runs with --dangerously-skip-permissions / --ask-for-approval
// never and full internet access. If the real ANTHROPIC_API_KEY / OPENAI_API_KEY lives in the
// sandbox env, anything the agent runs (a malicious objective, injected web/repo content, prompt
// injection) can `curl` the key to an attacker and drain the shared account. To prevent that, the
// sandbox is given a short-lived, per-job, HMAC-signed token and pointed at THIS proxy via
// ANTHROPIC_BASE_URL / OPENAI_BASE_URL. The proxy validates the token, swaps in the real key
// server-side, and streams the upstream response back. The real key never enters the VM.
//
// Blast radius if a per-job token leaks: bounded to its short TTL (~run length) AND only usable
// against this proxy (which we can rate-limit / instantly revoke by rotating the signing secret) —
// strictly better than leaking the real key, which is permanent and works directly against the
// provider. Per-token spend budgeting + active-job revocation are possible future hardening; for
// now the short expiry + signature are the guard (no per-request Firestore read on the hot path).
//
// Config: VM_PROXY_SIGNING_SECRET and optional VM_LLM_PROXY_BASE_URL (defaults to the deployed
// function URL) come from getEnvFunctions(). If the proxy cannot be configured, VM execution fails
// closed instead of ever injecting a real provider API key into the sandbox.

const crypto = require('crypto')
const { TextDecoder } = require('util')
const { getEnvFunctions } = require('../envFunctionsHelper')
const admin = require('firebase-admin')

const REGION = 'europe-west1'
const FUNCTION_NAME = 'vmLlmProxy'
const TOKEN_PREFIX = 'vmpx_'
const VM_JOB_GOLD_SOURCE = 'vm_execution'
const VM_TOKENS_PER_GOLD = 100
const VM_PROXY_INSUFFICIENT_GOLD_REASON = 'insufficient_gold'

// Upstream providers, keyed by the path prefix the sandbox agent hits.
const PROVIDERS = {
    anthropic: {
        routePrefix: '/anthropic',
        upstreamBase: 'https://api.anthropic.com',
        expectedAgent: 'claude',
        realKeyField: 'ANTHROPIC_API_KEY',
        // Claude Code sends the key as the `x-api-key` header.
        authHeader: 'x-api-key',
        readToken: req => req.get('x-api-key') || '',
        applyRealKey: (headers, realKey) => {
            headers['x-api-key'] = realKey
        },
    },
    openai: {
        routePrefix: '/openai',
        upstreamBase: 'https://api.openai.com',
        expectedAgent: 'codex',
        realKeyField: 'OPEN_AI_KEY',
        // Codex / OpenAI SDK sends `Authorization: Bearer <key>`.
        authHeader: 'authorization',
        readToken: req => (req.get('authorization') || '').replace(/^Bearer\s+/i, ''),
        applyRealKey: (headers, realKey) => {
            headers['authorization'] = `Bearer ${realKey}`
        },
    },
}

// Headers we must never forward upstream (hop-by-hop, routing, or the inbound auth we replace).
const STRIPPED_REQUEST_HEADERS = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding', // force an identity response so we can stream bytes through unchanged
    'x-api-key',
    'authorization',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-cloud-trace-context',
    'forwarded',
    'traceparent',
])

// Response headers that would conflict with the streamed pipe we set up.
const STRIPPED_RESPONSE_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection'])

function base64UrlEncode(input) {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeToString(input) {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(padded, 'base64').toString('utf8')
}

function signPayload(payload, secret) {
    return base64UrlEncode(crypto.createHmac('sha256', secret).update(payload).digest())
}

function resolveEnv(env) {
    return env || getEnvFunctions()
}

function getSigningSecret(env) {
    const e = resolveEnv(env)
    return (e && e.VM_PROXY_SIGNING_SECRET) || ''
}

// The proxy is only active when a signing secret is configured.
function isProxyEnabled(env) {
    return !!getSigningSecret(env)
}

// Resolve the public base URL the sandbox should call. Prefer an explicit override; otherwise
// construct the deployed function URL from the project id. Returns null if it can't be resolved.
function getProxyBaseUrl(env) {
    const e = resolveEnv(env)
    if (e && e.VM_LLM_PROXY_BASE_URL) return String(e.VM_LLM_PROXY_BASE_URL).replace(/\/+$/, '')
    const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (() => {
            try {
                return require('firebase-admin').app().options.projectId
            } catch (_) {
                return undefined
            }
        })()
    if (!projectId) return null
    return `https://${REGION}-${projectId}.cloudfunctions.net/${FUNCTION_NAME}`
}

/**
 * Mint a short-lived, per-job token the sandbox uses in place of the real API key.
 * The token is an HMAC-signed { cid, agent, uid, exp } payload — self-contained, so the proxy
 * verifies it with no database read.
 */
function mintProxyToken({ correlationId, agent, userId, expiresAtMs }, env) {
    const secret = getSigningSecret(env)
    if (!secret) throw new Error('VM_PROXY_SIGNING_SECRET is not configured; cannot mint a proxy token')
    const payload = base64UrlEncode(
        JSON.stringify({
            cid: correlationId || '',
            agent: agent || '',
            uid: userId || '',
            exp: Math.floor((Number(expiresAtMs) || 0) / 1000),
        })
    )
    const signature = signPayload(payload, secret)
    return `${TOKEN_PREFIX}${payload}.${signature}`
}

/**
 * Verify a per-job token: signature (timing-safe), expiry, and that it was minted for the agent
 * matching the route it arrived on (a Claude token cannot be replayed against the OpenAI upstream).
 */
function verifyProxyToken(token, { expectedAgent = null, env = null, nowMs = Date.now() } = {}) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return { valid: false, reason: 'format' }
    const secret = getSigningSecret(env)
    if (!secret) return { valid: false, reason: 'no_secret' }

    const body = token.slice(TOKEN_PREFIX.length)
    const dot = body.lastIndexOf('.')
    if (dot <= 0) return { valid: false, reason: 'format' }
    const payload = body.slice(0, dot)
    const signature = body.slice(dot + 1)

    const expected = signPayload(payload, secret)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'signature' }

    let data
    try {
        data = JSON.parse(base64UrlDecodeToString(payload))
    } catch (_) {
        return { valid: false, reason: 'payload' }
    }
    if (!data || !data.exp || data.exp * 1000 < nowMs) return { valid: false, reason: 'expired' }
    if (expectedAgent && data.agent !== expectedAgent) return { valid: false, reason: 'agent' }
    return { valid: true, payload: data }
}

// Match the inbound request path to a provider (by route prefix). Returns { provider, config,
// forwardPath } or null for an unknown route.
function resolveProvider(rawPath) {
    const path = rawPath || '/'
    for (const [provider, config] of Object.entries(PROVIDERS)) {
        if (path === config.routePrefix || path.startsWith(`${config.routePrefix}/`)) {
            const forwardPath = path.slice(config.routePrefix.length) || '/'
            return { provider, config, forwardPath }
        }
    }
    return null
}

/**
 * onRequest handler. Validates the per-job token, swaps in the real upstream key, forwards the
 * request to Anthropic/OpenAI, and streams the response back. Public endpoint — the ONLY thing
 * that authorizes a call is a valid, unexpired, agent-matched HMAC token.
 */
async function handleProxyRequest(req, res) {
    try {
        const env = getEnvFunctions()
        if (!isProxyEnabled(env)) {
            res.status(503).send('VM LLM proxy is not configured')
            return
        }

        const matched = resolveProvider(req.path)
        if (!matched) {
            res.status(404).send('Unknown proxy route')
            return
        }
        const { config, forwardPath } = matched

        const token = config.readToken(req)
        const verdict = verifyProxyToken(token, { expectedAgent: config.expectedAgent, env })
        if (!verdict.valid) {
            // Never echo the token; log only the reason + route for debugging.
            console.warn('🔐 VM PROXY: rejected request', { route: config.routePrefix, reason: verdict.reason })
            res.status(401).send('Unauthorized')
            return
        }
        const continuity = await checkProxyJobCanContinue({
            correlationId: verdict.payload.cid,
            userId: verdict.payload.uid,
        })
        if (!continuity.allowed) {
            res.status(402).send(continuity.message || 'VM task stopped because the user ran out of Gold')
            return
        }

        const realKey = env[config.realKeyField]
        if (!realKey) {
            console.error('🔐 VM PROXY: upstream key missing', { field: config.realKeyField })
            res.status(503).send('Upstream key not configured')
            return
        }

        // Rebuild the forwarded headers: copy everything except stripped/auth headers, then inject
        // the real key. The inbound per-job token is dropped here and never reaches the upstream.
        const headers = {}
        for (const [key, value] of Object.entries(req.headers || {})) {
            if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue
            if (typeof value === 'string') headers[key] = value
            else if (Array.isArray(value)) headers[key] = value.join(', ')
        }
        config.applyRealKey(headers, realKey)

        const queryIndex = (req.originalUrl || '').indexOf('?')
        const queryString = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : ''
        const upstreamUrl = `${config.upstreamBase}${forwardPath}${queryString}`

        const method = (req.method || 'GET').toUpperCase()
        const hasBody = method !== 'GET' && method !== 'HEAD'
        const body = hasBody ? req.rawBody || undefined : undefined

        const upstream = await fetch(upstreamUrl, { method, headers, body })

        res.status(upstream.status)
        upstream.headers.forEach((value, key) => {
            if (STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) return
            res.setHeader(key, value)
        })

        if (upstream.body) {
            const usage = await pipeAndCaptureUsage(upstream.body, res, matched.provider)
            await chargeProxyTokenGold({
                correlationId: verdict.payload.cid,
                userId: verdict.payload.uid,
                provider: matched.provider,
                usage,
            })
        } else {
            res.end()
        }
    } catch (error) {
        console.error('🔐 VM PROXY: proxy error', { error: error.message })
        if (!res.headersSent) {
            res.status(502).send('Proxy error')
        } else {
            try {
                res.end()
            } catch (_) {}
        }
    }
}

function normalizeUsage(usage = {}) {
    const input =
        Number(usage.input_tokens) ||
        Number(usage.prompt_tokens) ||
        Number(usage.inputTokens) ||
        Number(usage.promptTokens) ||
        0
    const output =
        Number(usage.output_tokens) ||
        Number(usage.completion_tokens) ||
        Number(usage.outputTokens) ||
        Number(usage.completionTokens) ||
        0
    const cache =
        (Number(usage.cache_creation_input_tokens) || 0) +
        (Number(usage.cache_read_input_tokens) || 0) +
        (Number(usage.cached_input_tokens) || 0) +
        (Number(usage.input_tokens_details?.cached_tokens) || 0)
    const total = Number(usage.total_tokens) || Number(usage.totalTokens) || input + output + cache
    return {
        inputTokens: Number.isFinite(input) ? input : 0,
        outputTokens: Number.isFinite(output) ? output : 0,
        cacheTokens: Number.isFinite(cache) ? cache : 0,
        totalTokens: Number.isFinite(total) ? total : 0,
    }
}

async function checkProxyJobCanContinue({ correlationId, userId }) {
    if (!correlationId || !userId) return { allowed: false, message: 'Invalid VM proxy token' }
    const db = admin.firestore()
    const pendingRef = db.doc(`pendingWebhooks/${correlationId}`)
    const userRef = db.doc(`users/${userId}`)
    const [pendingSnap, userSnap] = await Promise.all([pendingRef.get(), userRef.get()])
    const pendingData = pendingSnap.exists ? pendingSnap.data() || {} : {}
    const currentGold = userSnap.exists ? Number(userSnap.data()?.gold) || 0 : 0
    if (pendingData.failureReason === VM_PROXY_INSUFFICIENT_GOLD_REASON || currentGold <= 0) {
        if (pendingData.failureReason !== VM_PROXY_INSUFFICIENT_GOLD_REASON) {
            await pendingRef
                .set(
                    {
                        failureReason: VM_PROXY_INSUFFICIENT_GOLD_REASON,
                        interruptedAt: Date.now(),
                    },
                    { merge: true }
                )
                .catch(() => {})
        }
        console.warn('🔐 VM PROXY: rejecting request because VM job is out of Gold', {
            correlationId,
            userId,
            currentGold,
            failureReason: pendingData.failureReason || '',
        })
        return { allowed: false, message: 'VM task stopped because the user ran out of Gold' }
    }
    return { allowed: true, currentGold }
}

function addUsage(a = {}, b = {}) {
    return {
        inputTokens: (Number(a.inputTokens) || 0) + (Number(b.inputTokens) || 0),
        outputTokens: (Number(a.outputTokens) || 0) + (Number(b.outputTokens) || 0),
        cacheTokens: (Number(a.cacheTokens) || 0) + (Number(b.cacheTokens) || 0),
        totalTokens: (Number(a.totalTokens) || 0) + (Number(b.totalTokens) || 0),
    }
}

function extractUsageFromJsonPayload(provider, payload) {
    if (!payload || typeof payload !== 'object') return null
    if (provider === 'anthropic') {
        if (payload.usage) return normalizeUsage(payload.usage)
        if (payload.type === 'message_start' && payload.message?.usage) return normalizeUsage(payload.message.usage)
        if (payload.type === 'message_delta' && payload.usage) return normalizeUsage(payload.usage)
        return null
    }
    if (provider === 'openai') {
        if (payload.usage) return normalizeUsage(payload.usage)
        if (payload.response?.usage) return normalizeUsage(payload.response.usage)
        if (payload.type === 'response.completed' && payload.response?.usage)
            return normalizeUsage(payload.response.usage)
    }
    return null
}

function captureUsageFromTextChunk(provider, text, state) {
    state.buffer = `${state.buffer || ''}${text}`
    const lines = state.buffer.split(/\r?\n/)
    state.buffer = lines.pop() || ''

    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line === '[DONE]') continue
        const jsonText = line.startsWith('data:') ? line.slice(5).trim() : line
        if (!jsonText || jsonText === '[DONE]') continue
        try {
            const payload = JSON.parse(jsonText)
            const usage = extractUsageFromJsonPayload(provider, payload)
            if (usage && usage.totalTokens > 0) {
                if (provider === 'anthropic' && payload.type === 'message_delta') {
                    state.anthropicDeltaUsage = usage
                } else if (provider === 'anthropic' && payload.type === 'message_start') {
                    state.usage = addUsage(state.usage, usage)
                } else {
                    state.usage = addUsage(state.usage, usage)
                }
            }
        } catch (_) {}
    }
}

function finalizeCapturedUsage(provider, state) {
    if (state.buffer) captureUsageFromTextChunk(provider, '\n', state)
    if (provider === 'anthropic' && state.anthropicDeltaUsage) {
        state.usage = addUsage(state.usage, state.anthropicDeltaUsage)
    }
    return state.usage || normalizeUsage()
}

async function pipeAndCaptureUsage(body, res, provider) {
    const decoder = new TextDecoder()
    const state = { buffer: '', usage: normalizeUsage(), anthropicDeltaUsage: null }

    if (typeof body.getReader === 'function') {
        const reader = body.getReader()
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
                res.write(Buffer.from(value))
                captureUsageFromTextChunk(provider, decoder.decode(value, { stream: true }), state)
            }
        }
        const trailing = decoder.decode()
        if (trailing) captureUsageFromTextChunk(provider, trailing, state)
        res.end()
        return finalizeCapturedUsage(provider, state)
    }

    const { Readable } = require('stream')
    for await (const chunk of Readable.fromWeb(body)) {
        res.write(chunk)
        captureUsageFromTextChunk(provider, decoder.decode(chunk, { stream: true }), state)
    }
    const trailing = decoder.decode()
    if (trailing) captureUsageFromTextChunk(provider, trailing, state)
    res.end()
    return finalizeCapturedUsage(provider, state)
}

async function chargeProxyTokenGold({
    correlationId,
    userId,
    provider,
    usage,
    db = admin.firestore(),
    applyGoldChangeInTransactionFn = null,
}) {
    const totalTokens = Number(usage?.totalTokens) || 0
    if (!correlationId || !userId || totalTokens <= 0) return { charged: 0, totalTokens: 0 }

    const userRef = db.doc(`users/${userId}`)
    const pendingRef = db.doc(`pendingWebhooks/${correlationId}`)
    let result = { charged: 0, totalTokens }

    await db.runTransaction(async transaction => {
        const [userSnap, pendingSnap] = await Promise.all([transaction.get(userRef), transaction.get(pendingRef)])
        if (!userSnap.exists || !pendingSnap.exists) return

        const userData = userSnap.data() || {}
        const pendingData = pendingSnap.data() || {}
        const currentGold = Number(userData.gold) || 0
        const previousTokens = Number(pendingData.proxyTokenUsage?.totalTokens) || 0
        const previousGoldCharged = Number(pendingData.proxyTokenGoldCharged) || 0
        const nextTokens = previousTokens + totalTokens
        const goldDue = Math.max(0, Math.round(nextTokens / VM_TOKENS_PER_GOLD) - previousGoldCharged)
        const usageUpdate = {
            inputTokens: (Number(pendingData.proxyTokenUsage?.inputTokens) || 0) + (Number(usage.inputTokens) || 0),
            outputTokens: (Number(pendingData.proxyTokenUsage?.outputTokens) || 0) + (Number(usage.outputTokens) || 0),
            cacheTokens: (Number(pendingData.proxyTokenUsage?.cacheTokens) || 0) + (Number(usage.cacheTokens) || 0),
            totalTokens: nextTokens,
        }

        if (goldDue <= 0) {
            transaction.set(
                pendingRef,
                {
                    proxyTokenUsage: usageUpdate,
                    proxyTokenGoldCharged: previousGoldCharged,
                    proxyLastUsageProvider: provider,
                    proxyLastUsageAt: Date.now(),
                },
                { merge: true }
            )
            result = { charged: 0, totalTokens, totalTokensTracked: nextTokens }
            return
        }

        const goldToCharge = Math.min(goldDue, currentGold)
        if (goldToCharge > 0) {
            const applyGoldChangeInTransaction =
                applyGoldChangeInTransactionFn || require('../Gold/goldHelper').applyGoldChangeInTransaction
            const goldResult = applyGoldChangeInTransaction({
                transaction,
                userRef,
                userData,
                delta: -goldToCharge,
                direction: 'spend',
                source: VM_JOB_GOLD_SOURCE,
                context: {
                    channel: 'assistant',
                    projectId: pendingData.projectId,
                    objectId: pendingData.objectId,
                    objectType: pendingData.objectType,
                    note: `VM ${provider} live token charge (${nextTokens} tracked tokens)`,
                },
                requireSufficientBalance: true,
            })
            if (!goldResult.success) {
                result = { charged: 0, totalTokens, insufficient: true, currentGold }
                transaction.set(
                    pendingRef,
                    {
                        proxyTokenUsage: usageUpdate,
                        proxyTokenGoldCharged: previousGoldCharged,
                        failureReason: VM_PROXY_INSUFFICIENT_GOLD_REASON,
                        interruptedAt: Date.now(),
                        proxyLastUsageProvider: provider,
                        proxyLastUsageAt: Date.now(),
                    },
                    { merge: true }
                )
                return
            }
        }

        const nextGoldCharged = previousGoldCharged + goldToCharge
        const insufficient = goldToCharge < goldDue
        transaction.set(
            pendingRef,
            {
                proxyTokenUsage: usageUpdate,
                proxyTokenGoldCharged: nextGoldCharged,
                ...(insufficient
                    ? {
                          failureReason: VM_PROXY_INSUFFICIENT_GOLD_REASON,
                          interruptedAt: Date.now(),
                      }
                    : {}),
                proxyLastUsageProvider: provider,
                proxyLastUsageAt: Date.now(),
            },
            { merge: true }
        )

        result = {
            charged: goldToCharge,
            goldDue,
            insufficient,
            currentGold,
            totalTokens,
            totalTokensTracked: nextTokens,
            proxyTokenGoldCharged: nextGoldCharged,
        }
    })

    console.log('🔐 VM PROXY: token usage accounted', {
        correlationId,
        userId,
        provider,
        ...result,
    })

    if (result.insufficient) {
        const error = new Error('VM task stopped because the user ran out of Gold during token billing')
        error.code = VM_PROXY_INSUFFICIENT_GOLD_REASON
        throw error
    }
    return result
}

/**
 * Build the sandbox credential descriptor for a run. The sandbox gets only a per-job token + the
 * proxy base URL (NO real key). If the proxy is not configured, fail closed.
 */
function buildVmAgentCredentials({ vmJob, agent, realApiKey, ttlMs, env = null }) {
    const resolved = resolveEnv(env)
    if (!isProxyEnabled(resolved)) {
        throw new Error('VM task cannot run: VM_PROXY_SIGNING_SECRET is not configured.')
    }

    const baseUrl = getProxyBaseUrl(resolved)
    if (!baseUrl) {
        throw new Error('VM task cannot run: VM_LLM_PROXY_BASE_URL could not be resolved.')
    }

    if (!realApiKey) {
        throw new Error('VM task cannot run: upstream model API key is not configured.')
    }

    const token = mintProxyToken(
        {
            correlationId: vmJob.correlationId,
            agent,
            userId: vmJob.requestUserId,
            expiresAtMs: Date.now() + (Number(ttlMs) || 0),
        },
        resolved
    )
    return { apiKey: token, baseUrl, mode: 'proxy' }
}

module.exports = {
    handleProxyRequest,
    checkProxyJobCanContinue,
    normalizeUsage,
    extractUsageFromJsonPayload,
    captureUsageFromTextChunk,
    finalizeCapturedUsage,
    chargeProxyTokenGold,
    mintProxyToken,
    verifyProxyToken,
    isProxyEnabled,
    getProxyBaseUrl,
    buildVmAgentCredentials,
    resolveProvider,
    TOKEN_PREFIX,
    FUNCTION_NAME,
    REGION,
}
