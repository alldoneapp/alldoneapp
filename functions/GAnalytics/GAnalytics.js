'use strict'

const admin = require('firebase-admin')
const functions = require('firebase-functions')

const { getEnvFunctions } = require('../envFunctionsHelper')

const MEASUREMENT_PROTOCOL_URL = 'https://region1.google-analytics.com/mp/collect'
const REQUEST_TIMEOUT_MS = 4000

const ALLOWED_PARAMETERS = new Set([
    'provider',
    'currency',
    'value',
    'transaction_id',
    'affiliation',
    'item_id',
    'item_name',
    'virtual_currency_name',
    'quota_type',
    'scope',
    'threshold',
    'source',
    'amount',
])

// Gold ledger events are mapped to one GA4 virtual-currency event each so earns,
// spends, refunds, and admin adjustments stay separate in reporting. Only
// earn_gold/spend_gold use GA4's recommended events; refunds and adjustments are
// custom events that would otherwise pollute the earn total.
const GOLD_LEDGER_EVENT_MAP = {
    earn_gold: 'earn_virtual_currency',
    spend_gold: 'spend_virtual_currency',
    refund_gold: 'refund_virtual_currency',
    adjust_gold: 'adjust_virtual_currency',
}

const sanitizeValue = value => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'string') return value.substring(0, 100)
    return undefined
}

const sanitizeParams = params => {
    return Object.entries(params || {}).reduce((sanitized, [key, value]) => {
        if (!ALLOWED_PARAMETERS.has(key)) return sanitized
        const sanitizedValue = sanitizeValue(value)
        if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue
        return sanitized
    }, {})
}

const normalizeServerEvent = (name, params = {}) => {
    if (name === 'purchase') {
        const sanitized = sanitizeParams(params)
        const itemId = sanitized.item_id
        const itemName = sanitized.item_name
        delete sanitized.item_id
        delete sanitized.item_name

        return {
            name,
            params: {
                ...sanitized,
                ...(itemId ? { items: [{ item_id: itemId, item_name: itemName || itemId }] } : {}),
            },
        }
    }

    if (['refund', 'earn_virtual_currency', 'spend_virtual_currency'].includes(name)) {
        return { name, params: sanitizeParams(params) }
    }

    const goldEventName = GOLD_LEDGER_EVENT_MAP[name]
    if (goldEventName) {
        return {
            name: goldEventName,
            params: sanitizeParams({
                virtual_currency_name: 'gold',
                value: Number(params.amount),
                source: params.source,
            }),
        }
    }

    const quotaMatch = /^(personal|project)_(xp|traffic)_quota_(50|80|100)$/.exec(name)
    if (quotaMatch) {
        return {
            name: 'quota_threshold_reached',
            params: {
                scope: quotaMatch[1],
                quota_type: quotaMatch[2],
                threshold: Number(quotaMatch[3]),
            },
        }
    }

    return null
}

const analyticsIsEnabled = env => {
    const enabled = env.ANALYTICS_ENABLED === true || env.ANALYTICS_ENABLED === 'true'
    return (
        enabled &&
        typeof env.GOOGLE_ANALYTICS_KEY === 'string' &&
        /^G-[A-Z0-9]+$/.test(env.GOOGLE_ANALYTICS_KEY) &&
        !!env.GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET
    )
}

const getAnalyticsIdentity = async userId => {
    if (!userId) return null

    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (!userDoc.exists) return null

    const analytics = userDoc.data()?.analytics
    if (analytics?.consent !== 'granted' || typeof analytics.clientId !== 'string' || !analytics.clientId) return null

    return { clientId: analytics.clientId, userId }
}

const postMeasurementEvent = async ({ apiSecret, measurementId, identity, event }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
        const response = await fetch(
            `${MEASUREMENT_PROTOCOL_URL}?measurement_id=${encodeURIComponent(
                measurementId
            )}&api_secret=${encodeURIComponent(apiSecret)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: identity.clientId,
                    user_id: identity.userId,
                    events: [event],
                }),
                signal: controller.signal,
            }
        )

        if (!response.ok) throw new Error(`Measurement Protocol returned HTTP ${response.status}`)
        return true
    } finally {
        clearTimeout(timeout)
    }
}

const logEvent = async (userId, name, params) => {
    try {
        const env = getEnvFunctions()
        if (!analyticsIsEnabled(env)) return false

        const event = normalizeServerEvent(name, params)
        if (!event) return false

        const identity = await getAnalyticsIdentity(userId)
        if (!identity) return false

        return await postMeasurementEvent({
            apiSecret: env.GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET,
            measurementId: env.GOOGLE_ANALYTICS_KEY,
            identity,
            event,
        })
    } catch (error) {
        functions.logger.error('Google Analytics event delivery failed', {
            eventName: name,
            userId,
            error: error.message,
        })
        return false
    }
}

const purchaseEvent = async (userId, value, transactionId, options = {}) => {
    const numericValue = Number(value)
    if (!transactionId || !Number.isFinite(numericValue)) return false

    return logEvent(userId, 'purchase', {
        transaction_id: transactionId,
        currency: String(options.currency || 'EUR').toUpperCase(),
        value: numericValue,
        affiliation: options.affiliation || options.provider || 'Alldone',
        provider: options.provider,
        item_id: options.itemId || 'subscription_payment',
        item_name: options.itemName || 'Subscription payment',
    })
}

const refundEvent = async (userId, transactionId, value, options = {}) => {
    const numericValue = Number(value)
    if (!transactionId || !Number.isFinite(numericValue)) return false

    return logEvent(userId, 'refund', {
        transaction_id: transactionId,
        currency: String(options.currency || 'EUR').toUpperCase(),
        value: numericValue,
        affiliation: options.affiliation || options.provider || 'Alldone',
        provider: options.provider,
    })
}

module.exports = {
    MEASUREMENT_PROTOCOL_URL,
    logEvent,
    purchaseEvent,
    refundEvent,
    normalizeServerEvent,
    sanitizeParams,
}
