'use strict'

// Security audit 2026-11 (stripe-link-account-unverified-email): linkStripeAccount looked up the
// Stripe customer of any email address the caller typed and returned its id, which then opened a
// billing-portal session for somebody else's customer. The caller's verified login email links
// directly; any other address needs the code mailed to it (AT-2978). The customer id never goes
// back to the client.

const mockGetUser = jest.fn()
const mockLinkAccountByEmail = jest.fn()
const mockUserDocs = new Map()
const mockRequestCode = jest.fn()
const mockConsumeCode = jest.fn()

jest.mock('firebase-functions', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('firebase-admin', () => ({
    auth: () => ({ getUser: mockGetUser }),
    firestore: () => ({
        collection: () => ({ doc: () => ({}) }),
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

jest.mock('../SendInBlueManager', () => ({ sendTransactionalEmail: jest.fn() }))
jest.mock('./stripeLinkCode', () => {
    const actual = jest.requireActual('./stripeLinkCode')
    return {
        ...actual,
        requestStripeLinkCode: (...args) => mockRequestCode(...args),
        consumeStripeLinkCode: (...args) => mockConsumeCode(...args),
    }
})

const { linkStripeAccount } = require('./stripePremiumChecker')
const { StripeLinkCodeError } = require('./stripeLinkCode')
const { __private__ } = require('../shared/verifiedAccountEmail')

const context = { auth: { uid: 'caller' } }

beforeEach(() => {
    __private__.clearCache()
    mockGetUser.mockReset()
    mockLinkAccountByEmail.mockReset()
    mockUserDocs.clear()
    mockRequestCode.mockReset().mockResolvedValue({ sent: true })
    mockConsumeCode.mockReset().mockResolvedValue({ ok: true })
    mockUserDocs.set('users/caller', { displayName: 'Carla Caller' })
    mockGetUser.mockResolvedValue({ uid: 'caller', email: 'Carla@Example.com', emailVerified: true })
    mockLinkAccountByEmail.mockResolvedValue({
        status: 'free',
        customer: 'cus_found',
        message: 'No active subscription',
    })
})

test('another address gets a code mailed instead of being linked', async () => {
    const result = await linkStripeAccount({ email: 'Paid@Example.com' }, context)

    expect(result).toMatchObject({ success: false, codeRequired: true })
    expect(mockRequestCode).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'caller', email: 'paid@example.com' })
    )
    expect(mockLinkAccountByEmail).not.toHaveBeenCalled()
})

test('a wrong code links nothing', async () => {
    mockConsumeCode.mockRejectedValue(new StripeLinkCodeError('permission-denied', 'That code is not correct.'))

    await expect(linkStripeAccount({ email: 'paid@example.com', code: '111111' }, context)).rejects.toMatchObject({
        code: 'permission-denied',
    })
    expect(mockLinkAccountByEmail).not.toHaveBeenCalled()
})

test('the right code links the other address', async () => {
    await linkStripeAccount({ email: 'paid@example.com', code: '000042' }, context)

    expect(mockConsumeCode).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'caller', email: 'paid@example.com', code: '000042' })
    )
    expect(mockLinkAccountByEmail).toHaveBeenCalledWith('paid@example.com', 'Carla Caller')
})

test('an unverified login email needs a code too', async () => {
    mockGetUser.mockResolvedValue({ uid: 'caller', email: 'carla@example.com', emailVerified: false })

    const result = await linkStripeAccount({ email: 'carla@example.com' }, context)

    expect(result).toMatchObject({ codeRequired: true })
    expect(mockLinkAccountByEmail).not.toHaveBeenCalled()
})

test('links the caller’s own verified email and never returns the Stripe customer id', async () => {
    const result = await linkStripeAccount({ email: ' carla@example.com ' }, context)

    expect(mockLinkAccountByEmail).toHaveBeenCalledWith('carla@example.com', 'Carla Caller')
    expect(result).toMatchObject({ success: false, premiumStatus: 'free' })
    expect(result).not.toHaveProperty('customer')
    expect(JSON.stringify(result)).not.toContain('cus_found')
})
