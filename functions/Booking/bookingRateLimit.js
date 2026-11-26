'use strict'

// Security audit 2026-11 (#10): POST /api/booking/book is public and unauthenticated, and every
// accepted booking sends an Alldone-branded confirmation email to whatever address the caller
// typed. Without a limit that is a free mail relay with our sender reputation: one booking page
// (anybody can make one) can mail any number of strangers. Three independent fixed-window limits,
// all checked before the calendar is touched or a mail is sent:
//
//   - per client IP: an hourly limit; best-effort, because the address comes from a header,
//   - per booking page: a daily cap on bookings, which no header can get around,
//   - per recipient address: a daily cap across ALL pages, so no single person can be flooded.
//
// Counters live in `bookingRateLimits/{sha256(kind:value)}`, a collection with no client rule
// (Firestore's default deny keeps it server-only). Ids are hashed so no email address or IP
// becomes a document name; the documents carry an `expiresAt` for a TTL policy.

const crypto = require('crypto')

const COLLECTION = 'bookingRateLimits'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const BOOKING_LIMITS = {
    ip: { limit: 10, windowMs: HOUR_MS },
    page: { limit: 20, windowMs: DAY_MS },
    recipient: { limit: 3, windowMs: DAY_MS },
}

// AT-3161: availability lookups are public too, and every one of them reads the host's connected
// calendars (Google/Microsoft free/busy). The web page asks for one day per click, so a person
// browsing all 31 days in all three durations needs about 100 lookups; agents ask for whole ranges
// and need fewer. The limits only stop scripted hammering. The page bucket is hourly, not daily,
// so somebody who exhausts it on purpose blocks a booking page for at most an hour.
const SLOT_LOOKUP_LIMITS = {
    slotsIp: { limit: 300, windowMs: HOUR_MS },
    slotsPage: { limit: 1000, windowMs: HOUR_MS },
}

const hashKey = (kind, value) =>
    crypto
        .createHash('sha256')
        .update(`${kind}:${String(value || '').toLowerCase()}`)
        .digest('hex')

function getClientIp(req) {
    const forwarded = req?.headers?.['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
    return req?.ip || req?.connection?.remoteAddress || 'unknown'
}

// Consumes one unit from each bucket, or none when any of them is exhausted.
async function consumeQuotaBuckets(db, rawBuckets, { now, limits }) {
    const buckets = rawBuckets.filter(Boolean).map(bucket => ({
        ...bucket,
        ...limits[bucket.kind],
        ref: db.collection(COLLECTION).doc(hashKey(bucket.kind, bucket.value)),
    }))
    if (buckets.length === 0) return { allowed: true }

    return db.runTransaction(async transaction => {
        const snapshots = await Promise.all(buckets.map(bucket => transaction.get(bucket.ref)))
        const states = buckets.map((bucket, index) => {
            const data = snapshots[index].exists ? snapshots[index].data() || {} : {}
            const windowStart = Number(data.windowStart) || 0
            const fresh = now - windowStart >= bucket.windowMs
            return { bucket, windowStart: fresh ? now : windowStart, count: fresh ? 0 : Number(data.count) || 0 }
        })
        const exhausted = states.find(state => state.count >= state.bucket.limit)
        if (exhausted) return { allowed: false, limitedBy: exhausted.bucket.kind }
        states.forEach(({ bucket, windowStart, count }) =>
            transaction.set(bucket.ref, {
                kind: bucket.kind,
                windowStart,
                count: count + 1,
                updatedAt: now,
                expiresAt: new Date(windowStart + bucket.windowMs + DAY_MS),
            })
        )
        return { allowed: true }
    })
}

/**
 * Consumes one booking from each applicable bucket, or none when any of them is exhausted.
 * Returns { allowed: true } or { allowed: false, limitedBy: 'ip' | 'page' | 'recipient' }.
 */
async function consumeBookingQuota(
    db,
    { ip, pageUserId, slug, recipientEmail, now = Date.now(), limits = BOOKING_LIMITS }
) {
    return consumeQuotaBuckets(
        db,
        [
            ip ? { kind: 'ip', value: ip } : null,
            pageUserId || slug ? { kind: 'page', value: `${pageUserId || ''}/${slug || ''}` } : null,
            recipientEmail ? { kind: 'recipient', value: recipientEmail } : null,
        ],
        { now, limits }
    )
}

/**
 * AT-3161: one availability lookup, per client IP and per booking page.
 * Returns { allowed: true } or { allowed: false, limitedBy: 'slotsIp' | 'slotsPage' }.
 */
async function consumeSlotLookupQuota(db, { ip, pageUserId, slug, now = Date.now(), limits = SLOT_LOOKUP_LIMITS }) {
    return consumeQuotaBuckets(
        db,
        [
            ip ? { kind: 'slotsIp', value: ip } : null,
            pageUserId || slug ? { kind: 'slotsPage', value: `${pageUserId || ''}/${slug || ''}` } : null,
        ],
        { now, limits }
    )
}

module.exports = {
    BOOKING_LIMITS,
    COLLECTION,
    SLOT_LOOKUP_LIMITS,
    consumeBookingQuota,
    consumeSlotLookupQuota,
    getClientIp,
    hashKey,
}
