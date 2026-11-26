'use strict'

const { consumeBookingQuota, getClientIp, hashKey } = require('./bookingRateLimit')

function makeDb() {
    const docs = new Map()
    const db = {
        docs,
        collection: name => ({ doc: id => ({ path: `${name}/${id}` }) }),
        runTransaction: async run =>
            run({
                get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
                set: (ref, data) => docs.set(ref.path, data),
            }),
    }
    return db
}

const limits = {
    ip: { limit: 2, windowMs: 1000 },
    page: { limit: 3, windowMs: 1000 },
    recipient: { limit: 1, windowMs: 1000 },
}

describe('public booking rate limits (security audit 2026-11, #10)', () => {
    test('caps how often one address can be mailed, across pages and IPs', async () => {
        const db = makeDb()
        const book = (ip, slug, recipientEmail, now = 0) =>
            consumeBookingQuota(db, { ip, pageUserId: `owner-${slug}`, slug, recipientEmail, now, limits })
        await expect(book('1.1.1.1', 'a', 'victim@example.com')).resolves.toEqual({ allowed: true })
        await expect(book('2.2.2.2', 'b', 'VICTIM@example.com')).resolves.toEqual({
            allowed: false,
            limitedBy: 'recipient',
        })
        // A refused attempt consumed nothing: page b and IP 2.2.2.2 still have their full budget.
        await expect(book('2.2.2.2', 'b', 'other@example.com')).resolves.toEqual({ allowed: true })
        await expect(book('3.3.3.3', 'a', 'victim@example.com', 1001)).resolves.toEqual({ allowed: true })
    })

    test('caps bookings per page and per IP', async () => {
        const db = makeDb()
        const results = []
        for (let index = 0; index < 4; index += 1) {
            results.push(
                await consumeBookingQuota(db, {
                    ip: `10.0.0.${index}`,
                    pageUserId: 'owner',
                    slug: 'page',
                    recipientEmail: `r${index}@example.com`,
                    now: 0,
                    limits,
                })
            )
        }
        expect(results.map(result => result.limitedBy || 'ok')).toEqual(['ok', 'ok', 'ok', 'page'])

        const ipDb = makeDb()
        const byIp = index =>
            consumeBookingQuota(ipDb, {
                ip: '9.9.9.9',
                pageUserId: `owner-${index}`,
                slug: `page-${index}`,
                recipientEmail: `r${index}@example.com`,
                now: 0,
                limits,
            })
        await byIp(1)
        await byIp(2)
        await expect(byIp(3)).resolves.toEqual({ allowed: false, limitedBy: 'ip' })
    })

    test('never stores an email address or IP as a document name', async () => {
        const db = makeDb()
        await consumeBookingQuota(db, {
            ip: '1.1.1.1',
            slug: 's',
            recipientEmail: 'victim@example.com',
            now: 0,
            limits,
        })
        const paths = [...db.docs.keys()].join(' ')
        expect(paths).not.toContain('victim')
        expect(paths).not.toContain('1.1.1.1')
        expect(paths).toContain(hashKey('recipient', 'victim@example.com'))
    })

    test('reads the client IP from the forwarding header first', () => {
        expect(getClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('1.2.3.4')
        expect(getClientIp({ headers: {}, ip: '5.6.7.8' })).toBe('5.6.7.8')
    })
})

describe('availability lookup limits (AT-3161)', () => {
    const { consumeSlotLookupQuota, SLOT_LOOKUP_LIMITS } = require('./bookingRateLimit')
    const slotLimits = { slotsIp: { limit: 2, windowMs: 1000 }, slotsPage: { limit: 3, windowMs: 1000 } }

    test('caps lookups per IP and per page, in buckets separate from bookings', async () => {
        const db = makeDb()
        const lookup = (ip, now = 0) =>
            consumeSlotLookupQuota(db, { ip, pageUserId: 'owner', slug: 'page', now, limits: slotLimits })

        await expect(lookup('1.1.1.1')).resolves.toEqual({ allowed: true })
        await expect(lookup('1.1.1.1')).resolves.toEqual({ allowed: true })
        await expect(lookup('1.1.1.1')).resolves.toEqual({ allowed: false, limitedBy: 'slotsIp' })
        await expect(lookup('2.2.2.2')).resolves.toEqual({ allowed: true })
        await expect(lookup('3.3.3.3')).resolves.toEqual({ allowed: false, limitedBy: 'slotsPage' })
        // A new window starts over.
        await expect(lookup('1.1.1.1', 1000)).resolves.toEqual({ allowed: true })
        // Booking quota is untouched by lookups.
        await expect(
            consumeBookingQuota(db, {
                ip: '1.1.1.1',
                pageUserId: 'owner',
                slug: 'page',
                recipientEmail: 'a@b.c',
                limits,
            })
        ).resolves.toEqual({ allowed: true })
    })

    test('the production page bucket is hourly, so exhausting it blocks a page for an hour at most', () => {
        expect(SLOT_LOOKUP_LIMITS.slotsPage.windowMs).toBe(60 * 60 * 1000)
        expect(SLOT_LOOKUP_LIMITS.slotsIp.limit).toBeGreaterThanOrEqual(100)
    })
})
