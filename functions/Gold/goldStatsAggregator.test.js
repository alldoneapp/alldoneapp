'use strict'

const mockFirestore = { doc: jest.fn(), runTransaction: jest.fn() }

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => mockFirestore),
        {
            FieldValue: {
                increment: value => ({ __increment: value }),
                serverTimestamp: () => ({ __serverTimestamp: true }),
            },
        }
    ),
}))

// The aggregator reads FieldValue from the modular subpath (see the firebase-admin note in
// CLAUDE.md), so the rollup payload is only inspectable if THIS is the module that is mocked.
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        increment: value => ({ __increment: value }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
    },
}))

const { computeStatsDeltas, resolveBucketDates, recordGoldTransactionStats } = require('./goldStatsAggregator')

describe('goldStatsAggregator.computeStatsDeltas', () => {
    test('earn adds gross amount, positive net, and a per-source breakdown', () => {
        expect(computeStatsDeltas({ direction: 'earn', amount: 100, source: 'monthly_gold' })).toEqual({
            deltas: { count: 1, net: 100, earn: 100, earnCount: 1 },
            bySource: { field: 'earnBySource', source: 'monthly_gold', amount: 100 },
            dimensions: [],
        })
    })

    test('spend stays gross-positive in its bucket but subtracts from net', () => {
        expect(computeStatsDeltas({ direction: 'spend', amount: 25, source: 'meeting_transcription' })).toEqual({
            deltas: { count: 1, net: -25, spend: 25, spendCount: 1 },
            bySource: { field: 'spendBySource', source: 'meeting_transcription', amount: 25 },
            dimensions: [],
        })
    })

    test('refund adds back to net with its own source bucket', () => {
        expect(computeStatsDeltas({ direction: 'refund', amount: 25, source: 'vm_job' })).toEqual({
            deltas: { count: 1, net: 25, refund: 25, refundCount: 1 },
            bySource: { field: 'refundBySource', source: 'vm_job', amount: 25 },
            dimensions: [],
        })
    })

    test('negative adjustment uses the signed balance delta and tracks no source', () => {
        expect(
            computeStatsDeltas({
                direction: 'adjustment',
                amount: 40,
                balanceBefore: 100,
                balanceAfter: 60,
                source: 'admin_adjustment',
            })
        ).toEqual({
            deltas: { count: 1, net: -40, adjust: -40, adjustCount: 1 },
            bySource: null,
            dimensions: [],
        })
    })

    test('positive adjustment is signed positive', () => {
        const result = computeStatsDeltas({
            direction: 'adjustment',
            amount: 40,
            balanceBefore: 60,
            balanceAfter: 100,
        })
        expect(result.deltas).toEqual({ count: 1, net: 40, adjust: 40, adjustCount: 1 })
    })

    test('falls back to "unknown" source when missing', () => {
        const result = computeStatsDeltas({ direction: 'spend', amount: 5 })
        expect(result.bySource).toEqual({ field: 'spendBySource', source: 'unknown', amount: 5 })
    })

    test('rejects unsupported direction and invalid amounts', () => {
        expect(computeStatsDeltas({ direction: 'mystery', amount: 5 })).toBeNull()
        expect(computeStatsDeltas({ direction: 'spend', amount: 'abc' })).toBeNull()
        expect(computeStatsDeltas({ direction: 'spend', amount: -5 })).toBeNull()
        expect(computeStatsDeltas({})).toBeNull()
    })
})

describe('goldStatsAggregator.resolveBucketDates', () => {
    test('buckets a Firestore Timestamp in UTC', () => {
        const createdAt = { toDate: () => new Date('2026-06-30T23:30:00Z') }
        expect(resolveBucketDates(createdAt)).toEqual({ day: '2026-06-30', month: '2026-06' })
    })

    test('accepts a Date instance', () => {
        expect(resolveBucketDates(new Date('2026-01-05T10:00:00Z'))).toEqual({
            day: '2026-01-05',
            month: '2026-01',
        })
    })

    test('uses the fallback event time when createdAt is unresolved', () => {
        expect(resolveBucketDates(null, '2026-03-15T12:00:00Z')).toEqual({
            day: '2026-03-15',
            month: '2026-03',
        })
    })

    test('returns null when no usable date is available', () => {
        expect(resolveBucketDates(null, null)).toBeNull()
        expect(resolveBucketDates('not-a-date', null)).toBeNull()
    })
})

describe('goldStatsAggregator billing dimensions (AT-2487)', () => {
    test('a Gold-billed VM spend carries both dimensions alongside its source bucket', () => {
        expect(
            computeStatsDeltas({
                direction: 'spend',
                amount: 30,
                source: 'vm_execution',
                model: 'gpt-5.6-sol',
                billingExempt: false,
            })
        ).toEqual({
            deltas: { count: 1, net: -30, spend: 30, spendCount: 1 },
            bySource: { field: 'spendBySource', source: 'vm_execution', amount: 30 },
            dimensions: [
                { field: 'spendByBilling', key: 'vm_execution__billed', amount: 30 },
                { field: 'spendByModel', key: 'vm_execution__gpt-5-6-sol', amount: 30 },
            ],
        })
    })

    // The reason the task exists: this run still spends 20 base + 10/minute Gold, so it is
    // indistinguishable from a token-billed run in `spendBySource.vm_execution` alone.
    test('a subscription VM run lands in the exempt bucket, not out of the totals', () => {
        const result = computeStatsDeltas({
            direction: 'spend',
            amount: 20,
            source: 'vm_execution',
            model: 'opus',
            billingExempt: true,
        })
        expect(result.deltas.spend).toBe(20)
        expect(result.bySource).toEqual({ field: 'spendBySource', source: 'vm_execution', amount: 20 })
        expect(result.dimensions).toContainEqual({
            field: 'spendByBilling',
            key: 'vm_execution__exempt',
            amount: 20,
        })
    })

    test('an adjustment tracks no dimensions, exactly as it tracks no source', () => {
        const result = computeStatsDeltas({
            direction: 'adjustment',
            amount: 40,
            balanceBefore: 100,
            balanceAfter: 60,
            source: 'vm_execution',
            model: 'opus',
            billingExempt: true,
        })
        expect(result.bySource).toBeNull()
        expect(result.dimensions).toEqual([])
    })
})

describe('goldStatsAggregator.recordGoldTransactionStats write shape', () => {
    function setUp({ transaction, sourceExists = true, aggregatedAt = null }) {
        const writes = []
        const updates = []
        mockFirestore.doc.mockImplementation(path => ({ path }))
        mockFirestore.runTransaction.mockImplementation(async fn =>
            fn({
                get: async () => ({
                    exists: sourceExists,
                    get: field => (field === 'aggregatedAt' ? aggregatedAt : undefined),
                }),
                set: (ref, payload, options) => writes.push({ path: ref.path, payload, options }),
                update: (ref, payload) => updates.push({ path: ref.path, payload }),
            })
        )
        return {
            writes,
            updates,
            run: () =>
                recordGoldTransactionStats({
                    ref: { path: 'users/u1/goldTransactions/t1' },
                    data: transaction,
                }),
        }
    }

    beforeEach(() => {
        mockFirestore.doc.mockReset()
        mockFirestore.runTransaction.mockReset()
    })

    test('writes the dimension maps into both the daily and monthly rollups', async () => {
        const { writes, run } = setUp({
            transaction: {
                direction: 'spend',
                amount: 30,
                source: 'vm_execution',
                model: 'opus',
                billingExempt: true,
                createdAt: new Date('2026-09-02T07:30:00Z'),
            },
        })

        const result = await run()
        expect(result.applied).toBe(true)
        expect(writes.map(w => w.path)).toEqual(['goldStats/daily/days/2026-09-02', 'goldStats/monthly/months/2026-09'])

        writes.forEach(({ payload, options }) => {
            // merge:true is what lets each nested key become its own field path, so two
            // different models incrementing the same map do not overwrite one another.
            expect(options).toEqual({ merge: true })
            expect(payload.spend).toEqual({ __increment: 30 })
            expect(payload.spendBySource).toEqual({ vm_execution: { __increment: 30 } })
            expect(payload.spendByBilling).toEqual({ vm_execution__exempt: { __increment: 30 } })
            expect(payload.spendByModel).toEqual({ vm_execution__opus: { __increment: 30 } })
        })
    })

    // Compatibility: everything already in production writes exactly what it wrote before.
    test('a transaction declaring no dimensions writes no dimension fields at all', async () => {
        const { writes, run } = setUp({
            transaction: {
                direction: 'spend',
                amount: 5,
                source: 'iframe_deduction',
                createdAt: new Date('2026-09-02T07:30:00Z'),
            },
        })

        await run()
        writes.forEach(({ payload }) => {
            expect(payload.spendBySource).toEqual({ iframe_deduction: { __increment: 5 } })
            expect(payload).not.toHaveProperty('spendByBilling')
            expect(payload).not.toHaveProperty('spendByModel')
        })
    })

    test('still refuses to double-count an already-aggregated entry', async () => {
        const { writes, run } = setUp({
            transaction: {
                direction: 'spend',
                amount: 30,
                source: 'vm_execution',
                model: 'opus',
                billingExempt: true,
                createdAt: new Date('2026-09-02T07:30:00Z'),
            },
            aggregatedAt: 'already',
        })

        const result = await run()
        expect(result.applied).toBe(false)
        expect(writes).toEqual([])
    })
})
