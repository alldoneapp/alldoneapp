'use strict'

// Revenue for the growth scoreboard, from actual payments, never from a price list.
//
// Stripe: the balance transactions of a period. They are what Stripe actually settled, in the
// settlement currency, with the real Stripe fee of every charge and refund — subscriptions and
// Gold packs alike, without a webhook of our own having to have seen them.
//
// Apple: Alldone never sees App Store money, only RevenueCat's webhook. Every RevenueCat event that
// carries a price is therefore recorded in `revenueEvents` (server-only, no client rule) as it
// arrives, with the tax and commission shares RevenueCat reports. Before this module the webhook
// kept a price only for Gold packs, so Apple subscription revenue starts counting from its deploy.
//
// VAT: Stripe amounts include the VAT the customer paid. The real tax of each invoice is not read
// yet, so an ESTIMATED share is deducted (STRIPE_VAT_SHARE_OF_GROSS); Apple events carry their own.

const admin = require('firebase-admin')
const { APPLE_DEFAULT_COMMISSION_SHARE, APPLE_DEFAULT_TAX_SHARE, FX_TO_EUR } = require('./growthConfig')

const REVENUE_EVENTS_COLLECTION = 'revenueEvents'

// ESTIMATE: 19% German VAT included in a gross price is 19/119 of it. B2B reverse-charge sales
// carry none, so this understates their revenue, which is the safe direction for a margin.
const STRIPE_VAT_SHARE_OF_GROSS = 0.16

// The most balance transactions one scoreboard run reads (100 per API page).
const MAX_STRIPE_TRANSACTIONS = 3000

const REVENUECAT_SUBSCRIPTION_EVENTS = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION']

const toEur = (amount, currency) => {
    const rate = FX_TO_EUR[String(currency || '').toUpperCase()]
    return Number.isFinite(amount) && Number.isFinite(rate) ? amount * rate : null
}

const shareOrDefault = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 && number < 1 ? number : fallback
}

// ---------------------------------------------------------------------------------------------
// RevenueCat (Apple)
// ---------------------------------------------------------------------------------------------

// The document recorded for one RevenueCat event, or null when the event carries no price.
// RevenueCat's `price` is in US dollars; a refund arrives with a negative price.
function buildRevenueCatRevenueEvent(event, { now = Date.now() } = {}) {
    if (!event || typeof event.id !== 'string' || !event.id) return null
    const priceUsd = Number(event.price)
    if (!Number.isFinite(priceUsd) || priceUsd === 0) return null

    let kind = 'other'
    if (priceUsd < 0) kind = 'refund'
    else if (event.type === 'NON_RENEWING_PURCHASE') kind = 'one_time'
    else if (REVENUECAT_SUBSCRIPTION_EVENTS.includes(event.type)) kind = 'subscription'

    const eventAt = Number(event.event_timestamp_ms) || Number(event.purchased_at_ms) || now
    const taxShare = event.tax_percentage == null ? null : shareOrDefault(event.tax_percentage, null)
    const commissionShare =
        event.commission_percentage == null ? null : shareOrDefault(event.commission_percentage, null)

    return {
        provider: 'apple',
        eventId: event.id,
        eventType: event.type || null,
        kind,
        userId: typeof event.app_user_id === 'string' && !event.app_user_id.includes('/') ? event.app_user_id : null,
        productId: typeof event.product_id === 'string' ? event.product_id.split(':')[0] : null,
        store: event.store || null,
        environment: event.environment || null,
        periodType: event.period_type || null,
        priceUsd,
        priceInPurchasedCurrency: Number.isFinite(Number(event.price_in_purchased_currency))
            ? Number(event.price_in_purchased_currency)
            : null,
        currency: event.currency || null,
        taxShare,
        commissionShare,
        eventAt,
        recordedAt: now,
    }
}

async function recordRevenueCatRevenue(event, { db = admin.firestore(), now = Date.now() } = {}) {
    const record = buildRevenueCatRevenueEvent(event, { now })
    if (!record) return null
    // Keyed by the RevenueCat event id, so a retried webhook writes the same document again.
    await db.doc(`${REVENUE_EVENTS_COLLECTION}/revenuecat_${record.eventId}`).set(record)
    return record
}

// One recorded Apple event as a scoreboard revenue row (EUR).
function normalizeAppleRevenueRow(record = {}) {
    const grossUsd = Number(record.priceUsd)
    if (!Number.isFinite(grossUsd)) return null
    const taxShare = shareOrDefault(record.taxShare, APPLE_DEFAULT_TAX_SHARE)
    const commissionShare = shareOrDefault(record.commissionShare, APPLE_DEFAULT_COMMISSION_SHARE)
    const taxUsd = grossUsd * taxShare
    const feeUsd = (grossUsd - taxUsd) * commissionShare
    const netUsd = grossUsd - taxUsd - feeUsd
    const productId = typeof record.productId === 'string' ? record.productId : ''
    return {
        provider: 'apple',
        kind: record.kind || 'other',
        userId: record.userId || null,
        periodDays: /yearly/.test(productId) ? 365 : /monthly/.test(productId) ? 30 : null,
        createdAt: Number(record.eventAt) || null,
        grossEur: toEur(grossUsd, 'USD'),
        feeEur: toEur(feeUsd, 'USD'),
        taxEur: toEur(taxUsd, 'USD'),
        netEur: toEur(netUsd, 'USD'),
        estimated: record.taxShare == null || record.commissionShare == null,
    }
}

async function readAppleRevenueRows({ db, from, to }) {
    const snapshot = await db
        .collection(REVENUE_EVENTS_COLLECTION)
        .where('eventAt', '>=', from)
        .where('eventAt', '<', to)
        .get()
    const rows = snapshot.docs
        .map(doc => doc.data() || {})
        .filter(record => record.provider === 'apple' && record.environment !== 'SANDBOX')
        .map(normalizeAppleRevenueRow)
        .filter(Boolean)
    return { rows, docsRead: snapshot.size }
}

// ---------------------------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------------------------

const STRIPE_CHARGE_TYPES = ['charge', 'payment']
const STRIPE_REFUND_TYPES = ['refund', 'payment_refund', 'payment_failure_refund']

function classifyStripeTransaction(transaction = {}) {
    const type = transaction.type || ''
    if (STRIPE_CHARGE_TYPES.includes(type)) {
        const source = transaction.source && typeof transaction.source === 'object' ? transaction.source : {}
        return source.invoice ? 'subscription' : 'one_time'
    }
    if (STRIPE_REFUND_TYPES.includes(type)) return 'refund'
    if (type.includes('fee')) return 'fee'
    return 'other'
}

// One balance transaction as a scoreboard revenue row (EUR). Amounts are in minor units of the
// settlement currency; `fee` is Stripe's own fee, `net` what reached the balance.
function normalizeStripeRevenueRow(transaction = {}) {
    const currency = String(transaction.currency || '').toUpperCase()
    const amount = Number(transaction.amount) / 100
    const fee = Number(transaction.fee) / 100 || 0
    if (!Number.isFinite(amount)) return null
    const kind = classifyStripeTransaction(transaction)
    const taxable = kind === 'subscription' || kind === 'one_time' || kind === 'refund'
    const tax = taxable ? amount * STRIPE_VAT_SHARE_OF_GROSS : 0
    const source = transaction.source && typeof transaction.source === 'object' ? transaction.source : {}
    return {
        provider: 'stripe',
        kind,
        userId: null,
        customerId: typeof source.customer === 'string' ? source.customer : null,
        paymentIntentId: typeof source.payment_intent === 'string' ? source.payment_intent : null,
        chargeId: kind === 'refund' && typeof source.charge === 'string' ? source.charge : null,
        createdAt: Number(transaction.created) * 1000 || null,
        grossEur: kind === 'fee' ? 0 : toEur(amount, currency),
        feeEur: toEur(kind === 'fee' ? -amount : fee, currency),
        taxEur: toEur(tax, currency),
        netEur: toEur(amount - (kind === 'fee' ? 0 : fee) - tax, currency),
        estimated: taxable,
    }
}

async function readStripeRevenueRows({ stripe, from, to }) {
    if (!stripe) return { rows: [], apiPages: 0, truncated: false, unavailable: true }
    const rows = []
    let startingAfter
    let apiPages = 0
    let truncated = false
    for (;;) {
        const page = await stripe.balanceTransactions.list({
            created: { gte: Math.floor(from / 1000), lt: Math.floor(to / 1000) },
            limit: 100,
            expand: ['data.source'],
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        })
        apiPages += 1
        const data = Array.isArray(page?.data) ? page.data : []
        data.forEach(transaction => {
            const row = normalizeStripeRevenueRow(transaction)
            if (row) rows.push(row)
        })
        if (!page?.has_more || data.length === 0) break
        if (rows.length >= MAX_STRIPE_TRANSACTIONS) {
            truncated = true
            break
        }
        startingAfter = data[data.length - 1].id
    }
    return { rows, apiPages, truncated, unavailable: false }
}

// Which Alldone user a Stripe row belongs to: the customer id stored on users/{uid} by the premium
// checker, else the Gold pack fulfillment of the same payment, else (for a refund) the customer of
// the refunded charge. Unresolved rows still count in totals, just not for a user.
async function resolveStripeRowUsers(rows, { db, stripe }) {
    const byCustomer = new Map()
    const byPaymentIntent = new Map()
    let docsRead = 0
    let apiCalls = 0

    const userForCustomer = async customerId => {
        if (!customerId) return null
        if (!byCustomer.has(customerId)) {
            const snapshot = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get()
            docsRead += snapshot.size || 1
            byCustomer.set(customerId, snapshot.empty ? null : snapshot.docs[0].id)
        }
        return byCustomer.get(customerId)
    }
    const userForPaymentIntent = async paymentIntentId => {
        if (!paymentIntentId) return null
        if (!byPaymentIntent.has(paymentIntentId)) {
            const snapshot = await db
                .collection('stripeGoldFulfillments')
                .where('paymentIntentId', '==', paymentIntentId)
                .limit(1)
                .get()
            docsRead += snapshot.size || 1
            byPaymentIntent.set(paymentIntentId, snapshot.empty ? null : (snapshot.docs[0].data() || {}).userId || null)
        }
        return byPaymentIntent.get(paymentIntentId)
    }

    for (const row of rows) {
        if (row.kind === 'fee' || row.kind === 'other') continue
        let userId = (await userForCustomer(row.customerId)) || (await userForPaymentIntent(row.paymentIntentId))
        if (!userId && row.chargeId && stripe) {
            try {
                const charge = await stripe.charges.retrieve(row.chargeId)
                apiCalls += 1
                userId =
                    (await userForCustomer(typeof charge?.customer === 'string' ? charge.customer : null)) ||
                    (await userForPaymentIntent(
                        typeof charge?.payment_intent === 'string' ? charge.payment_intent : null
                    ))
            } catch (error) {
                userId = null
            }
        }
        row.userId = userId || null
    }
    return { docsRead, apiCalls }
}

// How much of a row belongs to [from, to): a subscription payment is spread evenly over the period
// it pays for, so a yearly plan paid 200 days ago still counts in a 90-day window; anything else
// counts in full when it happened inside the window.
function recognizedInWindow(row, { from, to, periodDays }) {
    if (!row || row.netEur === null || !Number.isFinite(row.createdAt)) return 0
    if (row.kind === 'subscription' && Number.isFinite(periodDays) && periodDays > 0) {
        const periodMs = periodDays * 24 * 60 * 60 * 1000
        const overlap = Math.min(to, row.createdAt + periodMs) - Math.max(from, row.createdAt)
        return overlap > 0 ? (row.netEur * overlap) / periodMs : 0
    }
    return row.createdAt >= from && row.createdAt < to ? row.netEur : 0
}

// ---------------------------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------------------------

const round2 = value => Math.round((Number(value) || 0) * 100) / 100

function summarizeRevenue(rows = []) {
    const empty = () => ({ count: 0, grossEur: 0, feeEur: 0, taxEur: 0, netEur: 0 })
    const total = empty()
    const byProvider = {}
    const byKind = {}
    const add = (bucket, row) => {
        bucket.count += 1
        bucket.grossEur += row.grossEur || 0
        bucket.feeEur += row.feeEur || 0
        bucket.taxEur += row.taxEur || 0
        bucket.netEur += row.netEur || 0
    }
    let unresolvedUserCount = 0
    let estimatedCount = 0
    rows.forEach(row => {
        if (row.netEur === null) return
        add(total, row)
        add((byProvider[row.provider] = byProvider[row.provider] || empty()), row)
        add((byKind[row.kind] = byKind[row.kind] || empty()), row)
        if (!row.userId && row.kind !== 'fee' && row.kind !== 'other') unresolvedUserCount += 1
        if (row.estimated) estimatedCount += 1
    })
    const rounded = bucket => ({
        count: bucket.count,
        grossEur: round2(bucket.grossEur),
        feeEur: round2(bucket.feeEur),
        taxEur: round2(bucket.taxEur),
        netEur: round2(bucket.netEur),
    })
    return {
        ...rounded(total),
        byProvider: Object.fromEntries(Object.entries(byProvider).map(([key, value]) => [key, rounded(value)])),
        byKind: Object.fromEntries(Object.entries(byKind).map(([key, value]) => [key, rounded(value)])),
        unresolvedUserCount,
        estimatedCount,
    }
}

module.exports = {
    REVENUE_EVENTS_COLLECTION,
    STRIPE_VAT_SHARE_OF_GROSS,
    buildRevenueCatRevenueEvent,
    recordRevenueCatRevenue,
    normalizeAppleRevenueRow,
    readAppleRevenueRows,
    classifyStripeTransaction,
    normalizeStripeRevenueRow,
    readStripeRevenueRows,
    resolveStripeRowUsers,
    recognizedInWindow,
    summarizeRevenue,
    round2,
    toEur,
}
