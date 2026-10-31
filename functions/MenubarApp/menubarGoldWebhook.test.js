'use strict'

// /api/menubar/gold is how other apps charge an alldone.app account's Gold. The Anna menubar
// app and the older alldone.team tools send { type, userEmail, amount }; alldone.team's per-action
// billing adds `app`, `operationId`, `product` and `description`. These tests pin both shapes.

const crypto = require('crypto')

const mockDocs = new Map()
const mockAuthUsers = {}
const mockDeductGold = jest.fn(async () => ({ success: true, newBalance: 90 }))
const mockRefundGold = jest.fn(async () => ({ success: true, newBalance: 110 }))
const mockGetGoldChangeClaim = jest.fn(async () => null)

jest.mock('firebase-admin', () => {
    const snapshot = path => ({
        id: path.split('/').at(-1),
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
    })
    const notFound = () => Object.assign(new Error('no user'), { code: 'auth/user-not-found' })
    return {
        firestore: () => ({
            doc: path => ({ id: path.split('/').at(-1), get: async () => snapshot(path) }),
        }),
        auth: () => ({
            getUser: async uid => {
                if (!mockAuthUsers[uid]) throw notFound()
                return { uid, ...mockAuthUsers[uid] }
            },
            getUserByEmail: async email => {
                const entry = Object.entries(mockAuthUsers).find(([, user]) => user.email === email)
                if (!entry) throw notFound()
                return { uid: entry[0], ...entry[1] }
            },
        }),
    }
})
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({ MENUBAR_APP_WEBHOOK_SECRET: 'secret' }) }))
jest.mock('../Gold/goldHelper', () => ({
    deductGold: mockDeductGold,
    refundGold: mockRefundGold,
    getGoldChangeClaim: mockGetGoldChangeClaim,
}))

const { handleMenubarGoldWebhook } = require('./menubarApp')
const { __private__: verifiedEmail } = require('../shared/verifiedAccountEmail')

const response = () => {
    const res = { statusCode: 200, body: null }
    res.set = () => res
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.json = body => {
        res.body = body
        return res
    }
    return res
}

const signedGoldRequest = body => {
    const rawBody = JSON.stringify(body)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = crypto.createHmac('sha256', 'secret').update(`${timestamp}.${rawBody}`).digest('hex')
    return {
        method: 'POST',
        headers: { 'x-alldone-timestamp': timestamp, 'x-alldone-signature': signature },
        body,
        rawBody: Buffer.from(rawBody),
        ip: '203.0.113.7',
    }
}

const send = async body => {
    const res = response()
    await handleMenubarGoldWebhook(signedGoldRequest(body), res)
    return res
}

const teamCharge = overrides => ({
    type: 'DEDUCT_GOLD',
    userEmail: 'karsten@example.com',
    amount: 25,
    app: 'alldone-team',
    operationId: 'judy:job-search:req-1',
    product: 'judy',
    description: 'Judy: job search',
    ...overrides,
})

beforeEach(() => {
    mockDocs.clear()
    Object.keys(mockAuthUsers).forEach(uid => delete mockAuthUsers[uid])
    mockDeductGold.mockClear()
    mockRefundGold.mockClear()
    mockGetGoldChangeClaim.mockReset()
    mockGetGoldChangeClaim.mockResolvedValue(null)
    verifiedEmail.clearCache()

    mockAuthUsers.karsten = { email: 'karsten@example.com', emailVerified: true }
    mockDocs.set('users/karsten', { gold: 100 })
})

describe('requests without an app keep their old booking', () => {
    test('a menubar charge is booked as Anna Alldone app usage, with no idempotency key', async () => {
        const res = await send({ type: 'DEDUCT_GOLD', userEmail: 'karsten@example.com', amount: 3 })

        expect(res.body).toEqual({ success: true, newBalance: 90 })
        expect(mockDeductGold).toHaveBeenCalledWith('karsten', 3, {
            channel: 'menubar_app',
            source: 'menubar_app_usage',
        })
    })

    test('a refund without an app is not tied to a charge', async () => {
        const res = await send({ type: 'REFUND_GOLD', userEmail: 'karsten@example.com', amount: 25 })

        expect(res.body).toEqual({ success: true, newBalance: 110 })
        expect(mockGetGoldChangeClaim).not.toHaveBeenCalled()
        expect(mockRefundGold).toHaveBeenCalledWith('karsten', 25, {
            channel: 'menubar_app',
            source: 'menubar_app_refund',
        })
    })

    test('an operationId from an older caller makes the request idempotent', async () => {
        await send({ type: 'DEDUCT_GOLD', userEmail: 'karsten@example.com', amount: 25, operationId: 'req-9:charge' })

        expect(mockDeductGold).toHaveBeenCalledWith('karsten', 25, {
            channel: 'menubar_app',
            source: 'menubar_app_usage',
            correlationId: 'req-9:charge',
            idempotencyKey: 'gold_webhook:anna-menubar:DEDUCT_GOLD:req-9:charge',
        })
    })
})

describe('alldone.team per-action charges', () => {
    test('a charge is booked as alldone.team usage with its product and description', async () => {
        const res = await send(teamCharge())

        expect(res.body).toEqual({ success: true, newBalance: 90 })
        expect(mockDeductGold).toHaveBeenCalledWith('karsten', 25, {
            channel: 'alldone_team',
            source: 'alldone_team_usage',
            product: 'judy',
            note: 'Judy: job search',
            correlationId: 'judy:job-search:req-1',
            idempotencyKey: 'gold_webhook:alldone-team:DEDUCT_GOLD:judy:job-search:req-1',
        })
    })

    test('a repeated charge answers with the first result and says so', async () => {
        mockDeductGold.mockResolvedValueOnce({ success: true, newBalance: 75, alreadyProcessed: true })

        const res = await send(teamCharge())

        expect(res.body).toEqual({ success: true, newBalance: 75, alreadyProcessed: true })
    })

    test('the description is reduced to one plain line of at most 120 characters', async () => {
        await send(teamCharge({ description: `Judy:\n\tjob\u0000 search ${'x'.repeat(200)}` }))

        const { note } = mockDeductGold.mock.calls[0][2]
        expect(note.startsWith('Judy: job search x')).toBe(true)
        expect(note).toHaveLength(120)
    })

    test.each([
        ['no operationId', { operationId: undefined }, 'operationId is required'],
        ['a malformed operationId', { operationId: 'a b/c' }, 'Invalid operationId'],
        ['an unknown app', { app: 'someone-else' }, 'Unknown app'],
        ['a malformed product', { product: 'Judy Job' }, 'Invalid product'],
    ])('a request with %s is refused before any Gold moves', async (_, overrides, error) => {
        const res = await send(teamCharge(overrides))

        expect(res.statusCode).toBe(400)
        expect(res.body).toEqual({ success: false, error })
        expect(mockDeductGold).not.toHaveBeenCalled()
    })
})

describe('alldone.team refunds are tied to their charge', () => {
    const refund = overrides => teamCharge({ type: 'REFUND_GOLD', ...overrides })

    test('a refund for an operation that was never charged moves no Gold', async () => {
        const res = await send(refund())

        expect(mockGetGoldChangeClaim).toHaveBeenCalledWith(
            'karsten',
            'gold_webhook:alldone-team:DEDUCT_GOLD:judy:job-search:req-1'
        )
        expect(res.body).toEqual({
            success: false,
            error: 'No charge was made for this operation',
            code: 'NO_MATCHING_CHARGE',
        })
        expect(mockRefundGold).not.toHaveBeenCalled()
    })

    test('a refund may not give back more than the charge took', async () => {
        mockGetGoldChangeClaim.mockResolvedValueOnce({ amount: 10, direction: 'spend' })

        const res = await send(refund({ amount: 25 }))

        expect(res.body).toEqual({
            success: false,
            error: 'The refund is larger than the charge',
            code: 'REFUND_EXCEEDS_CHARGE',
        })
        expect(mockRefundGold).not.toHaveBeenCalled()
    })

    test('a refund of a charge is booked once, under its own key', async () => {
        mockGetGoldChangeClaim.mockResolvedValueOnce({ amount: 25, direction: 'spend' })

        const res = await send(refund())

        expect(res.body).toEqual({ success: true, newBalance: 110 })
        expect(mockRefundGold).toHaveBeenCalledWith('karsten', 25, {
            channel: 'alldone_team',
            source: 'alldone_team_refund',
            product: 'judy',
            note: 'Judy: job search',
            correlationId: 'judy:job-search:req-1',
            idempotencyKey: 'gold_webhook:alldone-team:REFUND_GOLD:judy:job-search:req-1',
        })
    })
})
