const crypto = require('crypto')

function createRoutingToken(seed = '', secret = '') {
    if (seed && secret) {
        return crypto.createHmac('sha256', secret).update(String(seed)).digest('base64url')
    }
    return crypto.randomBytes(32).toString('base64url')
}

function hashRoutingToken(token, secret) {
    if (!token || !secret) throw new Error('Routing token and secret are required')
    return crypto.createHmac('sha256', secret).update(String(token)).digest('hex')
}

function timingSafeEqualText(left, right) {
    const leftBuffer = Buffer.from(String(left || ''))
    const rightBuffer = Buffer.from(String(right || ''))
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function getRawRequestBody(req) {
    if (Buffer.isBuffer(req?.rawBody)) return req.rawBody.toString('utf8')
    if (typeof req?.rawBody === 'string') return req.rawBody
    if (typeof req?.body === 'string') return req.body
    return JSON.stringify(req?.body || {})
}

function verifyOpenAIWebhookSignature({
    rawBody,
    webhookId,
    webhookTimestamp,
    webhookSignature,
    secret,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = 300,
}) {
    if (!rawBody || !webhookId || !webhookTimestamp || !webhookSignature || !secret) return false

    const timestamp = Number(webhookTimestamp)
    if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false

    const secretValue = String(secret).startsWith('whsec_') ? String(secret).slice(6) : String(secret)
    let secretBuffer
    try {
        secretBuffer = Buffer.from(secretValue, 'base64')
    } catch (_) {
        return false
    }
    if (secretBuffer.length === 0) return false

    const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`
    const expected = crypto.createHmac('sha256', secretBuffer).update(signedPayload).digest('base64')
    const candidates = String(webhookSignature)
        .split(/\s+/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => (part.startsWith('v1,') ? part.slice(3) : part))

    return candidates.some(candidate => timingSafeEqualText(candidate, expected))
}

function extractRoutingTokenFromSipHeaders(data = {}) {
    const headers = data.sip_headers || data.sipHeaders || []
    if (Array.isArray(headers)) {
        const routeHeader = headers.find(header => {
            const name = header?.name || header?.key || ''
            return String(name).toLowerCase() === 'x-alldone-route'
        })
        return String(routeHeader?.value || '').trim()
    }

    if (headers && typeof headers === 'object') {
        const key = Object.keys(headers).find(name => String(name).toLowerCase() === 'x-alldone-route')
        return key ? String(headers[key] || '').trim() : ''
    }

    return ''
}

module.exports = {
    createRoutingToken,
    extractRoutingTokenFromSipHeaders,
    getRawRequestBody,
    hashRoutingToken,
    verifyOpenAIWebhookSignature,
    __private__: { timingSafeEqualText },
}
