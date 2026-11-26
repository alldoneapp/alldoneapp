'use strict'

// AT-3161: double-booking protection for public booking pages.
//
// POST /api/booking/book re-checks the calendar before it creates the event, but the re-check and
// the event insert are two separate calls to Google/Microsoft. Two requests for the same (or an
// overlapping) slot that arrive together both pass the re-check and both create an event. A person
// clicking a button rarely hits that window; an agent that retries a slow call, or two agents told
// to "book the first free slot", hit it easily. So every booking for one host runs under a short
// lease lock, and inside it the stored bookings are checked as well, because a calendar's free/busy
// answer can lag behind an event that was just inserted (Microsoft's getSchedule in particular).
//
// The lock is a lease, not a mutex: a function instance that dies while holding it blocks the host
// for at most LEASE_MS. It lives in `bookingLocks/{sha256(userId)}`, server-only like
// `bookingRateLimits` (Firestore's default deny), with an `expiresAt` for a TTL policy.

const crypto = require('crypto')

const COLLECTION = 'bookingLocks'
// Longer than a booking takes (availability re-check + event insert, each bounded by provider
// timeouts) and shorter than the function timeout (120s).
const LEASE_MS = 90 * 1000
const DEFAULT_WAIT_MS = 15 * 1000
const RETRY_DELAY_MS = 400

const lockDocId = userId => crypto.createHash('sha256').update(`booking-lock:${userId}`).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function tryAcquire(db, userId, { now, token }) {
    const ref = db.collection(COLLECTION).doc(lockDocId(userId))
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const data = snapshot.exists ? snapshot.data() || {} : {}
        if (data.token && Number(data.leaseUntil) > now) return false
        transaction.set(ref, {
            token,
            leaseUntil: now + LEASE_MS,
            expiresAt: new Date(now + LEASE_MS + 60 * 60 * 1000),
        })
        return true
    })
}

async function release(db, userId, token) {
    const ref = db.collection(COLLECTION).doc(lockDocId(userId))
    try {
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            // Only the holder releases: after an expired lease somebody else may own it.
            if (snapshot.exists && snapshot.data()?.token === token) transaction.delete(ref)
        })
    } catch (error) {
        // The lease runs out on its own.
        console.warn('bookingLock: release failed', error?.message || error)
    }
}

/**
 * Runs `fn` while holding the host's booking lock. Waits up to `waitMs` for a concurrent booking of
 * the same host to finish. Returns { acquired: false } when it could not get the lock in time,
 * otherwise { acquired: true, result }.
 */
async function withHostBookingLock(
    db,
    userId,
    fn,
    { waitMs = DEFAULT_WAIT_MS, retryDelayMs = RETRY_DELAY_MS, clock = Date.now, wait = sleep } = {}
) {
    const token = crypto.randomBytes(16).toString('hex')
    const deadline = clock() + waitMs
    for (;;) {
        if (await tryAcquire(db, userId, { now: clock(), token })) break
        if (clock() + retryDelayMs > deadline) return { acquired: false }
        await wait(retryDelayMs)
    }
    try {
        return { acquired: true, result: await fn() }
    } finally {
        await release(db, userId, token)
    }
}

module.exports = { COLLECTION, LEASE_MS, lockDocId, withHostBookingLock }
