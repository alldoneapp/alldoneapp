jest.mock('firebase-admin', () => {
    let docs = new Map()
    const clone = value => JSON.parse(JSON.stringify(value))
    const doc = path => ({ path })
    const write = (path, data, merge = false) => docs.set(path, merge ? { ...(docs.get(path) || {}), ...data } : data)
    return {
        firestore: jest.fn(() => ({
            doc,
            runTransaction: async callback =>
                callback({
                    get: async ref => ({ exists: docs.has(ref.path), data: () => clone(docs.get(ref.path) || {}) }),
                    set: (ref, data, options) => write(ref.path, data, options?.merge),
                    update: (ref, data) => write(ref.path, data, true),
                    delete: ref => docs.delete(ref.path),
                }),
        })),
        __mock: {
            reset: () => {
                docs = new Map()
            },
            get: path => docs.get(path),
        },
    }
})

const admin = require('firebase-admin')
const { consumeRoutingToken, createCallSessionWithLease, finalizeCallSession } = require('./whatsAppCallSessions')

describe('WhatsApp call sessions', () => {
    beforeEach(() => admin.__mock.reset())

    test('enforces a per-user lease and consumes routing tokens once', async () => {
        const base = {
            routingSecret: 'route-secret',
            routeExpiresAt: Date.now() + 60000,
            leaseExpiresAt: Date.now() + 600000,
            userId: 'user-1',
            projectId: 'project-1',
            assistantId: 'assistant-1',
            chatId: 'chat-1',
        }
        expect(
            await createCallSessionWithLease({
                ...base,
                sessionId: 'call-1',
                twilioCallSid: 'call-1',
                routingToken: 'route-1',
            })
        ).toEqual(expect.objectContaining({ success: true }))
        expect(
            await createCallSessionWithLease({
                ...base,
                sessionId: 'call-1',
                twilioCallSid: 'call-1',
                routingToken: 'route-1',
            })
        ).toEqual(expect.objectContaining({ success: true, duplicate: true }))
        expect(
            await createCallSessionWithLease({
                ...base,
                sessionId: 'call-2',
                twilioCallSid: 'call-2',
                routingToken: 'route-2',
            })
        ).toEqual(expect.objectContaining({ success: false, reason: 'active_call' }))

        expect(
            await consumeRoutingToken({
                routingToken: 'route-1',
                routingSecret: 'route-secret',
                openAiCallId: 'openai-1',
            })
        ).toEqual(expect.objectContaining({ success: true, sessionId: 'call-1' }))
        expect(
            await consumeRoutingToken({
                routingToken: 'route-1',
                routingSecret: 'route-secret',
                openAiCallId: 'openai-1',
            })
        ).toEqual(expect.objectContaining({ success: true, duplicate: true, sessionId: 'call-1' }))
        expect(
            await consumeRoutingToken({
                routingToken: 'route-1',
                routingSecret: 'route-secret',
                openAiCallId: 'openai-2',
            })
        ).toEqual(expect.objectContaining({ success: false, reason: 'replayed_route' }))

        await finalizeCallSession('call-1', 'completed', 'completed')
        expect(admin.__mock.get('whatsAppCallLocks/user-1')).toBeUndefined()
        expect(
            await consumeRoutingToken({
                routingToken: 'route-1',
                routingSecret: 'route-secret',
                openAiCallId: 'openai-1',
            })
        ).toEqual(expect.objectContaining({ success: false, reason: 'invalid_route' }))
    })

    test('rejects expired routing tokens', async () => {
        await createCallSessionWithLease({
            sessionId: 'call-1',
            twilioCallSid: 'call-1',
            routingToken: 'route-1',
            routingSecret: 'route-secret',
            routeExpiresAt: Date.now() - 1,
            leaseExpiresAt: Date.now() + 600000,
            userId: 'user-1',
            projectId: 'project-1',
            assistantId: 'assistant-1',
            chatId: 'chat-1',
        })
        expect(
            await consumeRoutingToken({
                routingToken: 'route-1',
                routingSecret: 'route-secret',
                openAiCallId: 'openai-1',
            })
        ).toEqual(expect.objectContaining({ success: false, reason: 'expired_route' }))
    })
})
