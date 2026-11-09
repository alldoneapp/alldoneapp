const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { OkrToolError, createOkr, updateOkr } = require('./okrToolService')

const P = 'proj1'
const USER = 'user1'
const OTHER = 'user2'
// 08.11.2026 20:00 in Berlin (UTC+1)
const NOW = Date.UTC(2026, 10, 8, 19, 0, 0)

const okrsIn = db =>
    [...db.docs.entries()]
        .filter(([path]) => path.startsWith(`okrs/${P}/projectOkrs/`))
        .map(([path, data]) => ({ id: path.split('/').pop(), ...data }))

const seeded = (extra = {}) =>
    createFakeFirestore({
        [`projects/${P}`]: { name: 'Alldone Growth', userIds: [USER, OTHER] },
        [`users/${USER}`]: { timezone: 1 },
        ...extra,
    })

const okrDoc = (extra = {}) => ({
    objectType: 'okr',
    type: 'manual',
    projectId: P,
    ownerId: USER,
    label: 'Paying customers',
    currentValue: 2,
    targetValue: 10,
    unit: 'customers',
    cadence: 'monthly',
    periodStart: Date.UTC(2026, 9, 31, 23, 0, 0),
    periodEnd: Date.UTC(2026, 10, 30, 22, 59, 59, 999),
    status: 'active',
    isPrivate: false,
    isPublicFor: [0],
    ...extra,
})

describe('create_okr', () => {
    test('writes the document the app writes, for the current period in the user timezone', async () => {
        const db = seeded()
        const result = await createOkr({
            db,
            projectId: P,
            userId: USER,
            args: { label: 'Paying customers from outreach', targetValue: 5, unit: 'customers' },
            now: NOW,
        })

        expect(result.success).toBe(true)
        const [okr] = okrsIn(db)
        expect(okr).toMatchObject({
            objectType: 'okr',
            type: 'manual',
            projectId: P,
            ownerId: USER,
            creatorId: USER,
            label: 'Paying customers from outreach',
            currentValue: 0,
            targetValue: 5,
            unit: 'customers',
            cadence: 'monthly',
            status: 'active',
            previousOkrId: null,
            isPrivate: false,
            isPublicFor: [0],
            lastEditorId: USER,
        })
        // November 2026 in UTC+1
        expect(okr.periodStart).toBe(Date.UTC(2026, 9, 31, 23, 0, 0))
        expect(okr.periodEnd).toBe(Date.UTC(2026, 10, 30, 22, 59, 59, 999))
        expect(okr.readerIds).toBeUndefined()
        expect(result.okr.progress).toBe(0)
    })

    test('the same label again in the same period returns the existing OKR', async () => {
        const db = seeded({ [`okrs/${P}/projectOkrs/o1`]: okrDoc() })
        const result = await createOkr({
            db,
            projectId: P,
            userId: USER,
            args: { label: ' paying customers ', targetValue: 12 },
            now: NOW,
        })
        expect(result).toMatchObject({ alreadyExists: true, okr: { id: 'o1' } })
        expect(okrsIn(db)).toHaveLength(1)
    })

    test('a revenue OKR takes no current value, and a private one is visible to its owner only', async () => {
        const db = seeded()
        await expect(
            createOkr({
                db,
                projectId: P,
                userId: USER,
                args: { label: 'Revenue', targetValue: 1000, type: 'timeLoggedRevenue', currentValue: 5 },
                now: NOW,
            })
        ).rejects.toThrow(OkrToolError)

        await createOkr({
            db,
            projectId: P,
            userId: USER,
            args: { label: 'Quiet one', targetValue: 3, isPrivate: true, cadence: 'weekly' },
            now: NOW,
        })
        const [okr] = okrsIn(db)
        expect(okr).toMatchObject({ isPrivate: true, isPublicFor: [USER], cadence: 'weekly' })
    })

    test('missing label or target, a bad cadence and non-members are refused', async () => {
        const db = seeded()
        await expect(createOkr({ db, projectId: P, userId: USER, args: { targetValue: 3 } })).rejects.toThrow(/label/)
        await expect(createOkr({ db, projectId: P, userId: USER, args: { label: 'x' } })).rejects.toThrow(/targetValue/)
        await expect(
            createOkr({ db, projectId: P, userId: USER, args: { label: 'x', targetValue: 0 } })
        ).rejects.toThrow(/greater than 0/)
        await expect(
            createOkr({ db, projectId: P, userId: USER, args: { label: 'x', targetValue: 1, cadence: 'yearly' } })
        ).rejects.toThrow(/cadence/)
        await expect(
            createOkr({ db, projectId: P, userId: 'stranger', args: { label: 'x', targetValue: 1 } })
        ).rejects.toThrow(/not a member/)
        expect(okrsIn(db)).toHaveLength(0)
    })
})

describe('update_okr', () => {
    test('progress is set or counted up, found by label', async () => {
        const db = seeded({ [`okrs/${P}/projectOkrs/o1`]: okrDoc() })
        const counted = await updateOkr({
            db,
            projectId: P,
            userId: USER,
            args: { okrLabel: 'paying', addToCurrentValue: 3 },
            now: NOW,
        })
        expect(counted).toMatchObject({ changes: ['current value'], okr: { currentValue: 5, progress: 50 } })
        expect(counted.message).toMatch(/50%/)

        await updateOkr({ db, projectId: P, userId: USER, args: { okrId: 'o1', currentValue: 8 }, now: NOW })
        expect(db.docs.get(`okrs/${P}/projectOkrs/o1`)).toMatchObject({
            currentValue: 8,
            lastEditionDate: NOW,
            lastEditorId: USER,
        })
    })

    test('target, label, unit and privacy change; an unchanged call writes nothing', async () => {
        const db = seeded({ [`okrs/${P}/projectOkrs/o1`]: okrDoc() })
        const result = await updateOkr({
            db,
            projectId: P,
            userId: USER,
            args: { okrId: 'o1', targetValue: 20, label: 'Paying customers (all)', unit: 'users', isPrivate: true },
            now: NOW,
        })
        expect(result.changes).toEqual(['label', 'target', 'unit', 'made private'])
        expect(db.docs.get(`okrs/${P}/projectOkrs/o1`)).toMatchObject({
            targetValue: 20,
            label: 'Paying customers (all)',
            unit: 'users',
            isPrivate: true,
            isPublicFor: [USER],
        })

        const writes = db.writes.length
        const unchanged = await updateOkr({ db, projectId: P, userId: USER, args: { okrId: 'o1', targetValue: 20 } })
        expect(unchanged.unchanged).toBe(true)
        expect(db.writes).toHaveLength(writes)
    })

    test("a new cadence starts that cadence's current period", async () => {
        const db = seeded({ [`okrs/${P}/projectOkrs/o1`]: okrDoc() })
        await updateOkr({ db, projectId: P, userId: USER, args: { okrId: 'o1', cadence: 'quarterly' }, now: NOW })
        expect(db.docs.get(`okrs/${P}/projectOkrs/o1`)).toMatchObject({
            cadence: 'quarterly',
            periodStart: Date.UTC(2026, 8, 30, 23, 0, 0),
            periodEnd: Date.UTC(2026, 11, 31, 22, 59, 59, 999),
        })
    })

    test("someone else's OKR and a revenue OKR's value are refused", async () => {
        const db = seeded({
            [`okrs/${P}/projectOkrs/o1`]: okrDoc({ ownerId: OTHER }),
            [`okrs/${P}/projectOkrs/o2`]: okrDoc({ type: 'timeLoggedRevenue', label: 'Revenue' }),
        })
        await expect(
            updateOkr({ db, projectId: P, userId: USER, args: { okrId: 'o1', currentValue: 3 } })
        ).rejects.toThrow(/only change your own/)
        await expect(
            updateOkr({ db, projectId: P, userId: USER, args: { okrId: 'o2', addToCurrentValue: 3 } })
        ).rejects.toThrow(/revenue OKR/)
        await expect(
            updateOkr({ db, projectId: P, userId: USER, args: { okrId: 'o2', currentValue: 1, addToCurrentValue: 1 } })
        ).rejects.toThrow(/either currentValue or addToCurrentValue/)
    })
})
