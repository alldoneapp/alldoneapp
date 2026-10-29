'use strict'

// Gold could be minted three ways from a client: a negative "spend", a refund of an amount
// nobody was charged, and writing the balance directly (firestore.rules, pinned in the rules
// emulator suite). This suite pins the first two against the real ledger code.

const mockDocs = new Map()
let mockAutoId = 0
let mockNow = Date.parse('2026-10-29T10:00:00Z')

jest.mock('firebase-admin', () => {
    const snapshot = path => ({
        id: path.split('/').pop(),
        ref: docRef(path),
        exists: mockDocs.has(path),
        data: () => (mockDocs.has(path) ? { ...mockDocs.get(path) } : undefined),
    })
    const write = (path, data, merge) =>
        mockDocs.set(path, merge ? { ...(mockDocs.get(path) || {}), ...data } : { ...data })
    function docRef(path) {
        return { path, id: path.split('/').pop(), collection: name => collectionRef(`${path}/${name}`) }
    }
    function collectionRef(path, filters = [], order = null, max = Infinity) {
        return {
            doc: id => docRef(`${path}/${id || `auto-${++mockAutoId}`}`),
            where: (field, op, value) => collectionRef(path, [...filters, [field, op, value]], order, max),
            orderBy: (field, direction = 'asc') => collectionRef(path, filters, [field, direction], max),
            limit: count => collectionRef(path, filters, order, count),
            get: async () => {
                let docs = [...mockDocs.keys()]
                    .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
                    .map(snapshot)
                docs = docs.filter(doc =>
                    filters.every(([field, op, value]) => {
                        const actual = doc.data()[field]
                        const expected = value instanceof Date ? value.getTime() : value
                        return op === '>=' ? actual >= expected : actual === expected
                    })
                )
                if (order) {
                    const sign = order[1] === 'desc' ? -1 : 1
                    docs.sort((a, b) => (a.data()[order[0]] - b.data()[order[0]]) * sign)
                }
                return { docs: docs.slice(0, max) }
            },
        }
    }
    const runTransaction = async callback =>
        callback({
            get: async ref => snapshot(ref.path),
            set: (ref, data, options) => write(ref.path, data, options?.merge),
            update: (ref, data) => write(ref.path, data, true),
        })
    return { firestore: () => ({ doc: docRef, collection: collectionRef, runTransaction }) }
})
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => mockNow } }))
jest.mock('../GAnalytics/GAnalytics', () => ({ logEvent: jest.fn(() => Promise.resolve()) }))
jest.mock('../SendInBlueManager', () => ({}))
jest.mock('../Users/usersFirestore', () => ({
    getUsersByPremiumStatus: jest.fn(),
    getLastActiveUsers: jest.fn(),
    getUsersThatEarnedSomeGoldToday: jest.fn(),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ inProductionEnvironment: () => false }))

const { deductGold, refundGold, adjustGold, refundClientSpend } = require('./goldHelper')

const USER = 'user-1'
const HOUR = 60 * 60 * 1000

const gold = () => mockDocs.get(`users/${USER}`).gold
const ledger = () =>
    [...mockDocs.entries()]
        .filter(([path]) => path.startsWith(`users/${USER}/goldTransactions/`))
        .map(([path, data]) => ({ id: path.split('/').pop(), ...data }))
const spend = (id, fields) =>
    mockDocs.set(`users/${USER}/goldTransactions/${id}`, {
        direction: 'spend',
        createdAt: mockNow - HOUR,
        ...fields,
    })

beforeEach(() => {
    mockDocs.clear()
    mockAutoId = 0
    mockDocs.set(`users/${USER}`, { gold: 100 })
})

describe('a ledger direction carries its sign', () => {
    test('a negative spend is refused instead of crediting Gold', async () => {
        const result = await deductGold(USER, -500, { source: 'goal_unlock' })

        expect(result).toMatchObject({ success: false, message: 'Invalid gold amount' })
        expect(gold()).toBe(100)
        expect(ledger()).toEqual([])
    })

    test('a negative refund is refused', async () => {
        expect(await refundGold(USER, -20, { source: 'vm_execution_refund' })).toMatchObject({ success: false })
        expect(gold()).toBe(100)
    })

    test('ordinary spends and refunds still work, and an admin adjustment goes either way', async () => {
        expect(await deductGold(USER, 30, { source: 'goal_unlock' })).toMatchObject({ success: true, newBalance: 70 })
        expect(await refundGold(USER, 10, { source: 'vm_execution_refund' })).toMatchObject({ newBalance: 80 })
        expect(await adjustGold(USER, -5, { source: 'admin_adjustment' })).toMatchObject({ newBalance: 75 })
        expect(await adjustGold(USER, 25, { source: 'admin_adjustment' })).toMatchObject({ newBalance: 100 })
    })
})

describe('a client refund gives back one of the caller’s own charges', () => {
    test('refunds an embedded tool charge once, and links the refund to it', async () => {
        spend('charge-1', { source: 'iframe_deduction', amount: 30 })

        const result = await refundClientSpend(
            USER,
            30,
            { source: 'iframe_refund', channel: 'iframe' },
            { now: mockNow }
        )

        expect(result).toMatchObject({ success: true, newBalance: 130 })
        expect(mockDocs.get(`users/${USER}/goldTransactions/charge-1`).refundedAmount).toBe(30)
        expect(ledger().find(entry => entry.direction === 'refund')).toMatchObject({
            amount: 30,
            source: 'iframe_refund',
            refundOf: 'charge-1',
        })

        const again = await refundClientSpend(USER, 30, { source: 'iframe_refund' }, { now: mockNow })
        expect(again).toMatchObject({ success: false, message: 'No matching charge to refund' })
        expect(gold()).toBe(130)
    })

    test('never gives back more than was charged, even in parts', async () => {
        spend('charge-1', { source: 'iframe_deduction', amount: 30 })

        expect(await refundClientSpend(USER, 31, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            success: false,
        })
        expect(await refundClientSpend(USER, 10, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            newBalance: 110,
        })
        expect(await refundClientSpend(USER, 20, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            newBalance: 130,
        })
        expect(await refundClientSpend(USER, 1, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            success: false,
        })
    })

    test('refuses a refund with no charge behind it: the old mint', async () => {
        const result = await refundClientSpend(USER, 1000, { source: 'iframe_refund' }, { now: mockNow })

        expect(result).toMatchObject({ success: false, message: 'No matching charge to refund' })
        expect(gold()).toBe(100)
        expect(ledger()).toEqual([])
    })

    test('only matches a charge of the paired source', async () => {
        spend('vm-charge', { source: 'vm_execution', amount: 50 })
        spend('unlock', { source: 'goal_unlock', amount: 50 })

        expect(await refundClientSpend(USER, 50, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            success: false,
        })
        // Server-side refund sources are not open to clients at all.
        expect(await refundClientSpend(USER, 50, { source: 'vm_execution_refund' }, { now: mockNow })).toMatchObject({
            success: false,
            message: 'This charge cannot be refunded',
        })
    })

    test('a goal unlock rollback must name the goal that was charged', async () => {
        spend('unlock', { source: 'goal_unlock', amount: 50, objectId: 'goal-a' })

        expect(
            await refundClientSpend(USER, 50, { source: 'goal_unlock', objectId: 'goal-b' }, { now: mockNow })
        ).toMatchObject({ success: false })
        expect(
            await refundClientSpend(USER, 50, { source: 'goal_unlock', objectId: 'goal-a' }, { now: mockNow })
        ).toMatchObject({ success: true, newBalance: 150 })
    })

    test('does not reach back further than a day', async () => {
        spend('old', { source: 'iframe_deduction', amount: 30, createdAt: mockNow - 25 * HOUR })

        expect(await refundClientSpend(USER, 30, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            success: false,
        })
    })

    test.each([[0], [-5], [2.5], ['abc']])('rejects the amount %p', async amount => {
        spend('charge-1', { source: 'iframe_deduction', amount: 30 })

        expect(await refundClientSpend(USER, amount, { source: 'iframe_refund' }, { now: mockNow })).toMatchObject({
            success: false,
            message: 'Invalid gold amount',
        })
    })
})
