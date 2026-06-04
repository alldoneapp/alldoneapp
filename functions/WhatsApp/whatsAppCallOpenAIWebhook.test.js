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
jest.mock('./whatsAppCallController', () => ({ sendCallRecap: jest.fn() }))

const { getAssistantForChat } = require('../Assistant/assistantHelper')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { extractRoutingTokenFromSipHeaders } = require('./whatsAppCallSecurity')
const { consumeRoutingToken, updateCallSession } = require('./whatsAppCallSessions')
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
