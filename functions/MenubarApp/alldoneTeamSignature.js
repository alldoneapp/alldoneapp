'use strict'

// Server-to-server calls from alldone.team's Functions are signed with one shared secret:
//   x-alldone-timestamp: Unix seconds
//   x-alldone-signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
// Used by the Gold webhook (POST /api/menubar/gold) and the Roadmap Creator's Alldone source
// (POST /api/roadmap/source).

const crypto = require('crypto')

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

// The alldone.team side signs with one shared secret; on our side that value may live under either
// key, so callers verify against both.
function getAlldoneTeamSigningSecrets(env = {}) {
    return [env.MENUBAR_APP_WEBHOOK_SECRET, env.EXTERNAL_TOOLS_SIGNING_SECRET].filter(Boolean)
}

// Short, non-reversible fingerprint of a secret so we can tell two secrets
// apart in logs (e.g. "is MENUBAR_APP_WEBHOOK_SECRET == EXTERNAL_TOOLS_SIGNING_SECRET?")
// without ever logging the secret itself.
function secretFingerprint(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 8)
}

function signaturesMatch(providedHex, expectedHex) {
    try {
        const providedBuffer = Buffer.from(providedHex, 'hex')
        const expectedBuffer = Buffer.from(expectedHex, 'hex')
        return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    } catch (error) {
        return false
    }
}

// Verify against EVERY configured candidate secret (raw + trimmed, deduped).
// The alldone.team side signs with one shared secret, but on our side that
// value may have landed in either MENUBAR_APP_WEBHOOK_SECRET or
// EXTERNAL_TOOLS_SIGNING_SECRET, and a stray trailing newline from the CI
// env blob would also break a byte-exact compare — so we accept any match
// instead of guessing precedence.
function verifyWebhookSignature(req, candidateSecrets, logLabel = 'menubarGoldWebhook') {
    const timestampHeader = String(req.headers['x-alldone-timestamp'] || '').trim()
    const signatureHeader = String(req.headers['x-alldone-signature'] || '').trim()
    if (!timestampHeader || !signatureHeader) {
        return { valid: false, error: 'Missing signature headers' }
    }

    const timestampValue = Number(timestampHeader)
    if (!Number.isFinite(timestampValue)) {
        return { valid: false, error: 'Invalid timestamp' }
    }
    // Timestamps are unix seconds per the contract; tolerate milliseconds too.
    const timestampSeconds = timestampValue > 1e12 ? timestampValue / 1000 : timestampValue
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds)
    if (ageSeconds > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
        return { valid: false, error: 'Timestamp outside tolerance' }
    }

    // Sign over the RAW request bytes — never a re-serialized req.body, whose
    // key order / whitespace would not match the sender's digest.
    const hasRawBody = !!req.rawBody
    const rawBody = hasRawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {})
    const signingInput = `${timestampHeader}.${rawBody}`

    // Build candidate list: raw + trimmed variant of each, deduped, non-empty.
    const candidates = []
    const seen = new Set()
    candidateSecrets.forEach(secret => {
        ;[secret, typeof secret === 'string' ? secret.trim() : secret].forEach(variant => {
            if (variant && !seen.has(variant)) {
                seen.add(variant)
                candidates.push(variant)
            }
        })
    })

    for (const secret of candidates) {
        const expected = crypto.createHmac('sha256', secret).update(signingInput).digest('hex')
        if (signaturesMatch(signatureHeader, expected)) {
            return { valid: true }
        }
    }

    // No candidate matched — log enough to diagnose body-vs-secret without
    // leaking the secret. The body itself is the caller's own payload.
    console.warn(`${logLabel}: signature mismatch diagnostics`, {
        hasRawBody,
        rawBodyLength: rawBody.length,
        rawBodyPreview: rawBody.slice(0, 120),
        providedSigPrefix: signatureHeader.slice(0, 10),
        timestampAgeSeconds: Math.round(ageSeconds),
        candidates: candidates.map(secret => ({
            fingerprint: secretFingerprint(secret),
            expectedSigPrefix: crypto.createHmac('sha256', secret).update(signingInput).digest('hex').slice(0, 10),
        })),
    })

    return { valid: false, error: 'Invalid signature' }
}

module.exports = {
    WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
    getAlldoneTeamSigningSecrets,
    verifyWebhookSignature,
}
