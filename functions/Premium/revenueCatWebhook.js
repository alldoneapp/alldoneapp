/**
 * RevenueCat webhook — Apple In-App Purchases for the iOS Capacitor shell.
 *
 * The iOS app buys through StoreKit via the RevenueCat SDK (configured with
 * the Firebase uid as the RevenueCat app_user_id), RevenueCat validates the
 * receipt and calls this endpoint for every purchase lifecycle event. This is
 * the ONLY place Apple purchases grant anything; the client never writes
 * premium status or Gold itself.
 *
 * Mirrors the Stripe path (`stripePremiumChecker.js`) deliberately:
 * - premium grant: dotted-path updates on users/{uid} `premium.*` (a nested
 *   `premium: {...}` update would replace the whole map)
 * - gold pack: transactional, idempotent fulfillment doc + the goldHelper
 *   ledger (source `gold_pack_purchase`, so the Gold history modal reuses the
 *   existing label), keyed on the RevenueCat event id.
 *
 * Auth: RevenueCat sends the configured Authorization header verbatim; we
 * compare against REVENUECAT_WEBHOOK_AUTH (must be listed in
 * envFunctionsHelper.js — the env blob is an allowlist, not a passthrough).
 * Sandbox events only grant when REVENUECAT_ALLOW_SANDBOX === 'true' (staging).
 */

const functions = require('firebase-functions')
const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { applyGoldChangeInTransaction } = require('../Gold/goldHelper')

const PLAN_STATUS_PREMIUM = 'premium'
const PLAN_STATUS_FREE = 'free'

const APPLE_GOLD_FULFILLMENTS_COLLECTION = 'appleIapGoldFulfillments'

// App Store product ids → what they grant. Keep in sync with App Store
// Connect and the RevenueCat offering, and with utils/revenueCatConfig.js on
// the client.
const SUBSCRIPTION_PRODUCTS = {
    alldone_premium_monthly: { planInterval: 'month' },
    alldone_premium_yearly: { planInterval: 'year' },
}
const GOLD_PRODUCTS = {
    alldone_gold_10000: { goldAmount: 10000 },
}

// Events that mean "the user currently has (or regained) access".
const GRANT_EVENT_TYPES = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']
// EXPIRATION is the only event that removes access. CANCELLATION merely turns
// auto-renew off — access runs until the period ends, exactly like Stripe's
// cancel-at-period-end, so it must NOT downgrade.
const REVOKE_EVENT_TYPES = ['EXPIRATION']

const stripProductSuffix = productId => {
    // StoreKit product ids sometimes arrive suffixed by RevenueCat with the
    // base plan / offer (e.g. "alldone_premium_monthly:promo"); the base id
    // is authoritative.
    return typeof productId === 'string' ? productId.split(':')[0] : ''
}

const resolveUserRef = appUserId => {
    // The client configures RevenueCat with the Firebase uid. RevenueCat
    // anonymous ids ($RCAnonymousID:...) mean the client failed to log in —
    // never grant against those.
    if (typeof appUserId !== 'string' || !appUserId || appUserId.startsWith('$RCAnonymousID')) return null
    return admin.firestore().doc(`users/${appUserId}`)
}

const grantPremium = async (userRef, event, planInterval) => {
    const update = {
        'premium.status': PLAN_STATUS_PREMIUM,
        'premium.source': 'apple_iap',
        'premium.lastChecked': FieldValue.serverTimestamp(),
        'premium.planInterval': planInterval,
    }
    if (event.expiration_at_ms) {
        update['premium.currentPeriodEnd'] = Math.floor(event.expiration_at_ms / 1000)
    }
    await userRef.update(update)
}

const revokePremium = async userRef => {
    await userRef.update({
        'premium.status': PLAN_STATUS_FREE,
        'premium.source': 'apple_iap',
        'premium.lastChecked': FieldValue.serverTimestamp(),
    })
}

const fulfillGoldPurchase = async (userRef, event, goldAmount) => {
    const fulfillmentRef = admin.firestore().doc(`${APPLE_GOLD_FULFILLMENTS_COLLECTION}/${event.id}`)
    let outcome = 'fulfilled'
    await admin.firestore().runTransaction(async transaction => {
        const [userDoc, fulfillmentDoc] = await Promise.all([transaction.get(userRef), transaction.get(fulfillmentRef)])
        if (fulfillmentDoc.exists) {
            outcome = 'already_fulfilled'
            return
        }
        if (!userDoc.exists) {
            outcome = 'user_not_found'
            return
        }
        const goldResult = applyGoldChangeInTransaction({
            transaction,
            userRef,
            userData: userDoc.data() || {},
            delta: goldAmount,
            direction: 'earn',
            source: 'gold_pack_purchase',
            context: {
                channel: 'apple_iap',
                objectId: event.transaction_id || event.id,
            },
        })
        if (!goldResult.success) {
            outcome = 'gold_update_failed'
            return
        }
        transaction.set(fulfillmentRef, {
            eventId: event.id,
            eventType: event.type,
            userId: userRef.id,
            productId: stripProductSuffix(event.product_id),
            transactionId: event.transaction_id || null,
            store: event.store || null,
            environment: event.environment || null,
            priceInPurchasedCurrency: event.price_in_purchased_currency ?? null,
            currency: event.currency || null,
            goldAmount,
            createdAt: FieldValue.serverTimestamp(),
        })
    })
    return outcome
}

/**
 * Pure-ish event dispatcher, exported for tests. Returns a short outcome
 * string; throws only on unexpected infrastructure errors (making RevenueCat
 * retry, which is safe because fulfillment is idempotent).
 */
const processRevenueCatEvent = async event => {
    if (!event || typeof event.type !== 'string') return 'ignored_malformed'

    const userRef = resolveUserRef(event.app_user_id)
    if (!userRef) return 'ignored_no_user'

    const productId = stripProductSuffix(event.product_id)

    if (GRANT_EVENT_TYPES.includes(event.type)) {
        const product = SUBSCRIPTION_PRODUCTS[productId]
        if (!product) return 'ignored_unknown_subscription_product'
        await grantPremium(userRef, event, product.planInterval)
        return 'premium_granted'
    }

    if (REVOKE_EVENT_TYPES.includes(event.type)) {
        if (!SUBSCRIPTION_PRODUCTS[productId]) return 'ignored_unknown_subscription_product'
        await revokePremium(userRef)
        return 'premium_revoked'
    }

    if (event.type === 'NON_RENEWING_PURCHASE') {
        const product = GOLD_PRODUCTS[productId]
        if (!product) return 'ignored_unknown_gold_product'
        return await fulfillGoldPurchase(userRef, event, product.goldAmount)
    }

    // CANCELLATION (auto-renew off), BILLING_ISSUE, TRANSFER, TEST, etc.:
    // recorded in the logs, no state change.
    return 'ignored_event_type'
}

const handleRevenueCatWebhook = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed')
        return
    }

    const { REVENUECAT_WEBHOOK_AUTH, REVENUECAT_ALLOW_SANDBOX } = getEnvFunctions()
    if (!REVENUECAT_WEBHOOK_AUTH) {
        functions.logger.error('RevenueCat webhook called but REVENUECAT_WEBHOOK_AUTH is not configured')
        res.status(500).send('Webhook not configured')
        return
    }
    if (req.headers.authorization !== REVENUECAT_WEBHOOK_AUTH) {
        functions.logger.warn('RevenueCat webhook rejected: bad authorization header')
        res.status(401).send('Unauthorized')
        return
    }

    const event = req.body?.event
    if (event?.environment === 'SANDBOX' && REVENUECAT_ALLOW_SANDBOX !== 'true') {
        functions.logger.info('RevenueCat sandbox event ignored', { type: event?.type, id: event?.id })
        res.status(200).send('Sandbox ignored')
        return
    }

    try {
        const outcome = await processRevenueCatEvent(event)
        functions.logger.info('RevenueCat webhook processed', {
            outcome,
            type: event?.type,
            id: event?.id,
            appUserId: event?.app_user_id,
            productId: stripProductSuffix(event?.product_id),
            environment: event?.environment,
        })
        res.status(200).send(outcome)
    } catch (error) {
        functions.logger.error('RevenueCat webhook failed', { error: error.message, type: event?.type, id: event?.id })
        // Non-2xx makes RevenueCat retry with backoff; fulfillment is
        // idempotent so retries are safe.
        res.status(500).send('Internal error')
    }
}

module.exports = {
    handleRevenueCatWebhook,
    processRevenueCatEvent,
    SUBSCRIPTION_PRODUCTS,
    GOLD_PRODUCTS,
    APPLE_GOLD_FULFILLMENTS_COLLECTION,
}
