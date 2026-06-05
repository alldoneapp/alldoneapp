jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
const mockEnqueue = jest.fn()
jest.mock(
    'firebase-admin/functions',
    () => ({
        getFunctions: jest.fn(() => ({
            taskQueue: jest.fn(() => ({ enqueue: mockEnqueue })),
        })),
    }),
    { virtual: true }
)
jest.mock(
    'firebase-functions/v2/https',
    () => ({
        HttpsError: class HttpsError extends Error {
            constructor(code, message) {
                super(message)
                this.code = code
            }
        },
    }),
    { virtual: true }
)
jest.mock('../Assistant/assistantHelper', () => ({ getAssistantForChat: jest.fn() }))
jest.mock('./whatsAppDailyTopic', () => ({ getOrCreateWhatsAppDailyTopic: jest.fn() }))
jest.mock('./whatsAppIncomingHandler', () => ({ getDefaultAssistantId: jest.fn() }))
jest.mock('./whatsAppCallTwilioWebhook', () => ({ getCallEligibilityReason: jest.fn() }))
jest.mock('./whatsAppCallConfig', () => ({
    getWhatsAppCallConfig: jest.fn(),
    normalizeRealtimeVoice: jest.fn(value => value || 'marin'),
}))
jest.mock('./whatsAppCallOpenAIWebhook', () => ({
    getRunCallQueueResource: jest.fn(() => 'locations/europe-west1/functions/runWhatsAppRealtimeCall'),
    getRunCallTaskId: jest.fn(sessionId => `task-${sessionId}`),
}))
jest.mock('./whatsAppCallSessions', () => ({
    createDirectCallSessionWithLease: jest.fn(),
    finalizeCallSession: jest.fn(async () => ({})),
    updateCallSession: jest.fn(),
}))

const admin = require('firebase-admin')
const { getAssistantForChat } = require('../Assistant/assistantHelper')
const { getOrCreateWhatsAppDailyTopic } = require('./whatsAppDailyTopic')
const { getDefaultAssistantId } = require('./whatsAppIncomingHandler')
const { getCallEligibilityReason } = require('./whatsAppCallTwilioWebhook')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { createDirectCallSessionWithLease, updateCallSession } = require('./whatsAppCallSessions')
const { buildInitialBrowserRealtimeSession, startAssistantBrowserCall } = require('./assistantBrowserCall')

describe('assistant browser calls', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.FormData = class FormData {
            constructor() {
                this.values = {}
            }
            set(key, value) {
                this.values[key] = value
            }
        }
        global.fetch = jest.fn(async () => ({
            ok: true,
            text: async () => 'answer-sdp',
            headers: { get: name => (name === 'location' ? '/v1/realtime/calls/rtc_123' : null) },
        }))
        getWhatsAppCallConfig.mockReturnValue({
            browserCallsEnabled: true,
            openAiApiKey: 'key',
            realtimeModel: 'gpt-realtime-2',
            callLeaseMs: 2100000,
            maxDurationSeconds: 1800,
        })
        getCallEligibilityReason.mockReturnValue(null)
        admin.firestore.mockReturnValue({
            doc: jest.fn(() => ({
                get: jest.fn(async () => ({
                    exists: true,
                    id: 'user-1',
                    data: () => ({
                        premium: { status: 'premium' },
                        gold: 3,
                        defaultProjectId: 'project-1',
                        language: 'English',
                    }),
                })),
            })),
        })
        getDefaultAssistantId.mockResolvedValue('assistant-1')
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        createDirectCallSessionWithLease.mockResolvedValue({ success: true })
        getAssistantForChat.mockResolvedValue({ uid: 'assistant-1', realtimeVoice: 'marin' })
    })

    test('requires auth', async () => {
        await expect(startAssistantBrowserCall({ offerSdp: 'offer-sdp' }, null)).rejects.toMatchObject({
            code: 'unauthenticated',
        })
    })

    test('creates a browser call session and queues the sideband controller', async () => {
        const result = await startAssistantBrowserCall({ offerSdp: 'offer-sdp' }, { uid: 'user-1' })

        expect(result).toEqual(
            expect.objectContaining({
                projectId: 'project-1',
                chatId: 'chat-1',
                assistantId: 'assistant-1',
                answerSdp: 'answer-sdp',
            })
        )
        expect(createDirectCallSessionWithLease).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                chatId: 'chat-1',
                channel: 'browser_call',
            })
        )
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/realtime/calls',
            expect.objectContaining({ method: 'POST' })
        )
        expect(updateCallSession).toHaveBeenCalledWith(
            expect.stringMatching(/^browser-/),
            expect.objectContaining({ openAiCallId: 'rtc_123', status: 'accepted' })
        )
        expect(mockEnqueue).toHaveBeenCalled()
    })

    test('uses a minimal initial session and leaves full configuration to the sideband', () => {
        expect(
            buildInitialBrowserRealtimeSession({
                config: { realtimeModel: 'gpt-realtime-2' },
                voice: 'marin',
            })
        ).toEqual({
            type: 'realtime',
            model: 'gpt-realtime-2',
            audio: { output: { voice: 'marin' } },
        })
    })
})
