'use strict'

const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { COLLECTION, LEASE_MS, lockDocId, withHostBookingLock } = require('./bookingLock')

// Real Firestore serializes conflicting transactions; the fake needs help to do the same.
function serializedDb() {
    const db = createFakeFirestore()
    const run = db.runTransaction
    let chain = Promise.resolve()
    db.runTransaction = fn => {
        const next = chain.then(() => run(fn))
        chain = next.catch(() => {})
        return next
    }
    return db
}

describe('host booking lock (AT-3161)', () => {
    test('runs the function, then releases the lock', async () => {
        const db = serializedDb()

        const outcome = await withHostBookingLock(db, 'host-1', async () => 'booked')

        expect(outcome).toEqual({ acquired: true, result: 'booked' })
        expect(db.docs.has(`${COLLECTION}/${lockDocId('host-1')}`)).toBe(false)
    })

    test('serializes two bookings of the same host', async () => {
        const db = serializedDb()
        const order = []
        let releaseFirst
        const first = withHostBookingLock(db, 'host-1', async () => {
            order.push('first:start')
            await new Promise(resolve => {
                releaseFirst = resolve
            })
            order.push('first:end')
        })
        while (!releaseFirst) await new Promise(resolve => setImmediate(resolve))

        const second = withHostBookingLock(
            db,
            'host-1',
            async () => {
                order.push('second')
            },
            { retryDelayMs: 5, waitMs: 2000 }
        )
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(order).toEqual(['first:start'])
        releaseFirst()
        await Promise.all([first, second])

        expect(order).toEqual(['first:start', 'first:end', 'second'])
    })

    test('different hosts do not wait for each other', async () => {
        const db = serializedDb()
        let releaseFirst
        const first = withHostBookingLock(db, 'host-1', () => new Promise(resolve => (releaseFirst = resolve)))
        while (!releaseFirst) await new Promise(resolve => setImmediate(resolve))

        await expect(withHostBookingLock(db, 'host-2', async () => 'other', { waitMs: 0 })).resolves.toEqual({
            acquired: true,
            result: 'other',
        })
        releaseFirst()
        await first
    })

    test('gives up after the wait time while another booking holds the lease', async () => {
        const db = serializedDb()
        let clock = 1000
        await db.doc(`${COLLECTION}/${lockDocId('host-1')}`).set({ token: 'other', leaseUntil: 1000 + LEASE_MS })
        const fn = jest.fn()

        const outcome = await withHostBookingLock(db, 'host-1', fn, {
            waitMs: 1000,
            retryDelayMs: 400,
            clock: () => clock,
            wait: async ms => {
                clock += ms
            },
        })

        expect(outcome).toEqual({ acquired: false })
        expect(fn).not.toHaveBeenCalled()
        // The other holder's lease is untouched.
        expect(db.docs.get(`${COLLECTION}/${lockDocId('host-1')}`).token).toBe('other')
    })

    test('takes over an expired lease and still releases the lock when the function throws', async () => {
        const db = serializedDb()
        await db.doc(`${COLLECTION}/${lockDocId('host-1')}`).set({ token: 'dead', leaseUntil: 5 })

        await expect(
            withHostBookingLock(
                db,
                'host-1',
                async () => {
                    throw new Error('calendar down')
                },
                { clock: () => 10 }
            )
        ).rejects.toThrow('calendar down')
        expect(db.docs.has(`${COLLECTION}/${lockDocId('host-1')}`)).toBe(false)
    })

    test('the lock id does not contain the user id', () => {
        expect(lockDocId('host-1')).not.toContain('host-1')
        expect(lockDocId('host-1')).toMatch(/^[a-f0-9]{64}$/)
    })
})
