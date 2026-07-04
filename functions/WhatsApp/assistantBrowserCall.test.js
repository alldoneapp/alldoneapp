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
const { getDefaultAssistantId } = require('./whatsAppIncomingHandler')
const { getCallEligibilityReason } = require('./whatsAppCallTwilioWebhook')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { createDirectCallSessionWithLease, updateCallSession } = require('./whatsAppCallSessions')
const {
    buildInitialBrowserRealtimeSession,
    resolveBrowserCallTopic,
    startAssistantBrowserCall,
} = require('./assistantBrowserCall')

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
            doc: jest.fn(path => ({
                get: jest.fn(async () => {
                    if (path === 'users/user-1') {
                        return {
                            exists: true,
                            id: 'user-1',
                            data: () => ({
                                premium: { status: 'premium' },
                                gold: 3,
                                defaultProjectId: 'project-1',
                                language: 'English',
                            }),
                        }
                    }
                    if (path === 'chatObjects/project-1/chats/chat-1') {
                        return {
                            exists: true,
                            id: 'chat-1',
                            data: () => ({
                                type: 'topics',
                                assistantId: 'assistant-1',
                                creatorId: 'user-1',
                                members: ['user-1'],
                            }),
                        }
                    }
                    return { exists: false, id: path.split('/').pop(), data: () => null }
                }),
            })),
        })
        getDefaultAssistantId.mockResolvedValue('assistant-1')
        createDirectCallSessionWithLease.mockResolvedValue({ success: true })
        getAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna Alldone',
            instructions: 'Act as Anna.',
            realtimeVoice: 'marin',
        })
    })

    test('requires auth', async () => {
        await expect(startAssistantBrowserCall({ offerSdp: 'offer-sdp' }, null)).rejects.toMatchObject({
            code: 'unauthenticated',
        })
    })

    test('creates a browser call session and queues the sideband controller', async () => {
        const result = await startAssistantBrowserCall(
            { offerSdp: 'offer-sdp', projectId: 'project-1', chatId: 'chat-1', assistantId: 'assistant-1' },
            { uid: 'user-1' }
        )

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
        const initialSession = JSON.parse(global.fetch.mock.calls[0][1].body.values.session)
        expect(initialSession.instructions).toContain('Act as Anna.')
        expect(initialSession.instructions).toContain('Task IDs are silent by default')
        expect(initialSession.instructions).toContain('Start the call in English')
        expect(updateCallSession).toHaveBeenCalledWith(
            expect.stringMatching(/^browser-/),
            expect.objectContaining({ openAiCallId: 'rtc_123', status: 'accepted' })
        )
        expect(mockEnqueue).toHaveBeenCalled()
    })

    test('forwards SDP without trimming protocol line endings', async () => {
        const offerSdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'

        await startAssistantBrowserCall(
            { offerSdp, projectId: 'project-1', chatId: 'chat-1', assistantId: 'assistant-1' },
            { uid: 'user-1' }
        )

        expect(global.fetch.mock.calls[0][1].body.values.sdp).toBe(offerSdp)
    })

    test('requires an explicit browser call topic', async () => {
        await expect(startAssistantBrowserCall({ offerSdp: 'offer-sdp' }, { uid: 'user-1' })).rejects.toMatchObject({
            code: 'failed-precondition',
        })
    })

    test('resolves an existing browser call topic', async () => {
        await expect(
            resolveBrowserCallTopic(
                { projectId: 'project-1', chatId: 'chat-1', assistantId: 'assistant-1' },
                { defaultProjectId: 'project-1' },
                'user-1'
            )
        ).resolves.toEqual({ projectId: 'project-1', chatId: 'chat-1', assistantId: 'assistant-1' })
    })

    test('protects the browser call with the special prompt before the sideband connects', () => {
        expect(
            buildInitialBrowserRealtimeSession({
                config: { realtimeModel: 'gpt-realtime-2' },
                voice: 'marin',
                assistant: { displayName: 'Anna Alldone', instructions: 'Act as Anna.' },
                language: 'German',
            })
        ).toEqual(
            expect.objectContaining({
                type: 'realtime',
                model: 'gpt-realtime-2',
                instructions: expect.stringContaining('Task IDs are silent by default'),
                audio: { output: { voice: 'marin' } },
            })
        )
    })
})
