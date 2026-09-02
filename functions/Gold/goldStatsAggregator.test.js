'use strict'

jest.mock('firebase-admin', () => ({
    firestore: {
        FieldValue: {
            increment: value => ({ __increment: value }),
            serverTimestamp: () => ({ __serverTimestamp: true }),
        },
    },
}))

const { computeStatsDeltas, resolveBucketDates } = require('./goldStatsAggregator')

describe('goldStatsAggregator.computeStatsDeltas', () => {
    test('earn adds gross amount, positive net, and a per-source breakdown', () => {
        expect(computeStatsDeltas({ direction: 'earn', amount: 100, source: 'monthly_gold' })).toEqual({
            deltas: { count: 1, net: 100, earn: 100, earnCount: 1 },
            bySource: { field: 'earnBySource', source: 'monthly_gold', amount: 100 },
        })
    })

    test('spend stays gross-positive in its bucket but subtracts from net', () => {
        expect(computeStatsDeltas({ direction: 'spend', amount: 25, source: 'meeting_transcription' })).toEqual({
            deltas: { count: 1, net: -25, spend: 25, spendCount: 1 },
            bySource: { field: 'spendBySource', source: 'meeting_transcription', amount: 25 },
        })
    })

    test('refund adds back to net with its own source bucket', () => {
        expect(computeStatsDeltas({ direction: 'refund', amount: 25, source: 'vm_job' })).toEqual({
            deltas: { count: 1, net: 25, refund: 25, refundCount: 1 },
            bySource: { field: 'refundBySource', source: 'vm_job', amount: 25 },
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
