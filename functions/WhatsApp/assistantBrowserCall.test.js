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
jest.mock('./assistantLiveController', () => ({ closeLiveSession: jest.fn(async () => true) }))
jest.mock('./assistantLiveGold', () => ({ reconcileLiveUsage: jest.fn(async () => ({ currentGold: 90 })) }))
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
    buildInitialBrowserLiveSession,
    resolveBrowserCallTopic,
    startAssistantBrowserCall,
    getAssistantBrowserCallSummary,
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
            text: async () => JSON.stringify({ session: { id: 'live_123' }, transport: { sdp: 'answer-sdp' } }),
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
                                gold: 100,
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
        await expect(
            startAssistantBrowserCall({ voiceProtocol: 'gpt-live-v2', offerSdp: 'offer-sdp' }, null)
        ).rejects.toMatchObject({
            code: 'unauthenticated',
        })
    })

    test('creates a browser call session and queues the sideband controller', async () => {
        const result = await startAssistantBrowserCall(
            {
                voiceProtocol: 'gpt-live-v2',
                offerSdp: 'offer-sdp',
                projectId: 'project-1',
                chatId: 'chat-1',
                assistantId: 'assistant-1',
            },
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
            'https://api.openai.com/v1/live/sessions',
            expect.objectContaining({ method: 'POST' })
        )
        const initialSession = JSON.parse(global.fetch.mock.calls[0][1].body).session
        expect(initialSession.delegation).toEqual({ type: 'client' })
        expect(initialSession.model).toBe('gpt-live-1')
        expect(initialSession.store).toBe(false)
        expect(initialSession.instructions).toContain('All task IDs and URLs are silent by default')
        expect(initialSession.instructions).toContain('Start the call in English')
        expect(updateCallSession).toHaveBeenCalledWith(
            expect.stringMatching(/^browser-/),
            expect.objectContaining({ openAiSessionId: 'live_123', status: 'accepted' })
        )
        expect(mockEnqueue).toHaveBeenCalled()
    })

    test('forwards SDP without trimming protocol line endings', async () => {
        const offerSdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'

        await startAssistantBrowserCall(
            {
                voiceProtocol: 'gpt-live-v2',
                offerSdp,
                projectId: 'project-1',
                chatId: 'chat-1',
                assistantId: 'assistant-1',
            },
            { uid: 'user-1' }
        )

        expect(JSON.parse(global.fetch.mock.calls[0][1].body).transport.sdp).toBe(offerSdp)
    })

    test('requires an explicit browser call topic', async () => {
        await expect(
            startAssistantBrowserCall({ voiceProtocol: 'gpt-live-v2', offerSdp: 'offer-sdp' }, { uid: 'user-1' })
        ).rejects.toMatchObject({
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
            buildInitialBrowserLiveSession({
                config: { realtimeModel: 'gpt-realtime-2' },
                voice: 'marin',
                assistant: { displayName: 'Anna Alldone', instructions: 'Act as Anna.' },
                language: 'German',
            })
        ).toEqual(
            expect.objectContaining({
                delegation: { type: 'client' },
                model: 'gpt-live-1',
                instructions: expect.stringContaining('All task IDs and URLs are silent by default'),
                audio: { output: { voice: 'marin' } },
            })
        )
    })
})

const { closeLiveSession } = require('./assistantLiveController')
const { reconcileLiveUsage } = require('./assistantLiveGold')
describe('Live startup failures and usage privacy', () => {
    const request = {
        voiceProtocol: 'gpt-live-v2',
        offerSdp: 'offer',
        projectId: 'project-1',
        chatId: 'chat-1',
        assistantId: 'assistant-1',
    }
    beforeEach(() => {
        jest.clearAllMocks()
        mockEnqueue.mockReset()
        getWhatsAppCallConfig.mockReturnValue({
            browserCallsEnabled: true,
            openAiApiKey: 'key',
            callLeaseMs: 1000,
            maxDurationSeconds: 60,
        })
        getCallEligibilityReason.mockReturnValue(null)
        createDirectCallSessionWithLease.mockResolvedValue({ success: true })
        getAssistantForChat.mockResolvedValue({ displayName: 'Anna' })
        admin.firestore.mockReturnValue({
            doc: path => ({
                get: async () => ({
                    exists: true,
                    id: path.split('/').pop(),
                    data: () =>
                        path.startsWith('users/')
                            ? { gold: 100 }
                            : {
                                  type: 'topics',
                                  creatorId: 'user-1',
                                  assistantId: 'assistant-1',
                                  userId: 'user-1',
                                  voiceBilledGold: 40,
                                  backendBilledGold: 12,
                                  status: 'completed',
                                  voiceUsageFinal: true,
                                  secret: 'never expose',
                              },
                }),
            }),
        })
    })
    test.each([undefined, 'gpt-live-v1'])(
        'rejects old client protocol %s before opening a paid session',
        async voiceProtocol => {
            await expect(
                startAssistantBrowserCall({ ...request, voiceProtocol }, { uid: 'user-1' })
            ).rejects.toMatchObject({ code: 'failed-precondition' })
            expect(createDirectCallSessionWithLease).not.toHaveBeenCalled()
            expect(reconcileLiveUsage).not.toHaveBeenCalled()
        }
    )
    test.each(['missing SDP', 'queue failure'])('closes a created provider session after %s', async kind => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            text: async () =>
                JSON.stringify({
                    session: { id: 'live_failed' },
                    transport: kind === 'missing SDP' ? {} : { sdp: 'answer' },
                }),
        }))
        if (kind === 'queue failure') mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))
        await expect(startAssistantBrowserCall(request, { uid: 'user-1' })).rejects.toMatchObject({ code: 'internal' })
        expect(closeLiveSession).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ openAiSessionId: 'live_failed' })
        )
    })
    test('only exposes the owner usage totals', async () => {
        await expect(getAssistantBrowserCallSummary({ sessionId: 'browser-123' }, { uid: 'user-1' })).resolves.toEqual({
            voiceGold: 40,
            assistantGold: 12,
            settled: true,
            finalVoiceUsage: true,
            controllerConnected: false,
        })
        await expect(
            getAssistantBrowserCallSummary({ sessionId: 'browser-123' }, { uid: 'other' })
        ).rejects.toMatchObject({ code: 'not-found' })
        await expect(
            getAssistantBrowserCallSummary({ sessionId: '../users' }, { uid: 'user-1' })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })
})

describe('cancel abandoned Live startup', () => {
    const { endAssistantBrowserCall } = require('./assistantBrowserCall')
    let update
    beforeEach(() => {
        jest.clearAllMocks()
        update = jest.fn(async () => {})
        admin.firestore.mockReturnValue({
            doc: () => ({
                update,
                get: async () => ({
                    exists: true,
                    data: () => ({
                        userId: 'owner',
                        voiceProvider: 'gpt-live',
                        openAiSessionId: 'live_owned',
                        status: 'controller_running',
                    }),
                }),
            }),
        })
        closeLiveSession.mockResolvedValue(true)
    })
    test('requires ownership before cancellation or access to the provider session', async () => {
        await expect(endAssistantBrowserCall({ sessionId: 'browser-owned' }, { uid: 'other' })).rejects.toMatchObject({
            code: 'not-found',
        })
        expect(update).not.toHaveBeenCalled()
        expect(closeLiveSession).not.toHaveBeenCalled()
    })
    test('records cancellation before closing the provider session', async () => {
        await expect(endAssistantBrowserCall({ sessionId: 'browser-owned' }, { uid: 'owner' })).resolves.toEqual({
            closed: true,
        })
        expect(update).toHaveBeenCalledWith({ cancelRequestedAt: expect.any(Number), controllerConnected: false })
        expect(closeLiveSession).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ id: 'browser-owned', openAiSessionId: 'live_owned' })
        )
    })
})
