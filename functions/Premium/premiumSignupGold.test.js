'use strict'

// The signup flow used to write `gold: 1000` from the client for a new premium account, the
// one field a client must never set. The server now grants it, once, to a fresh account.

const mockApplyGoldChange = jest.fn(async () => ({ success: true, newBalance: 1000 }))
const mockGetUser = jest.fn()
const mockUserDocs = new Map()

jest.mock('firebase-functions', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('firebase-admin', () => ({
    auth: () => ({ getUser: mockGetUser }),
    firestore: () => ({
        doc: path => ({
            get: async () => ({ exists: mockUserDocs.has(path), data: () => mockUserDocs.get(path) }),
            update: async data => mockUserDocs.set(path, { ...(mockUserDocs.get(path) || {}), ...data }),
        }),
    }),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }))
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({}) }))
jest.mock('../GAnalytics/GAnalytics', () => ({ purchaseEvent: jest.fn(), refundEvent: jest.fn() }))
jest.mock('../Gold/goldHelper', () => ({
    applyGoldChange: (...args) => mockApplyGoldChange(...args),
    applyGoldChangeInTransaction: jest.fn(),
}))
jest.mock('../Payment/stripeHelper', () => ({
    PLAN_STATUS_PREMIUM: 'premium',
    checkPremiumStatus: jest.fn(),
    checkPremiumStatusByEmail: jest.fn(),
    checkPremiumStatusByTrackingIdAndEmail: jest.fn(async () => ({ status: mockStripeStatus, customer: 'cus_1' })),
    linkAccountByEmail: jest.fn(),
}))

let mockStripeStatus = 'premium'

const { grantPremiumSignupGold, checkUserPremiumStatus } = require('./stripePremiumChecker')

const NOW = Date.parse('2026-10-29T10:00:00Z')
const createdHoursAgo = hours => ({ metadata: { creationTime: new Date(NOW - hours * 3600 * 1000).toUTCString() } })

beforeEach(() => {
    mockApplyGoldChange.mockClear()
    mockGetUser.mockReset()
    mockUserDocs.clear()
    mockStripeStatus = 'premium'
    mockUserDocs.set('users/new-user', { email: 'new@example.com', gold: 100 })
})

describe('grantPremiumSignupGold', () => {
    test('tops a fresh account up to 1000 Gold, once', async () => {
        mockGetUser.mockResolvedValue(createdHoursAgo(1))

        const result = await grantPremiumSignupGold('new-user', { now: NOW })

        expect(result).toEqual({ granted: true, newBalance: 1000 })
        expect(mockApplyGoldChange).toHaveBeenCalledWith({
            userId: 'new-user',
            delta: 900,
            direction: 'earn',
            source: 'premium_signup_bonus',
            idempotencyKey: 'premium_signup_bonus:new-user',
        })
    })

    test('reports a repeated grant as not granted', async () => {
        mockGetUser.mockResolvedValue(createdHoursAgo(1))
        mockApplyGoldChange.mockResolvedValueOnce({ success: true, alreadyProcessed: true, newBalance: 1000 })

        expect(await grantPremiumSignupGold('new-user', { now: NOW })).toMatchObject({ granted: false })
    })

    test('gives nothing to an account older than a day', async () => {
        mockGetUser.mockResolvedValue(createdHoursAgo(30))

        expect(await grantPremiumSignupGold('new-user', { now: NOW })).toMatchObject({ granted: false })
        expect(mockApplyGoldChange).not.toHaveBeenCalled()
    })
})

describe('checkUserPremiumStatus', () => {
    const call = data => checkUserPremiumStatus(data, { auth: { uid: 'new-user' } })

    test('grants the start Gold on the signup check of a premium account', async () => {
        mockGetUser.mockResolvedValue({ metadata: { creationTime: new Date().toUTCString() } })

        const response = await call({ isSignup: true })

        expect(response.signupGold).toEqual({ granted: true, newBalance: 1000 })
        expect(mockApplyGoldChange).toHaveBeenCalledTimes(1)
    })

    test('grants nothing outside the signup flow or for a free account', async () => {
        mockGetUser.mockResolvedValue({ metadata: { creationTime: new Date().toUTCString() } })

        expect((await call({})).signupGold).toBeNull()
        mockStripeStatus = 'free'
        expect((await call({ isSignup: true })).signupGold).toBeNull()
        expect(mockApplyGoldChange).not.toHaveBeenCalled()
    })
})
