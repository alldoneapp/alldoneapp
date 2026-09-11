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
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { calculateLiveVoiceGold } = require('./assistantLivePricing')

beforeEach(() => {
    admin.__mock.reset()
    admin.__mock.set('users/u', { gold: 1000 })
    admin.__mock.set('whatsAppCallSessions/s', {
        userId: 'u',
        voiceProvider: 'gpt-live',
        voiceModel: 'gpt-live-1',
        voiceGoldPerMinute: 40,
        billedGold: 0,
    })
})
test('charges seconds cumulatively, includes the startup minimum, and ignores duplicate/out of order snapshots', async () => {
    expect(calculateLiveVoiceGold(0)).toBe(10)
    expect(calculateLiveVoiceGold(90)).toBe(60)
    await reconcileLiveUsage({ sessionId: 's', seconds: 15 })
    await reconcileLiveUsage({ sessionId: 's', seconds: 60 })
    await reconcileLiveUsage({ sessionId: 's', seconds: 60 })
    await reconcileLiveUsage({ sessionId: 's', seconds: 30 })
    await reconcileLiveUsage({ sessionId: 's', seconds: 90, final: true })
    expect(admin.__mock.get('users/u').gold).toBe(940)
    expect(admin.__mock.get('whatsAppCallSessions/s')).toMatchObject({
        voiceSeconds: 90,
        voiceUsageFinal: true,
        billedGold: 60,
    })
})
test('bills backend rounds at the configured model rate separately and once', async () => {
    const backend = { id: 'd:1', model: 'MODEL_DEEPSEEK_V4_FLASH', tokens: 4000, tokensPerGold: 2000 }
    await reconcileLiveUsage({ sessionId: 's', seconds: 60 })
    await reconcileLiveUsage({ sessionId: 's', backend })
    await reconcileLiveUsage({ sessionId: 's', backend })
    expect(admin.__mock.get('users/u').gold).toBe(958)
    const ledger = admin.__mock.list('users/u/goldTransactions/').map(([, value]) => value)
    expect(ledger).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ source: 'assistant_voice_duration', amount: 40 }),
            expect.objectContaining({ source: 'assistant_usage', model: 'MODEL_DEEPSEEK_V4_FLASH', amount: 2 }),
        ])
    )
})
test('uses the frozen rate and does not overdraw the Gold balance', async () => {
    admin.__mock.set('users/u', { gold: 4 })
    const result = await reconcileLiveUsage({ sessionId: 's', seconds: 15 })
    expect(result).toMatchObject({ insufficientBalance: true, chargedGold: 4, currentGold: 0 })
})
test('rejects invalid usage instead of recording free calls', async () => {
    await expect(reconcileLiveUsage({ sessionId: 's', seconds: NaN })).rejects.toThrow('Invalid')
    expect(() => calculateLiveVoiceGold(30, 0)).toThrow('Invalid')
})
