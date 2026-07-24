jest.mock('firebase-admin', () => {
    let docs = new Map()
    let autoId = 0
    const clone = value => JSON.parse(JSON.stringify(value))
    const applyWrite = (path, data, merge = false) => {
        const next = merge ? { ...(docs.get(path) || {}) } : {}
        Object.entries(data).forEach(([key, value]) => {
            next[key] =
                value && typeof value.__increment === 'number' ? (Number(next[key]) || 0) + value.__increment : value
        })
        docs.set(path, next)
    }
    const doc = path => ({
        path,
        collection: name => ({ doc: id => doc(`${path}/${name}/${id || `auto-${++autoId}`}`) }),
        get: async () => ({ exists: docs.has(path), data: () => clone(docs.get(path) || {}) }),
        set: (data, options) => applyWrite(path, data, options?.merge),
        update: data => applyWrite(path, data, true),
        delete: () => docs.delete(path),
    })
    const firestore = jest.fn(() => ({
        doc,
        runTransaction: async callback =>
            callback({
                get: async ref => ({ exists: docs.has(ref.path), data: () => clone(docs.get(ref.path) || {}) }),
                set: (ref, data, options) => applyWrite(ref.path, data, options?.merge),
                update: (ref, data) => applyWrite(ref.path, data, true),
                delete: ref => docs.delete(ref.path),
            }),
    }))
    firestore.FieldValue = {
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        increment: value => ({ __increment: value }),
    }
    firestore.Timestamp = { now: () => 'TIMESTAMP' }
    return {
        firestore,
        __mock: {
            reset: () => {
                docs = new Map()
                autoId = 0
            },
            set: (path, data) => docs.set(path, clone(data)),
            get: path => docs.get(path),
            list: prefix => Array.from(docs.entries()).filter(([path]) => path.startsWith(prefix)),
        },
    }
})

jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }), { virtual: true })
jest.mock('../Assistant/assistantHelper', () => ({ getAssistantForChat: jest.fn() }))
jest.mock('../Services/TwilioWhatsAppService', () => jest.fn())
jest.mock('../Utils/HelperFunctionsCloud', () => ({ STAYWARD_COMMENT: 'STAYWARD_COMMENT' }))
jest.mock('./whatsAppDailyTopic', () => ({ getOrCreateWhatsAppDailyTopic: jest.fn() }))
jest.mock('./whatsAppIncomingHandler', () => ({
    findUserByPhone: jest.fn(),
    getDefaultAssistantId: jest.fn(),
    normalizePhoneNumber: jest.fn(),
}))
jest.mock('./whatsAppCallConfig', () => ({
    REGION: 'europe-west1',
    getWhatsAppCallConfig: jest.fn(),
    normalizeRealtimeVoice: jest.fn(value => value || 'marin'),
}))

const admin = require('firebase-admin')
const { buildInitialRealtimeSession } = require('./whatsAppCallOpenAIWebhook')
const { reconcileCallUsage } = require('./whatsAppCallGold')
const { consumeRoutingToken, createCallSessionWithLease, finalizeCallSession } = require('./whatsAppCallSessions')
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')
const { buildSipTwiML } = require('./whatsAppCallTwilioWebhook')

describe('mocked WhatsApp assistant call flow', () => {
    beforeEach(() => admin.__mock.reset())

    test('routes, accepts, transcribes, bills, finalizes, and persists the recap idempotently', async () => {
        const now = Date.now()
        admin.__mock.set('users/user-1', { gold: 5 })
        admin.__mock.set('chatObjects/project-1/chats/chat-1', { commentsData: { amount: 0 } })

        const twiml = buildSipTwiML({
            openAiProjectId: 'proj_openai',
            routingToken: 'opaque-route',
            statusCallbackUrl: 'https://example.test/status',
        })
        expect(twiml).toContain('x-alldone-route=opaque-route')
        expect(twiml).not.toContain('record=')

        await createCallSessionWithLease({
            sessionId: 'twilio-call-1',
            twilioCallSid: 'twilio-call-1',
            routingToken: 'opaque-route',
            routingSecret: 'route-secret',
            routeExpiresAt: now + 60000,
            leaseExpiresAt: now + 1800000,
            userId: 'user-1',
            projectId: 'project-1',
            assistantId: 'assistant-1',
            chatId: 'chat-1',
        })
        const consumed = await consumeRoutingToken({
            routingToken: 'opaque-route',
            routingSecret: 'route-secret',
            openAiCallId: 'openai-call-1',
        })
        expect(consumed).toEqual(expect.objectContaining({ success: true, sessionId: 'twilio-call-1' }))
        expect(
            buildInitialRealtimeSession({
                config: {
                    realtimeModel: 'gpt-realtime-2',
                    transcriptionModel: 'gpt-realtime-whisper',
                    reasoningEffort: 'medium',
                },
                voice: 'marin',
            })
        ).toEqual(expect.objectContaining({ model: 'gpt-realtime-2', output_modalities: ['audio'] }))

        const turn = {
            sessionId: 'twilio-call-1',
            projectId: 'project-1',
            chatId: 'chat-1',
            userId: 'user-1',
            assistantId: 'assistant-1',
        }
        await storeCallTranscriptTurn({ ...turn, turnId: 'user-turn-1', role: 'user', text: 'Create a task.' })
        await storeCallTranscriptTurn({ ...turn, turnId: 'user-turn-1', role: 'user', text: 'Create a task.' })
        await storeCallTranscriptTurn({ ...turn, turnId: 'assistant-turn-1', role: 'assistant', text: 'Done.' })

        await reconcileCallUsage({ sessionId: 'twilio-call-1', eventId: 'response-1', totalTokens: 200 })
        await reconcileCallUsage({ sessionId: 'twilio-call-1', eventId: 'response-1', totalTokens: 200 })
        await finalizeCallSession('twilio-call-1', 'twilio_completed', 'completed')
        await storeCallTranscriptTurn({
            ...turn,
            turnId: 'post_call_recap',
            role: 'assistant',
            text: 'Call recap: A task was created.',
        })
        await storeCallTranscriptTurn({
            ...turn,
            turnId: 'post_call_recap',
            role: 'assistant',
            text: 'Call recap: A task was created.',
        })

        expect(admin.__mock.get('users/user-1').gold).toBe(3)
        expect(admin.__mock.get('whatsAppCallSessions/twilio-call-1')).toEqual(
            expect.objectContaining({
                status: 'completed',
                openAiCallId: 'openai-call-1',
                totalTokens: 200,
                billedGold: 2,
                transcriptTurnCount: 3,
            })
        )
        expect(admin.__mock.get('whatsAppCallLocks/user-1')).toBeUndefined()
        expect(admin.__mock.list('chatComments/project-1/topics/chat-1/comments/')).toHaveLength(3)
        expect(admin.__mock.list('users/user-1/goldTransactions/')).toHaveLength(1)

        // The assistant's spoken turns + recap point the MyDay AssistantLine "Last comment" bubble
        // at the daily WhatsApp topic (the chat-doc commentsData alone only feeds the Chats list).
        const userDoc = admin.__mock.get('users/user-1')
        expect(userDoc['lastAssistantCommentData.project-1']).toEqual(
            expect.objectContaining({ objectType: 'topics', objectId: 'chat-1', creatorId: 'assistant-1' })
        )
        expect(userDoc['lastAssistantCommentData.allProjects']).toEqual(
            expect.objectContaining({ objectType: 'topics', objectId: 'chat-1', projectId: 'project-1' })
        )
    })
})
