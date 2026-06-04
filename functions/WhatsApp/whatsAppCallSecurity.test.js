const crypto = require('crypto')
const {
    createRoutingToken,
    extractRoutingTokenFromSipHeaders,
    hashRoutingToken,
    verifyOpenAIWebhookSignature,
} = require('./whatsAppCallSecurity')

describe('WhatsApp call security', () => {
    test('creates opaque routing tokens and hashes them with the configured secret', () => {
        const token = createRoutingToken()
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(token).not.toContain('.')
        expect(hashRoutingToken(token, 'secret')).toHaveLength(64)
        expect(hashRoutingToken(token, 'secret')).not.toBe(hashRoutingToken(token, 'different-secret'))
    })

    test('creates deterministic opaque routes for duplicate Twilio webhooks', () => {
        expect(createRoutingToken('call-1', 'secret')).toBe(createRoutingToken('call-1', 'secret'))
        expect(createRoutingToken('call-1', 'secret')).not.toBe(createRoutingToken('call-2', 'secret'))
    })

    test('validates a current OpenAI Standard Webhook signature', () => {
        const secretBytes = Buffer.from('webhook-secret')
        const secret = `whsec_${secretBytes.toString('base64')}`
        const rawBody = JSON.stringify({ type: 'realtime.call.incoming' })
        const webhookId = 'wh_123'
        const timestamp = 1770000000
        const signature = crypto
            .createHmac('sha256', secretBytes)
            .update(`${webhookId}.${timestamp}.${rawBody}`)
            .digest('base64')

        expect(
            verifyOpenAIWebhookSignature({
                rawBody,
                webhookId,
                webhookTimestamp: String(timestamp),
                webhookSignature: `v1,${signature}`,
                secret,
                nowSeconds: timestamp + 30,
            })
        ).toBe(true)
    })

    test('rejects stale and altered OpenAI webhook signatures', () => {
        const secretBytes = Buffer.from('webhook-secret')
        const secret = `whsec_${secretBytes.toString('base64')}`
        const rawBody = '{}'
        const signature = crypto.createHmac('sha256', secretBytes).update(`wh_123.1000.${rawBody}`).digest('base64')

        expect(
            verifyOpenAIWebhookSignature({
                rawBody,
                webhookId: 'wh_123',
                webhookTimestamp: '1000',
                webhookSignature: `v1,${signature}`,
                secret,
                nowSeconds: 2000,
            })
        ).toBe(false)
        expect(
            verifyOpenAIWebhookSignature({
                rawBody: '{"altered":true}',
                webhookId: 'wh_123',
                webhookTimestamp: '1000',
                webhookSignature: `v1,${signature}`,
                secret,
                nowSeconds: 1000,
            })
        ).toBe(false)
    })

    test('extracts the opaque route from SIP headers case-insensitively', () => {
        expect(
            extractRoutingTokenFromSipHeaders({
                sip_headers: [{ name: 'X-Alldone-Route', value: 'route-token' }],
            })
        ).toBe('route-token')
    })
})
