'use strict'

/**
 * Is a model-request failure worth trying again (AT-2870)?
 *
 * The project wiki run of 2026-10-26 died on one OpenRouter stream that broke off mid-flight with
 * `Network connection lost.` and nothing retried it. That error is how OpenRouter reports a lost
 * upstream connection INSIDE an otherwise healthy HTTP 200 stream:
 *
 *     data: {"error": {"code": 502, "message": "Network connection lost."}, ...}
 *
 * The OpenAI SDK (v6) turns such an event into an `APIError` with NO `status` (the response itself
 * was a 200), `code: 502` and the provider's message verbatim — which is why the run document said
 * exactly that and nothing else. A status-only check would therefore call it permanent. A stream
 * that is cut at the socket level surfaces differently again (`TypeError: terminated` from undici,
 * `ECONNRESET` on `cause`), and the SDK's own create-time retry never sees either, because both
 * happen after the response has started.
 *
 * Deliberately conservative in the other direction: anything that would fail the same way again
 * (bad request, authentication, out of credits, context too long, an empty answer cut off by the
 * token limit) and anything the caller asked for (an abort) is NOT transient. A false "transient"
 * costs a wasted retry; a false "permanent" only costs what it cost before this module existed.
 */

const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
// Cloudflare's 52x family, which OpenRouter sits behind.
const isCloudflareOriginError = status => status >= 520 && status <= 529

const TRANSIENT_NETWORK_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ENETDOWN',
    'EHOSTUNREACH',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CLOSED',
    'ERR_STREAM_PREMATURE_CLOSE',
])

const TRANSIENT_ERROR_NAMES = new Set(['APIConnectionError', 'APIConnectionTimeoutError'])
const ABORT_ERROR_NAMES = new Set(['AbortError', 'APIUserAbortError'])

const TRANSIENT_MESSAGE_PATTERN =
    /network connection lost|connection (?:error|reset|closed|lost|terminated)|socket hang up|^terminated$|premature close|fetch failed|other side closed|upstream (?:connect|error|timed? ?out)|provider returned error|temporarily unavailable|overloaded|server_error|bad gateway|service unavailable|gateway time-?out|stream (?:ended|closed) unexpectedly/i

function numericCode(value) {
    const number = typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : value
    return Number.isInteger(number) ? number : null
}

function isTransientStatus(status) {
    return status !== null && (TRANSIENT_STATUS_CODES.has(status) || isCloudflareOriginError(status))
}

function collectErrorChain(error) {
    const chain = []
    let current = error
    while (current && typeof current === 'object' && chain.length < 5 && !chain.includes(current)) {
        chain.push(current)
        current = current.cause
    }
    return chain
}

function isTransientModelError(error) {
    if (!error || typeof error !== 'object') return false
    const chain = collectErrorChain(error)

    if (chain.some(entry => ABORT_ERROR_NAMES.has(entry.name) || ABORT_ERROR_NAMES.has(entry.constructor?.name))) {
        return false
    }

    // An explicit HTTP status decides on its own: a 400/401/402/403/413 is permanent however its
    // message reads, and a 429/5xx is transient.
    const status = numericCode(error.status)
    if (status !== null) return isTransientStatus(status)

    for (const entry of chain) {
        if (entry.transient === true) return true
        const code = numericCode(entry.code) ?? numericCode(entry.error?.code)
        if (code !== null) {
            if (isTransientStatus(code)) return true
            // A mid-stream event carrying a permanent code (e.g. 402: out of credits) is permanent.
            if (code >= 400) return false
        }
        if (typeof entry.code === 'string' && TRANSIENT_NETWORK_CODES.has(entry.code)) return true
        if (TRANSIENT_ERROR_NAMES.has(entry.name) || TRANSIENT_ERROR_NAMES.has(entry.constructor?.name)) return true
        if (typeof entry.message === 'string' && TRANSIENT_MESSAGE_PATTERN.test(entry.message.trim())) return true
    }
    return false
}

module.exports = {
    isTransientModelError,
}
