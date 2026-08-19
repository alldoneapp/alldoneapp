const mockUpdate = jest.fn()
const mockRunTransaction = jest.fn()
const mockDoc = jest.fn(() => ({ id: 'user1', update: mockUpdate }))

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
}))
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
}))
jest.mock('firebase-functions', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({ REVENUECAT_WEBHOOK_AUTH: 'secret-auth', REVENUECAT_ALLOW_SANDBOX: '' })),
}))
jest.mock('../Gold/goldHelper', () => ({
    applyGoldChangeInTransaction: jest.fn(() => ({ success: true, previousBalance: 0, newBalance: 10000 })),
}))

const { applyGoldChangeInTransaction } = require('../Gold/goldHelper')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { processRevenueCatEvent, handleRevenueCatWebhook } = require('./revenueCatWebhook')

const makeRes = () => {
    const res = { statusCode: null, body: null }
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.send = body => {
        res.body = body
        return res
    }
    return res
}

beforeEach(() => {
    jest.clearAllMocks()
    mockDoc.mockImplementation(path => ({ id: path.split('/').pop(), path, update: mockUpdate }))
})

describe('handleRevenueCatWebhook auth and gating', () => {
    it('rejects a bad authorization header', async () => {
        const res = makeRes()
        await handleRevenueCatWebhook({ method: 'POST', headers: { authorization: 'wrong' }, body: {} }, res)
        expect(res.statusCode).toBe(401)
    })

    it('ignores sandbox events unless explicitly allowed', async () => {
        const res = makeRes()
        await handleRevenueCatWebhook(
            {
                method: 'POST',
                headers: { authorization: 'secret-auth' },
                body: { event: { type: 'INITIAL_PURCHASE', environment: 'SANDBOX' } },
            },
            res
        )
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe('Sandbox ignored')
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('processes sandbox events when REVENUECAT_ALLOW_SANDBOX is true', async () => {
        getEnvFunctions.mockReturnValueOnce({
            REVENUECAT_WEBHOOK_AUTH: 'secret-auth',
            REVENUECAT_ALLOW_SANDBOX: 'true',
        })
        const res = makeRes()
        await handleRevenueCatWebhook(
            {
                method: 'POST',
                headers: { authorization: 'secret-auth' },
                body: {
                    event: {
                        type: 'INITIAL_PURCHASE',
                        environment: 'SANDBOX',
                        app_user_id: 'user1',
                        product_id: 'alldone_premium_monthly',
                        expiration_at_ms: 1755600000000,
                    },
                },
            },
            res
        )
        expect(res.statusCode).toBe(200)
        expect(res.body).toBe('premium_granted')
    })
})

describe('processRevenueCatEvent', () => {
    it('grants premium with dotted field paths on INITIAL_PURCHASE', async () => {
        const outcome = await processRevenueCatEvent({
            type: 'INITIAL_PURCHASE',
            app_user_id: 'user1',
            product_id: 'alldone_premium_yearly',
            expiration_at_ms: 1755600000000,
        })
        expect(outcome).toBe('premium_granted')
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                'premium.status': 'premium',
                'premium.source': 'apple_iap',
                'premium.planInterval': 'year',
                'premium.currentPeriodEnd': 1755600000,
            })
        )
        const updateArg = mockUpdate.mock.calls[0][0]
        expect(Object.keys(updateArg)).not.toContain('premium')
    })

    it('strips RevenueCat product id suffixes before matching', async () => {
        const outcome = await processRevenueCatEvent({
            type: 'RENEWAL',
            app_user_id: 'user1',
            product_id: 'alldone_premium_monthly:base',
        })
        expect(outcome).toBe('premium_granted')
    })

    it('does NOT downgrade on CANCELLATION (auto-renew off, access continues)', async () => {
        const outcome = await processRevenueCatEvent({
            type: 'CANCELLATION',
            app_user_id: 'user1',
            product_id: 'alldone_premium_monthly',
        })
        expect(outcome).toBe('ignored_event_type')
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('revokes premium on EXPIRATION', async () => {
        const outcome = await processRevenueCatEvent({
            type: 'EXPIRATION',
            app_user_id: 'user1',
            product_id: 'alldone_premium_monthly',
        })
        expect(outcome).toBe('premium_revoked')
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ 'premium.status': 'free' }))
    })

    it('never grants against RevenueCat anonymous ids', async () => {
        const outcome = await processRevenueCatEvent({
            type: 'INITIAL_PURCHASE',
            app_user_id: '$RCAnonymousID:abc',
            product_id: 'alldone_premium_monthly',
        })
        expect(outcome).toBe('ignored_no_user')
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('fulfills a gold pack exactly once (idempotent by event id)', async () => {
        const transaction = { get: jest.fn(), set: jest.fn() }
        mockRunTransaction.mockImplementation(async fn => fn(transaction))
        transaction.get.mockResolvedValue({ exists: false, data: () => ({ gold: 5 }) })
        // First delivery: user doc exists, fulfillment doc does not.
        transaction.get
            .mockResolvedValueOnce({ exists: true, data: () => ({ gold: 5 }) })
            .mockResolvedValueOnce({ exists: false })

        const outcome = await processRevenueCatEvent({
            id: 'evt1',
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: 'user1',
            product_id: 'alldone_gold_10000',
            transaction_id: 'txn1',
        })
        expect(outcome).toBe('fulfilled')
        expect(applyGoldChangeInTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                delta: 10000,
                direction: 'earn',
                source: 'gold_pack_purchase',
                context: expect.objectContaining({ channel: 'apple_iap', objectId: 'txn1' }),
            })
        )
        expect(transaction.set).toHaveBeenCalled()

        // Redelivery: fulfillment doc now exists.
        jest.clearAllMocks()
        mockRunTransaction.mockImplementation(async fn => fn(transaction))
        transaction.get
            .mockResolvedValueOnce({ exists: true, data: () => ({ gold: 10005 }) })
            .mockResolvedValueOnce({ exists: true })
        const outcome2 = await processRevenueCatEvent({
            id: 'evt1',
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: 'user1',
            product_id: 'alldone_gold_10000',
        })
        expect(outcome2).toBe('already_fulfilled')
        expect(applyGoldChangeInTransaction).not.toHaveBeenCalled()
    })

    it('ignores unknown products in every path', async () => {
        expect(
            await processRevenueCatEvent({
                type: 'INITIAL_PURCHASE',
                app_user_id: 'user1',
                product_id: 'mystery_product',
            })
        ).toBe('ignored_unknown_subscription_product')
        expect(
            await processRevenueCatEvent({
                type: 'NON_RENEWING_PURCHASE',
                app_user_id: 'user1',
                product_id: 'mystery_gold',
            })
        ).toBe('ignored_unknown_gold_product')
        expect(mockUpdate).not.toHaveBeenCalled()
    })
})
