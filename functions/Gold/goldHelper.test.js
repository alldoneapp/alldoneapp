jest.mock('firebase-admin', () => {
    let docs = new Map()
    let autoDocId = 0

    const clone = value => JSON.parse(JSON.stringify(value))

    const applyValue = (previousValue, nextValue) => {
        if (nextValue && typeof nextValue === 'object' && typeof nextValue.__increment === 'number') {
            return (Number(previousValue) || 0) + nextValue.__increment
        }

        return nextValue
    }

    const applyWrite = (path, data, options = {}) => {
        const previousDoc = docs.has(path) ? docs.get(path) : {}
        const nextDoc = options.merge ? { ...previousDoc } : {}

        Object.keys(data).forEach(key => {
            nextDoc[key] = applyValue(previousDoc[key], data[key])
        })

        docs.set(path, nextDoc)
    }

    const buildDocRef = path => ({
        path,
        get: jest.fn(async () => ({
            exists: docs.has(path),
            data: () => clone(docs.get(path) || {}),
        })),
        set: jest.fn(async (data, options) => {
            applyWrite(path, data, options)
        }),
        update: jest.fn(async data => {
            applyWrite(path, data, { merge: true })
        }),
        collection: jest.fn(collectionName => buildCollectionRef(`${path}/${collectionName}`)),
    })

    const buildCollectionRef = path => ({
        path,
        doc: jest.fn(docId => buildDocRef(`${path}/${docId || `doc-${++autoDocId}`}`)),
    })

    const runTransaction = jest.fn(async callback => {
        const transaction = {
            get: jest.fn(async ref => ({
                exists: docs.has(ref.path),
                data: () => clone(docs.get(ref.path) || {}),
            })),
            set: jest.fn((ref, data, options) => {
                applyWrite(ref.path, data, options)
            }),
            update: jest.fn((ref, data) => {
                applyWrite(ref.path, data, { merge: true })
            }),
        }

        await callback(transaction)
    })

    return {
        firestore: Object.assign(
            jest.fn(() => ({
                doc: buildDocRef,
                collection: buildCollectionRef,
                runTransaction,
            })),
            {
                FieldValue: {
                    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
                    increment: jest.fn(value => ({ __increment: value })),
                },
            }
        ),
        __mock: {
            reset() {
                docs = new Map()
                autoDocId = 0
                runTransaction.mockClear()
            },
            setDoc(path, data) {
                docs.set(path, clone(data))
            },
            getDoc(path) {
                return docs.get(path)
            },
            getDocsByPrefix(prefix) {
                return Array.from(docs.entries())
                    .filter(([path]) => path.startsWith(prefix))
                    .map(([, data]) => data)
            },
        },
    }
})

jest.mock('../GAnalytics/GAnalytics', () => ({
    logEvent: jest.fn(() => Promise.resolve()),
}))

jest.mock('../SendInBlueManager', () => ({
    sendMonthlyPremiumGoldNotification: jest.fn(() => Promise.resolve()),
    sendMonthlyFreeGoldNotification: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUsersByPremiumStatus: jest.fn(),
    getLastActiveUsers: jest.fn(),
    getUsersThatEarnedSomeGoldToday: jest.fn(),
    updateUserDailyGold: jest.fn(),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    inProductionEnvironment: jest.fn(() => false),
}))

const admin = require('firebase-admin')
const { addMonthlyGoldToUser, deductGold, refundGold } = require('./goldHelper')
const { applyGoldChangeInTransaction } = require('./goldTransactions')

describe('goldHelper ledger integration', () => {
    beforeEach(() => {
        admin.__mock.reset()
    })

    test('deductGold writes a spend ledger entry and updates the balance', async () => {
        admin.__mock.setDoc('users/user-1', { gold: 10 })

        const result = await deductGold('user-1', 4, {
            source: 'assistant_usage',
            channel: 'assistant',
        })

        expect(result).toEqual(expect.objectContaining({ success: true, previousBalance: 10, newBalance: 6 }))
        expect(admin.__mock.getDoc('users/user-1').gold).toBe(6)
        expect(admin.__mock.getDocsByPrefix('users/user-1/goldTransactions/')).toEqual([
            expect.objectContaining({
                amount: 4,
                direction: 'spend',
                source: 'assistant_usage',
                balanceBefore: 10,
                balanceAfter: 6,
                channel: 'assistant',
            }),
        ])
    })

    test('deductGold returns insufficient gold without writing a ledger entry', async () => {
        admin.__mock.setDoc('users/user-1', { gold: 2 })

        const result = await deductGold('user-1', 4, {
            source: 'assistant_usage',
        })

        expect(result).toEqual(
            expect.objectContaining({ success: false, message: 'Insufficient gold', currentGold: 2 })
        )
        expect(admin.__mock.getDoc('users/user-1').gold).toBe(2)
        expect(admin.__mock.getDocsByPrefix('users/user-1/goldTransactions/')).toEqual([])
    })

    test('refundGold writes a refund ledger entry and updates the balance', async () => {
        admin.__mock.setDoc('users/user-1', { gold: 3 })

        const result = await refundGold('user-1', 2, {
            source: 'gmail_labeling',
            channel: 'gmail',
        })

        expect(result).toEqual(expect.objectContaining({ success: true, previousBalance: 3, newBalance: 5 }))
        expect(admin.__mock.getDoc('users/user-1').gold).toBe(5)
        expect(admin.__mock.getDocsByPrefix('users/user-1/goldTransactions/')).toEqual([
            expect.objectContaining({
                amount: 2,
                direction: 'refund',
                source: 'gmail_labeling',
                balanceBefore: 3,
                balanceAfter: 5,
                channel: 'gmail',
            }),
        ])
    })

    test('addMonthlyGoldToUser records a monthly earn ledger entry', async () => {
        admin.__mock.setDoc('users/user-1', { gold: 5 })

        await addMonthlyGoldToUser(
            {
                uid: 'user-1',
                displayName: 'Alex Doe',
                email: 'alex@example.com',
                notificationEmail: '',
                photoURL: '',
                receiveEmails: false,
            },
            true
        )

        expect(admin.__mock.getDoc('users/user-1').gold).toBe(1005)
        expect(admin.__mock.getDocsByPrefix('users/user-1/goldTransactions/')).toEqual([
            expect.objectContaining({
                amount: 1000,
                direction: 'earn',
                source: 'monthly_gold',
                balanceBefore: 5,
                balanceAfter: 1005,
            }),
        ])
    })

    test('applyGoldChangeInTransaction supports purchase-style earn entries', async () => {
        admin.__mock.setDoc('users/user-1', { gold: 20 })
        let result = null

        await admin.firestore().runTransaction(async transaction => {
            const userRef = admin.firestore().doc('users/user-1')
            const userDoc = await transaction.get(userRef)

            result = applyGoldChangeInTransaction({
                transaction,
                userRef,
                userData: userDoc.data(),
                delta: 10000,
                direction: 'earn',
                source: 'gold_pack_purchase',
                context: {
                    channel: 'stripe',
                    objectId: 'session-1',
                },
            })
        })

        expect(result).toEqual(expect.objectContaining({ success: true, previousBalance: 20, newBalance: 10020 }))
        expect(admin.__mock.getDoc('users/user-1').gold).toBe(10020)
        expect(admin.__mock.getDocsByPrefix('users/user-1/goldTransactions/')).toEqual([
            expect.objectContaining({
                amount: 10000,
                direction: 'earn',
                source: 'gold_pack_purchase',
                balanceBefore: 20,
                balanceAfter: 10020,
                channel: 'stripe',
                objectId: 'session-1',
            }),
        ])
    })
})
