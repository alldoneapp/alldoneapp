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
    })
    const firestore = jest.fn(() => ({
        doc,
        runTransaction: async callback =>
            callback({
                get: async ref => ({ exists: docs.has(ref.path), data: () => clone(docs.get(ref.path) || {}) }),
                set: (ref, data, options) => applyWrite(ref.path, data, options?.merge),
                update: (ref, data) => applyWrite(ref.path, data, true),
            }),
    }))
    firestore.FieldValue = {
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        increment: value => ({ __increment: value }),
    }
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

const admin = require('firebase-admin')
const { calculateCallGold, reconcileCallUsage } = require('./whatsAppCallGold')

describe('WhatsApp call Gold reconciliation', () => {
    beforeEach(() => admin.__mock.reset())

    test('uses the existing 100 tokens per Gold baseline with a one-Gold minimum', () => {
        expect(calculateCallGold(0)).toBe(0)
        expect(calculateCallGold(1)).toBe(1)
        expect(calculateCallGold(149)).toBe(1)
        expect(calculateCallGold(150)).toBe(2)
    })

    test('charges cumulative unique response usage exactly once', async () => {
        admin.__mock.set('users/user-1', { gold: 10 })
        admin.__mock.set('whatsAppCallSessions/call-1', {
            userId: 'user-1',
            projectId: 'project-1',
            chatId: 'chat-1',
            totalTokens: 0,
            billedGold: 0,
        })

        const first = await reconcileCallUsage({ sessionId: 'call-1', eventId: 'response-1', totalTokens: 120 })
        const duplicate = await reconcileCallUsage({ sessionId: 'call-1', eventId: 'response-1', totalTokens: 120 })
        const second = await reconcileCallUsage({ sessionId: 'call-1', eventId: 'response-2', totalTokens: 80 })

        expect(first.chargedGold).toBe(1)
        expect(duplicate.duplicate).toBe(true)
        expect(second.chargedGold).toBe(1)
        expect(admin.__mock.get('users/user-1').gold).toBe(8)
        expect(admin.__mock.get('whatsAppCallSessions/call-1')).toEqual(
            expect.objectContaining({ totalTokens: 200, billedGold: 2 })
        )
        expect(admin.__mock.list('users/user-1/goldTransactions/')).toHaveLength(2)
    })

    test('deducts the remaining Gold and reports exhaustion', async () => {
        admin.__mock.set('users/user-1', { gold: 1 })
        admin.__mock.set('whatsAppCallSessions/call-1', {
            userId: 'user-1',
            projectId: 'project-1',
            chatId: 'chat-1',
            totalTokens: 0,
            billedGold: 0,
        })
        const result = await reconcileCallUsage({ sessionId: 'call-1', eventId: 'response-1', totalTokens: 300 })
        expect(result).toEqual(expect.objectContaining({ chargedGold: 1, insufficientBalance: true, currentGold: 0 }))
    })
})
