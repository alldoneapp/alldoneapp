const mockTaskEnqueue = jest.fn()
const mockTaskQueue = jest.fn(() => ({ enqueue: mockTaskEnqueue }))
jest.mock(
    'firebase-admin/functions',
    () => ({
        getFunctions: jest.fn(() => ({ taskQueue: mockTaskQueue })),
    }),
    { virtual: true }
)
jest.mock('../Assistant/assistantHelper', () => ({ getAssistantForChat: jest.fn() }))
jest.mock('./whatsAppCallConfig', () => ({
    REGION: 'europe-west1',
    getWhatsAppCallConfig: jest.fn(),
    normalizeRealtimeVoice: jest.fn(value => value || 'marin'),
}))
jest.mock('./whatsAppCallSecurity', () => ({
    extractRoutingTokenFromSipHeaders: jest.fn(() => 'route-token'),
    getRawRequestBody: jest.fn(req => req.rawBody.toString()),
    verifyOpenAIWebhookSignature: jest.fn(() => true),
}))
jest.mock('./whatsAppCallSessions', () => ({
    FINAL_STATUSES: new Set(['completed', 'failed', 'rejected', 'stale', 'cancelled']),
    consumeRoutingToken: jest.fn(),
    finalizeCallSession: jest.fn(),
    updateCallSession: jest.fn(),
}))
jest.mock('./whatsAppCallController', () => ({ sendCallRecap: jest.fn(async () => ({})) }))
jest.mock('./assistantLiveGold', () => ({ reconcileLiveUsage: jest.fn(async () => ({ currentGold: 90 })) }))
jest.mock('../Assistant/assistantConversationStyle', () => ({ getConversationStyleInstructions: () => [] }))

const { getAssistantForChat } = require('../Assistant/assistantHelper')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { extractRoutingTokenFromSipHeaders } = require('./whatsAppCallSecurity')
const { consumeRoutingToken, finalizeCallSession, updateCallSession } = require('./whatsAppCallSessions')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const {
    buildInitialRealtimeSession,
    getRunCallTaskId,
    handleOpenAIRealtimeCallWebhook,
} = require('./whatsAppCallOpenAIWebhook')

describe('OpenAI incoming Realtime call webhook', () => {
    const config = {
        openAiApiKey: 'key',
        openAiWebhookSecret: 'secret',
        routingTokenSecret: 'route-secret',
        realtimeModel: 'gpt-realtime-2',
        transcriptionModel: 'gpt-realtime-whisper',
        reasoningEffort: 'medium',
    }

    beforeEach(() => {
        jest.clearAllMocks()
        getWhatsAppCallConfig.mockReturnValue(config)
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }))
    })

    test('builds the documented voice session configuration', () => {
        const session = buildInitialRealtimeSession({
            config,
            voice: 'marin',
            assistant: { displayName: 'Anna Alldone', instructions: 'Act as Anna.' },
        })
        expect(session).toEqual(
            expect.objectContaining({
                type: 'realtime',
                model: 'gpt-realtime-2',
                output_modalities: ['audio'],
                reasoning: { effort: 'medium' },
                audio: {
                    input: expect.objectContaining({
                        transcription: { model: 'gpt-realtime-whisper' },
                        turn_detection: expect.objectContaining({
                            type: 'semantic_vad',
                            interrupt_response: true,
                            create_response: true,
                        }),
                    }),
                    output: { voice: 'marin' },
                },
            })
        )
        expect(session.instructions).toContain('You are Anna,')
        expect(session.instructions).not.toContain('Anna Alldone')
        expect(session.instructions).toContain('Act as Anna.')
        expect(session.instructions).toContain('Never say you are ChatGPT')
        expect(session.instructions).toContain('All task IDs are silent by default')
        expect(session.tools).toBeUndefined()
    })

    test('uses deterministic hashed Cloud Task IDs for webhook retries', () => {
        expect(getRunCallTaskId('call-1')).toBe(getRunCallTaskId('call-1'))
        expect(getRunCallTaskId('call-1')).not.toBe(getRunCallTaskId('call-2'))
        expect(getRunCallTaskId('call-1')).not.toContain('call-1')
    })

    test('rejects an invalid one-use route without accepting the call', async () => {
        consumeRoutingToken.mockResolvedValue({ success: false, reason: 'expired_route' })
        const req = {
            method: 'POST',
            headers: {},
            rawBody: Buffer.from(
                JSON.stringify({
                    type: 'realtime.call.incoming',
                    data: { call_id: 'openai-call', sip_headers: [] },
                })
            ),
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleOpenAIRealtimeCallWebhook(req, res)

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/realtime/calls/openai-call/reject',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ status_code: 486 }),
            })
        )
        expect(res.status).toHaveBeenCalledWith(200)
    })

    test('rejects a call when the opaque route header is missing', async () => {
        extractRoutingTokenFromSipHeaders.mockReturnValueOnce('')
        const req = {
            method: 'POST',
            headers: {},
            rawBody: Buffer.from(
                JSON.stringify({
                    type: 'realtime.call.incoming',
                    data: { call_id: 'openai-call', sip_headers: [] },
                })
            ),
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleOpenAIRealtimeCallWebhook(req, res)

        expect(consumeRoutingToken).not.toHaveBeenCalled()
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/realtime/calls/openai-call/reject',
            expect.objectContaining({ method: 'POST' })
        )
    })

    test('accepts an eligible call and enqueues one deterministic sideband controller task', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            sessionId: 'session-1',
            session: {
                status: 'routing',
                userId: 'user-1',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                language: 'German',
            },
        })
        getAssistantForChat.mockResolvedValue({
            displayName: 'Anna Alldone',
            instructions: 'Act as Anna.',
            realtimeVoice: 'cedar',
        })
        const req = {
            method: 'POST',
            headers: {},
            rawBody: Buffer.from(
                JSON.stringify({
                    type: 'realtime.call.incoming',
                    data: { call_id: 'openai-call', sip_headers: [] },
                })
            ),
        }
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        }

        await handleOpenAIRealtimeCallWebhook(req, res)

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/realtime/calls/openai-call/accept',
            expect.objectContaining({ method: 'POST' })
        )
        const acceptBody = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(acceptBody.instructions).toContain('You are Anna,')
        expect(acceptBody.instructions).toContain('Act as Anna.')
        expect(acceptBody.instructions).toContain('All task IDs are silent by default')
        // The accepted call must carry the caller's language so the very first response is in
        // their language, not the English default, before the controller's instructions arrive.
        expect(acceptBody.instructions).toContain('Start the call in German')
        expect(mockTaskEnqueue).toHaveBeenCalledWith(
            { sessionId: 'session-1' },
            { id: getRunCallTaskId('session-1'), dispatchDeadlineSeconds: 1800 }
        )
        expect(updateCallSession).toHaveBeenCalledWith(
            'session-1',
            expect.objectContaining({ status: 'controller_queued', realtimeVoice: 'cedar' })
        )
    })
})

describe('OpenAI incoming Live SIP call webhook (phone and WhatsApp)', () => {
    const config = { openAiApiKey: 'key', openAiWebhookSecret: 'secret', routingTokenSecret: 'route-secret' }
    const routedSession = {
        status: 'routing',
        channel: 'phone_call',
        userId: 'user-1',
        projectId: 'project-1',
        assistantId: 'assistant-1',
        language: 'de',
    }
    const call = async (type = 'live.transport.incoming', data = { type: 'sip', session_id: 'live_1' }) => {
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() }
        await handleOpenAIRealtimeCallWebhook(
            { method: 'POST', headers: {}, rawBody: Buffer.from(JSON.stringify({ type, data })) },
            res
        )
        return res
    }
    const fetchedUrls = () => global.fetch.mock.calls.map(([url]) => url)

    beforeEach(() => {
        jest.clearAllMocks()
        getWhatsAppCallConfig.mockReturnValue(config)
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }))
        getAssistantForChat.mockResolvedValue({ displayName: 'Anna Alldone', realtimeVoice: 'cedar' })
        consumeRoutingToken.mockResolvedValue({ success: true, sessionId: 'CA1', session: routedSession })
        reconcileLiveUsage.mockResolvedValue({ currentGold: 90 })
    })

    test('accepts the SIP call as a gpt-live-1 session and queues the shared Live controller', async () => {
        await call()

        expect(consumeRoutingToken).toHaveBeenCalledWith(expect.objectContaining({ openAiCallId: 'live_1' }))
        expect(updateCallSession).toHaveBeenCalledWith(
            'CA1',
            expect.objectContaining({
                openAiSessionId: 'live_1',
                voiceProvider: 'gpt-live',
                voiceModel: 'gpt-live-1',
                voiceGoldPerMinute: 40,
                realtimeModel: null,
            })
        )
        expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/accept'])
        const { session } = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(session).toEqual(
            expect.objectContaining({
                type: 'live',
                model: 'gpt-live-1',
                store: false,
                delegation: { type: 'client' },
                audio: { output: { voice: 'cedar' } },
            })
        )
        expect(session.instructions).toContain('You are Anna, answering a phone call from the user.')
        expect(reconcileLiveUsage).toHaveBeenCalledWith({ sessionId: 'CA1', seconds: 15 })
        expect(mockTaskEnqueue).toHaveBeenCalledWith(
            { sessionId: 'CA1' },
            { id: getRunCallTaskId('CA1'), dispatchDeadlineSeconds: 1800 }
        )
        expect(updateCallSession).toHaveBeenCalledWith(
            'CA1',
            expect.objectContaining({ status: 'controller_queued', realtimeVoice: 'cedar' })
        )
    })

    test('accepts the deprecated live.call.incoming name during the subscription migration', async () => {
        await call('live.call.incoming', { session_id: 'live_1' })
        expect(fetchedUrls()).toEqual(['https://api.openai.com/v1/live/sessions/live_1/accept'])
    })

    test('names the WhatsApp channel in the Live prompt', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            sessionId: 'CA1',
            session: { ...routedSession, channel: 'whatsapp_call' },
        })
        await call()
        const { session } = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(session.instructions).toContain('answering a WhatsApp call from the user')
    })

    test('ignores non-SIP Live transports', async () => {
        await call('live.transport.incoming', { type: 'webrtc', session_id: 'live_1' })
        expect(consumeRoutingToken).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('rejects an invalid route through the Live reject endpoint', async () => {
        consumeRoutingToken.mockResolvedValue({ success: false, reason: 'expired_route' })
        await call()
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/live/sessions/live_1/reject',
            expect.objectContaining({ body: JSON.stringify({ status_code: 486 }) })
        )
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
    })

    test('does not reject a route already consumed by another event for the same SIP call', async () => {
        consumeRoutingToken.mockResolvedValue({ success: false, reason: 'replayed_route' })
        await call()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('does not reset voice billing when a webhook retry arrives after the first accept', async () => {
        consumeRoutingToken.mockResolvedValue({
            success: true,
            duplicate: true,
            sessionId: 'CA1',
            session: { ...routedSession, status: 'accepted', voiceProvider: 'gpt-live', acceptCompletedAt: 1 },
        })
        await call()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(updateCallSession).not.toHaveBeenCalledWith('CA1', expect.objectContaining({ voiceBilledGold: 0 }))
        expect(mockTaskEnqueue).toHaveBeenCalled()
    })

    test('hangs up and settles the call when the Gold minimum cannot be charged', async () => {
        reconcileLiveUsage.mockResolvedValue({ insufficientBalance: true, currentGold: 0 })
        await call()
        expect(fetchedUrls()).toContain('https://api.openai.com/v1/live/sessions/live_1/hangup')
        expect(finalizeCallSession).toHaveBeenCalledWith('CA1', 'openai_accept_failed', 'failed')
        expect(mockTaskEnqueue).not.toHaveBeenCalled()
    })
})
