'use strict'

// Security audit 2026-11 (stripe-link-account-unverified-email): linkStripeAccount looked up the
// Stripe customer of any email address the caller typed and returned its id, which then opened a
// billing-portal session for somebody else's customer. Only the caller's verified login email may
// be looked up, and the customer id never goes back to the client.

const mockGetUser = jest.fn()
const mockLinkAccountByEmail = jest.fn()
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
jest.mock('../Gold/goldHelper', () => ({ applyGoldChange: jest.fn(), applyGoldChangeInTransaction: jest.fn() }))
jest.mock('../Payment/stripeHelper', () => ({
    PLAN_STATUS_PREMIUM: 'premium',
    checkPremiumStatus: jest.fn(),
    checkPremiumStatusByEmail: jest.fn(),
    checkPremiumStatusByTrackingIdAndEmail: jest.fn(),
    linkAccountByEmail: (...args) => mockLinkAccountByEmail(...args),
}))

const { linkStripeAccount } = require('./stripePremiumChecker')
const { __private__ } = require('../shared/verifiedAccountEmail')

const context = { auth: { uid: 'caller' } }

beforeEach(() => {
    __private__.clearCache()
    mockGetUser.mockReset()
    mockLinkAccountByEmail.mockReset()
    mockUserDocs.clear()
    mockUserDocs.set('users/caller', { displayName: 'Carla Caller' })
    mockGetUser.mockResolvedValue({ uid: 'caller', email: 'Carla@Example.com', emailVerified: true })
    mockLinkAccountByEmail.mockResolvedValue({
        status: 'free',
        customer: 'cus_found',
        message: 'No active subscription',
    })
})

test('refuses an address that is not the caller’s verified login email, without asking Stripe', async () => {
    await expect(linkStripeAccount({ email: 'victim@example.com' }, context)).rejects.toMatchObject({
        code: 'permission-denied',
    })
    expect(mockLinkAccountByEmail).not.toHaveBeenCalled()
})

test('refuses an unverified login email', async () => {
    mockGetUser.mockResolvedValue({ uid: 'caller', email: 'carla@example.com', emailVerified: false })

    await expect(linkStripeAccount({ email: 'carla@example.com' }, context)).rejects.toMatchObject({
        code: 'permission-denied',
    })
    expect(mockLinkAccountByEmail).not.toHaveBeenCalled()
})

test('links the caller’s own verified email and never returns the Stripe customer id', async () => {
    const result = await linkStripeAccount({ email: ' carla@example.com ' }, context)

    expect(mockLinkAccountByEmail).toHaveBeenCalledWith('carla@example.com', 'Carla Caller')
    expect(result).toMatchObject({ success: false, premiumStatus: 'free' })
    expect(result).not.toHaveProperty('customer')
    expect(JSON.stringify(result)).not.toContain('cus_found')
})
