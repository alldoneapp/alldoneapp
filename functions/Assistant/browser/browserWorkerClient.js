'use strict'

// The Functions side of the browser worker: mints a short-lived signed token and makes the HTTP
// call. Modelled on `vmLlmProxy`'s token, and for the same reason — the worker is a separate Cloud
// Run service, and everything that constrains a run has to travel with the request in a form the
// caller cannot rewrite.
//
// The token carries the ALLOWLIST and the LIMITS, not just an identity. That is the point: the
// worker enforces "this navigation is off-allowlist" at the network layer, where redirects and
// page-initiated navigations actually happen, but it never gets to decide what the allowlist is.
// Policy stays in Functions; the worker is the place the decision is applied.
//
// Nothing here throws for a page problem — a worker failure comes back as `{ ok: false, error }` so
// the tool can report it to the model like any other unreachable page.

const crypto = require('crypto')

const TOKEN_PREFIX = 'abw_'
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 1000
const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000

function base64UrlEncode(value) {
    return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64').toString('utf8')
}

function signPayload(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

/**
 * A token is minted per worker CALL, not per run: its two-minute life is the blast radius of a
 * leaked one, and a run that lasts five minutes never holds a token that outlives its current step.
 */
function mintWorkerToken(
    {
        runId,
        sessionId,
        projectId,
        userId,
        allowlist = [],
        limits = {},
        expiresAtMs = Date.now() + DEFAULT_TOKEN_TTL_MS,
    },
    signingSecret
) {
    if (!signingSecret) throw new Error('BROWSER_WORKER_SIGNING_SECRET is not configured; cannot mint a worker token')
    const payload = base64UrlEncode(
        JSON.stringify({
            rid: runId || '',
            sid: sessionId || '',
            pid: projectId || '',
            uid: userId || '',
            // Serialized in the shape the worker matches with, so it cannot re-derive a looser one.
            allow: (Array.isArray(allowlist) ? allowlist : []).map(entry => ({
                h: entry.host,
                s: entry.subdomainsOnly === true,
                p: entry.pathPrefix || '',
            })),
            lim: {
                redirects: limits.maxRedirectsPerNavigation,
                requests: limits.maxNetworkRequests,
                bytes: limits.maxResponseBytes,
                stepMs: limits.maxStepTimeoutMs,
                idleMs: limits.maxSessionIdleMs,
                chars: limits.maxSnapshotChars,
            },
            exp: Math.floor((Number(expiresAtMs) || 0) / 1000),
        })
    )
    return `${TOKEN_PREFIX}${payload}.${signPayload(payload, signingSecret)}`
}

/** The verification half, exported so the worker's own suite can drive the real minting code. */
function verifyWorkerToken(token, signingSecret, nowMs = Date.now()) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return { valid: false, reason: 'format' }
    if (!signingSecret) return { valid: false, reason: 'no_secret' }

    const body = token.slice(TOKEN_PREFIX.length)
    const dot = body.lastIndexOf('.')
    if (dot <= 0) return { valid: false, reason: 'format' }
    const payload = body.slice(0, dot)
    const signature = body.slice(dot + 1)

    const expected = signPayload(payload, signingSecret)
    const provided = Buffer.from(signature)
    const computed = Buffer.from(expected)
    if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
        return { valid: false, reason: 'signature' }
    }

    let data
    try {
        data = JSON.parse(base64UrlDecode(payload))
    } catch (error) {
        return { valid: false, reason: 'payload' }
    }
    if (!data || typeof data !== 'object') return { valid: false, reason: 'payload' }
    if (!Number.isFinite(data.exp) || data.exp * 1000 <= nowMs) return { valid: false, reason: 'expired' }

    return {
        valid: true,
        runId: data.rid || '',
        sessionId: data.sid || '',
        projectId: data.pid || '',
        userId: data.uid || '',
        allowlist: Array.isArray(data.allow)
            ? data.allow.map(entry => ({
                  host: String(entry?.h || ''),
                  subdomainsOnly: entry?.s === true,
                  pathPrefix: String(entry?.p || ''),
              }))
            : [],
        limits: data.lim && typeof data.lim === 'object' ? data.lim : {},
    }
}

/**
 * One worker call. `operation` is `describe` (resolve an element and report what it is — never
 * touching it), `act` (perform the action) or `close` (drop the context).
 */
async function callBrowserWorker({
    operation,
    payload = {},
    config,
    runId,
    sessionId,
    projectId,
    userId,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    now = Date.now(),
}) {
    if (!config || !config.workerBaseUrl || !config.signingSecret) {
        return { ok: false, error: 'The browser worker is not configured.', reason: 'not_configured' }
    }
    if (typeof fetchImpl !== 'function') {
        return { ok: false, error: 'No fetch implementation is available.', reason: 'no_fetch' }
    }

    let token
    try {
        token = mintWorkerToken(
            {
                runId,
                sessionId,
                projectId,
                userId,
                allowlist: config.allowlist,
                limits: config.limits,
                expiresAtMs: now + DEFAULT_TOKEN_TTL_MS,
            },
            config.signingSecret
        )
    } catch (error) {
        return { ok: false, error: error.message, reason: 'token' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetchImpl(`${config.workerBaseUrl}/v1/${operation}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ runId, sessionId, ...payload }),
            signal: controller.signal,
        })

        let data = null
        try {
            data = await response.json()
        } catch (error) {
            data = null
        }

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                reason: data?.reason || 'worker_error',
                error: data?.error || `The browser worker answered with HTTP ${response.status}.`,
            }
        }
        return { ok: true, status: response.status, ...(data || {}) }
    } catch (error) {
        const timedOut = error && error.name === 'AbortError'
        return {
            ok: false,
            reason: timedOut ? 'timeout' : 'network',
            error: timedOut
                ? `The browser worker did not answer within ${Math.round(timeoutMs / 1000)}s.`
                : `The browser worker could not be reached: ${error.message}`,
        }
    } finally {
        clearTimeout(timer)
    }
}

module.exports = {
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_TOKEN_TTL_MS,
    TOKEN_PREFIX,
    callBrowserWorker,
    mintWorkerToken,
    verifyWorkerToken,
}
