'use strict'

jest.mock('firebase-functions', () => ({
    logger: {
        error: jest.fn(),
    },
}))

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(),
}))

const admin = require('firebase-admin')
const functions = require('firebase-functions')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { MEASUREMENT_PROTOCOL_URL, logEvent, normalizeServerEvent, purchaseEvent, refundEvent } = require('./GAnalytics')

const GOOGLE_ANALYTICS_KEY = 'G-HR3PWMHKQQ'

const enabledEnvironment = {
    ANALYTICS_ENABLED: 'true',
    GOOGLE_ANALYTICS_KEY,
    GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET: 'test-secret',
}

const setUserAnalytics = analytics => {
    admin.firestore.mockReturnValue({
        doc: jest.fn(() => ({
            get: jest.fn(() => Promise.resolve({ exists: true, data: () => ({ analytics }) })),
        })),
    })
}

describe('GAnalytics', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.AbortController = class AbortController {
            constructor() {
                this.signal = {}
            }

            abort() {}
        }
        getEnvFunctions.mockReturnValue(enabledEnvironment)
        setUserAnalytics({ consent: 'granted', clientId: '123.456' })
        global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204 }))
    })

    test('sends valid Measurement Protocol purchase payloads', async () => {
        await expect(
            purchaseEvent('user-1', '12.50', 'payment-1', {
                currency: 'eur',
                provider: 'mollie',
                affiliation: 'Mollie',
            })
        ).resolves.toBe(true)

        expect(global.fetch).toHaveBeenCalledTimes(1)
        const [url, options] = global.fetch.mock.calls[0]
        expect(url).toBe(`${MEASUREMENT_PROTOCOL_URL}?measurement_id=${GOOGLE_ANALYTICS_KEY}&api_secret=test-secret`)
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
        expect(JSON.parse(options.body)).toEqual({
            client_id: '123.456',
            user_id: 'user-1',
            events: [
                {
                    name: 'purchase',
                    params: {
                        transaction_id: 'payment-1',
                        currency: 'EUR',
                        value: 12.5,
                        affiliation: 'Mollie',
                        provider: 'mollie',
                        items: [
                            {
                                item_id: 'subscription_payment',
                                item_name: 'Subscription payment',
                            },
                        ],
                    },
                },
            ],
        })
    })

    test('does not send without granted consent and a client ID', async () => {
        setUserAnalytics({ consent: 'denied' })

        await expect(purchaseEvent('user-1', 10, 'payment-1')).resolves.toBe(false)
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('keeps unique payment IDs as transaction IDs and sends refunds against the original payment', async () => {
        await purchaseEvent('user-1', 12.5, 'mollie-payment-1')
        await purchaseEvent('user-1', 18, 'stripe-session-2')
        await refundEvent('user-1', 'stripe-session-2', 18, { provider: 'stripe' })

        const events = global.fetch.mock.calls.map(([, options]) => JSON.parse(options.body).events[0])
        expect(events.map(event => event.params.transaction_id)).toEqual([
            'mollie-payment-1',
            'stripe-session-2',
            'stripe-session-2',
        ])
        expect(events[2]).toMatchObject({
            name: 'refund',
            params: { value: 18, currency: 'EUR', provider: 'stripe' },
        })
    })

    test('does not send when analytics is disabled', async () => {
        getEnvFunctions.mockReturnValue({ ...enabledEnvironment, ANALYTICS_ENABLED: 'false' })

        await expect(logEvent('user-1', 'earn_gold', { amount: 10 })).resolves.toBe(false)
        expect(admin.firestore).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    test('normalizes supported server events and rejects client-owned events', () => {
        expect(normalizeServerEvent('personal_xp_quota_80')).toEqual({
            name: 'quota_threshold_reached',
            params: { scope: 'personal', quota_type: 'xp', threshold: 80 },
        })
        expect(normalizeServerEvent('new_task', { email: 'person@example.com' })).toBeNull()
    })

    test('maps each gold ledger event to a distinct virtual currency event', () => {
        expect(normalizeServerEvent('earn_gold', { amount: 100, source: 'monthly_gold' })).toEqual({
            name: 'earn_virtual_currency',
            params: { virtual_currency_name: 'gold', value: 100, source: 'monthly_gold' },
        })
        expect(normalizeServerEvent('spend_gold', { amount: 25, source: 'meeting_transcription' })).toEqual({
            name: 'spend_virtual_currency',
            params: { virtual_currency_name: 'gold', value: 25, source: 'meeting_transcription' },
        })
        expect(normalizeServerEvent('refund_gold', { amount: 25, source: 'vm_job' })).toEqual({
            name: 'refund_virtual_currency',
            params: { virtual_currency_name: 'gold', value: 25, source: 'vm_job' },
        })
        expect(normalizeServerEvent('adjust_gold', { amount: -40, source: 'admin_adjustment' })).toEqual({
            name: 'adjust_virtual_currency',
            params: { virtual_currency_name: 'gold', value: -40, source: 'admin_adjustment' },
        })
    })

    test('logs delivery failures without throwing into business logic', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 400 })

        await expect(purchaseEvent('user-1', 10, 'payment-1')).resolves.toBe(false)
        expect(functions.logger.error).toHaveBeenCalledWith(
            'Google Analytics event delivery failed',
            expect.objectContaining({ eventName: 'purchase', userId: 'user-1' })
        )
    })
})
