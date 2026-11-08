'use strict'

/**
 * Binds the Mollie subscription callables to the signed-in payer (security audit 2026-11,
 * mollie-subscription-callables-unbound-userPayingId).
 *
 * They used to take the payer from `request.data.userPayingId` and only check that somebody was
 * signed in, so any account that knew a paying user's uid could re-price, extend, re-activate or
 * cancel that user's real Mollie subscription. The payer is now always `request.auth.uid`; a request
 * naming somebody else is refused. Seat lists are checked against the payer's stored subscription,
 * whose billing fields only Cloud Functions write (firestore.rules, `subscriptions/{userId}`).
 *
 * The one call a non-payer makes is a seat holder leaving a subscription somebody else pays for
 * (CancelSubscriptionPaidByOtherUserWrapper): that is allowed only for the caller's own seat.
 */

const { HttpsError } = require('firebase-functions/v2/https')

const MAX_SEAT_IDS = 500

function requireUid(request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')
    return uid
}

// The payer is the caller. A request may still carry userPayingId (the app sends its own uid); a
// different one is refused rather than silently replaced, so a mistake is visible.
function requireOwnPayer(request, field = 'userPayingId') {
    const uid = requireUid(request)
    const claimed = request?.data?.[field]
    if (claimed !== undefined && claimed !== null && claimed !== uid) {
        throw new HttpsError('permission-denied', 'You can only change your own subscription')
    }
    return uid
}

function normalizeUserIds(value, field) {
    if (!Array.isArray(value) || value.length > MAX_SEAT_IDS) {
        throw new HttpsError('invalid-argument', `${field} must be a list of user ids`)
    }
    const ids = value.map(id => (typeof id === 'string' ? id.trim() : ''))
    if (ids.some(id => !id || id.includes('/'))) {
        throw new HttpsError('invalid-argument', `${field} must be a list of user ids`)
    }
    return [...new Set(ids)]
}

async function loadSubscription(db, userPayingId) {
    const doc = await db.doc(`subscriptions/${userPayingId}`).get()
    if (!doc.exists) throw new HttpsError('failed-precondition', 'No subscription found')
    return doc.data() || {}
}

function assertSubset(ids, allowed, field) {
    const allowedIds = new Set(Array.isArray(allowed) ? allowed : [])
    if (ids.some(id => !allowedIds.has(id))) {
        throw new HttpsError('invalid-argument', `${field} contains users that are not on this subscription`)
    }
}

// Re-adding users the payer already paid for (no new payment): only ids from paidUsersIds.
async function resolvePaidSeatsToAdd(db, request) {
    const userPayingId = requireOwnPayer(request)
    const paidAddedUserIds = normalizeUserIds(request.data?.paidAddedUserIds, 'paidAddedUserIds')
    const subscription = await loadSubscription(db, userPayingId)
    assertSubset(paidAddedUserIds, subscription.paidUsersIds, 'paidAddedUserIds')
    return { userPayingId, paidAddedUserIds }
}

// Removing seats: only ids that currently hold one on the payer's subscription.
async function resolveSeatsToRemove(db, request) {
    const userPayingId = requireOwnPayer(request)
    const removedUserIds = normalizeUserIds(request.data?.removedUserIds, 'removedUserIds')
    const subscription = await loadSubscription(db, userPayingId)
    assertSubset(removedUserIds, subscription.activePaidUsersIds, 'removedUserIds')
    return { userPayingId, removedUserIds }
}

// Adding new seats the payer will pay for.
function resolveNewSeats(request) {
    const userPayingId = requireOwnPayer(request)
    return {
        userPayingId,
        newAddedUserIds: normalizeUserIds(request.data?.newAddedUserIds, 'newAddedUserIds'),
        newSelectedUserIds: normalizeUserIds(request.data?.newSelectedUserIds, 'newSelectedUserIds'),
        urlOrigin: typeof request.data?.urlOrigin === 'string' ? request.data.urlOrigin : '',
    }
}

// removeUserFromSubscriptionSecondGen: the payer removing one seat, or a seat holder leaving.
async function resolveSeatRemoval(db, request) {
    const uid = requireUid(request)
    const userPayingId = typeof request.data?.userPayingId === 'string' ? request.data.userPayingId.trim() : ''
    const userId = typeof request.data?.userId === 'string' ? request.data.userId.trim() : ''
    if (!userPayingId || !userId || userPayingId.includes('/')) {
        throw new HttpsError('invalid-argument', 'userPayingId and userId are required')
    }
    if (uid !== userPayingId && uid !== userId) {
        throw new HttpsError('permission-denied', 'You can only leave a subscription yourself')
    }
    const subscription = await loadSubscription(db, userPayingId)
    assertSubset([userId], subscription.activePaidUsersIds, 'userId')
    return { userPayingId, userId }
}

// createCompanySubscriptionSecondGen: the Mollie customer is the payer's own stored one (written by
// this function before, server-owned in firestore.rules), never one the request names.
async function resolveCompanySubscription(db, request) {
    const userId = requireOwnPayer(request, 'userId')
    const data = request.data || {}
    const [subscriptionDoc, userDoc] = await Promise.all([
        db.doc(`subscriptions/${userId}`).get(),
        db.doc(`users/${userId}`).get(),
    ])
    const storedCustomerId =
        (subscriptionDoc.exists && subscriptionDoc.data()?.customerId) ||
        (userDoc.exists && userDoc.data()?.customerId) ||
        ''
    return {
        customerId: typeof storedCustomerId === 'string' ? storedCustomerId : '',
        userId,
        userName: typeof data.userName === 'string' ? data.userName : '',
        userEmail: typeof data.userEmail === 'string' ? data.userEmail : '',
        selectedUserIds: normalizeUserIds(data.selectedUserIds, 'selectedUserIds'),
        companyData: data.companyData && typeof data.companyData === 'object' ? { ...data.companyData } : {},
        paymentMethod: data.paymentMethod,
        urlOrigin: typeof data.urlOrigin === 'string' ? data.urlOrigin : '',
    }
}

module.exports = {
    requireOwnPayer,
    resolvePaidSeatsToAdd,
    resolveSeatsToRemove,
    resolveNewSeats,
    resolveSeatRemoval,
    resolveCompanySubscription,
}
