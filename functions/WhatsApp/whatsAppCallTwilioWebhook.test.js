jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
const mockValidateWebhookSignature = jest.fn(() => true)
const mockSendWhatsAppMessage = jest.fn(async () => ({ success: true }))
jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        validateWebhookSignature: mockValidateWebhookSignature,
        sendWhatsAppMessage: mockSendWhatsAppMessage,
    }))
)
jest.mock('./whatsAppDailyTopic', () => ({ getOrCreateWhatsAppDailyTopic: jest.fn() }))
jest.mock('./whatsAppIncomingHandler', () => ({
    findUserByPhone: jest.fn(),
    getDefaultAssistantId: jest.fn(),
    normalizePhoneNumber: jest.fn(),
}))
jest.mock('./whatsAppCallSecurity', () => ({ createRoutingToken: jest.fn() }))
jest.mock('./whatsAppCallSessions', () => ({
    createCallSessionWithLease: jest.fn(),
    finalizeCallSession: jest.fn(),
    updateCallSession: jest.fn(),
}))
jest.mock('./whatsAppCallConfig', () => ({ getWhatsAppCallConfig: jest.fn() }))

const admin = require('firebase-admin')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { getOrCreateWhatsAppDailyTopic } = require('./whatsAppDailyTopic')
const { findUserByPhone, getDefaultAssistantId, normalizePhoneNumber } = require('./whatsAppIncomingHandler')
const { createRoutingToken } = require('./whatsAppCallSecurity')
const { createCallSessionWithLease, finalizeCallSession } = require('./whatsAppCallSessions')
const {
    buildSipTwiML,
    getCallEligibilityReason,
    getPhoneRejectionMessage,
    getRejectionMessage,
    handleIncomingPhoneCall,
    handleIncomingWhatsAppCall,
    handlePhoneCallStatus,
    handleWhatsAppCallStatus,
    validateTwilioRequest,
} = require('./whatsAppCallTwilioWebhook')

describe('WhatsApp call Twilio routing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockValidateWebhookSignature.mockReturnValue(true)
        getWhatsAppCallConfig.mockReturnValue({ twilioStatusCallbackUrl: 'https://example.test/status' })
    })

    test('builds TLS SIP TwiML with an opaque custom header and no recording', () => {
        const xml = buildSipTwiML({
            openAiProjectId: 'project-123',
            routingToken: 'opaque-route',
            statusCallbackUrl: 'https://example.test/status',
        })
        expect(xml).toContain('sip:project-123@sip.api.openai.com;transport=tls?x-alldone-route=opaque-route')
        expect(xml).toContain('statusCallback="https://example.test/status"')
        expect(xml).not.toContain('record=')
        expect(xml).not.toContain('<Record')
    })

    test('enforces feature flag, linked premium user, Gold, and default project', () => {
        const eligibleUser = { premium: { status: 'premium' }, gold: 2, defaultProjectId: 'project-1' }
        expect(getCallEligibilityReason({ config: { enabled: false }, user: eligibleUser })).toBe('disabled')
        expect(getCallEligibilityReason({ config: { enabled: true }, user: null })).toBe('unlinked')
        expect(
            getCallEligibilityReason({
                config: { enabled: true },
                user: { ...eligibleUser, premium: { status: 'free' } },
            })
        ).toBe('premium_required')
        expect(getCallEligibilityReason({ config: { enabled: true }, user: { ...eligibleUser, gold: 0 } })).toBe(
            'gold_required'
        )
        expect(
            getCallEligibilityReason({ config: { enabled: true }, user: { ...eligibleUser, defaultProjectId: '' } })
        ).toBe('missing_project')
        expect(getCallEligibilityReason({ config: { enabled: true }, user: eligibleUser })).toBe(null)
    })

    test('provides a caller-facing reason for active-call rejection', () => {
        expect(getRejectionMessage('active_call')).toContain('active assistant call')
        expect(getPhoneRejectionMessage('active_call')).toContain('active assistant call')
    })

    test('validates Twilio signatures against the exact configured webhook URL', () => {
        const req = { headers: { 'x-twilio-signature': 'signature' }, body: { CallSid: 'call-1' } }

        expect(validateTwilioRequest(req, 'https://example.test/incoming')).toBe(true)
        expect(mockValidateWebhookSignature).toHaveBeenCalledWith(
            'signature',
            'https://example.test/incoming',
            req.body
        )
    })

    test('prioritizes terminal DialCallStatus and returns valid empty TwiML', async () => {
        const req = {
            method: 'POST',
            headers: { 'x-twilio-signature': 'signature' },
            body: { CallSid: 'call-1', CallStatus: 'in-progress', DialCallStatus: 'completed' },
        }
        const res = {
            type: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleWhatsAppCallStatus(req, res)

        expect(finalizeCallSession).toHaveBeenCalledWith('call-1', 'twilio_completed', 'completed')
        expect(res.type).toHaveBeenCalledWith('text/xml')
        expect(res.send.mock.calls[0][0]).toContain('<Response')
    })

    test('routes an eligible caller through the existing default assistant and daily topic', async () => {
        const user = {
            premium: { status: 'premium' },
            gold: 3,
            defaultProjectId: 'project-1',
        }
        getWhatsAppCallConfig.mockReturnValue({
            enabled: true,
            openAiApiKey: 'key',
            openAiProjectId: 'openai-project',
            openAiWebhookSecret: 'webhook-secret',
            routingTokenSecret: 'route-secret',
            routeTokenTtlMs: 120000,
            callLeaseMs: 2100000,
            maxDurationSeconds: 1800,
            twilioIncomingCallUrl: 'https://example.test/incoming',
            twilioStatusCallbackUrl: 'https://example.test/status',
        })
        normalizePhoneNumber.mockReturnValue('+1234567890')
        findUserByPhone.mockResolvedValue('user-1')
        admin.firestore.mockReturnValue({
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: true, id: 'user-1', data: () => user })),
            })),
        })
        getDefaultAssistantId.mockResolvedValue('assistant-1')
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        createRoutingToken.mockReturnValue('opaque-route')
        createCallSessionWithLease.mockResolvedValue({ success: true })
        const req = {
            method: 'POST',
            headers: { 'x-twilio-signature': 'signature' },
            body: { CallSid: 'call-1', From: 'whatsapp:+1234567890' },
        }
        const res = {
            type: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingWhatsAppCall(req, res)

        expect(getDefaultAssistantId).toHaveBeenCalledWith(expect.objectContaining(user), 'project-1')
        expect(getOrCreateWhatsAppDailyTopic).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            'assistant-1',
            expect.objectContaining(user)
        )
        expect(createCallSessionWithLease).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'call-1',
                routingToken: 'opaque-route',
                userId: 'user-1',
                assistantId: 'assistant-1',
                chatId: 'chat-1',
            })
        )
        expect(res.send.mock.calls[0][0]).toContain('x-alldone-route=opaque-route')
    })

    test('routes an eligible phone caller through the shared SIP bridge', async () => {
        const user = {
            premium: { status: 'premium' },
            gold: 3,
            defaultProjectId: 'project-1',
        }
        getWhatsAppCallConfig.mockReturnValue({
            phoneCallsEnabled: true,
            openAiApiKey: 'key',
            openAiProjectId: 'openai-project',
            openAiWebhookSecret: 'webhook-secret',
            routingTokenSecret: 'route-secret',
            routeTokenTtlMs: 120000,
            callLeaseMs: 2100000,
            maxDurationSeconds: 1800,
            phoneIncomingCallUrl: 'https://example.test/phone',
            phoneStatusCallbackUrl: 'https://example.test/phone-status',
        })
        normalizePhoneNumber.mockReturnValue('+1234567890')
        findUserByPhone.mockResolvedValue('user-1')
        admin.firestore.mockReturnValue({
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: true, id: 'user-1', data: () => user })),
            })),
        })
        getDefaultAssistantId.mockResolvedValue('assistant-1')
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        createRoutingToken.mockReturnValue('phone-route')
        createCallSessionWithLease.mockResolvedValue({ success: true })
        const req = {
            method: 'POST',
            headers: { 'x-twilio-signature': 'signature' },
            body: { CallSid: 'call-1', From: '+1234567890' },
        }
        const res = {
            type: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleIncomingPhoneCall(req, res)

        expect(createCallSessionWithLease).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'call-1',
                channel: 'phone_call',
                routingToken: 'phone-route',
                userId: 'user-1',
            })
        )
        expect(res.send.mock.calls[0][0]).toContain('statusCallback="https://example.test/phone-status"')
        expect(res.send.mock.calls[0][0]).toContain('x-alldone-route=phone-route')
    })

    test('phone status callback uses the configured phone callback URL', async () => {
        getWhatsAppCallConfig.mockReturnValue({ phoneStatusCallbackUrl: 'https://example.test/phone-status' })
        const req = {
            method: 'POST',
            headers: { 'x-twilio-signature': 'signature' },
            body: { CallSid: 'call-1', CallStatus: 'completed' },
        }
        const res = {
            type: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handlePhoneCallStatus(req, res)

        expect(mockValidateWebhookSignature).toHaveBeenCalledWith(
            'signature',
            'https://example.test/phone-status',
            req.body
        )
        expect(finalizeCallSession).toHaveBeenCalledWith('call-1', 'twilio_completed', 'completed')
    })
})
