'use strict'

/**
 * A per-user fixed-window limit for callables that spend money or heavy compute on the caller's
 * behalf (security audit 2026-11: video conversion, IP geolocation). Kept in Firestore rather than
 * in instance memory because a callable scales out: a per-instance counter is a per-instance limit.
 *
 * `callableRateLimits/{name}__{uid}` has no client rule, so Firestore's default deny keeps it
 * server-only. The transaction costs one read and one write per call, which is fine for the
 * low-volume callables this is meant for; do not put it in front of a hot path.
 */

const { HttpsError } = require('firebase-functions/v2/https')

const COLLECTION = 'callableRateLimits'

async function consumeCallableQuota(db, { name, userId, limit, windowMs, now = Date.now() }) {
    if (!name || !userId) throw new HttpsError('invalid-argument', 'A rate limit needs a name and a user.')
    const ref = db.collection(COLLECTION).doc(`${name}__${userId}`)
    const allowed = await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref)
        const data = snap.exists ? snap.data() || {} : {}
        const windowStart = Number(data.windowStart) || 0
        const fresh = now - windowStart >= windowMs
        const count = fresh ? 0 : Number(data.count) || 0
        if (count >= limit) return false
        transaction.set(ref, {
            name,
            userId,
            windowStart: fresh ? now : windowStart,
            count: count + 1,
            updatedAt: now,
        })
        return true
    })
    if (!allowed) {
        throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.')
    }
}

module.exports = {
    COLLECTION,
    consumeCallableQuota,
}
