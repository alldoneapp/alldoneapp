'use strict'

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')
const moment = require('moment')
const { computeStatsDimensions } = require('./goldDimensions')

// Consent-independent rollups of the goldTransactions ledger. Unlike the Google
// Analytics events (which only fire for users who granted analytics consent),
// these aggregates are computed from every gold transaction, so they are the
// authoritative source for "how much gold was earned/spent per day / month".
//
// Layout:
//   goldStats/daily/days/{YYYY-MM-DD}
//   goldStats/monthly/months/{YYYY-MM}
//
// Buckets are computed in UTC so totals are stable regardless of where the
// function runs or where the user is. Each doc holds gross totals + counts per
// direction, a signed `net` (total change in circulating gold), and a per-source
// breakdown for earn/spend/refund (spendBySource is the feature-usage metric).
//
// Since AT-2487 each source-tracked direction also carries two billing dimensions —
// `spendByBilling` / `spendByModel` (and the refund equivalents), keyed `<source>__<value>`
// — so a spend line can be read across a billing-model change without joining `vmJobs` by
// hand. See goldDimensions.js for why the keys are shaped that way and why an undeclared
// dimension writes nothing.
const STATS_TIMEZONE = 'UTC'
const DAILY_FORMAT = 'YYYY-MM-DD'
const MONTHLY_FORMAT = 'YYYY-MM'

// Ledger direction (as stored by goldTransactions.js) -> rollup field name.
const DIRECTION_FIELDS = {
    earn: 'earn',
    spend: 'spend',
    refund: 'refund',
    adjustment: 'adjust',
}

// Directions that carry a meaningful per-source breakdown.
const SOURCE_TRACKED_DIRECTIONS = new Set(['earn', 'spend', 'refund'])

function resolveBucketDates(createdAt, fallbackTime) {
    let date = null

    if (createdAt && typeof createdAt.toDate === 'function') {
        date = createdAt.toDate()
    } else if (createdAt instanceof Date) {
        date = createdAt
    } else if (typeof createdAt === 'number' || typeof createdAt === 'string') {
        date = new Date(createdAt)
    } else if (fallbackTime) {
        date = new Date(fallbackTime)
    }

    if (!date) return null

    const parsed = moment.utc(date)
    if (!parsed.isValid()) return null

    return { day: parsed.format(DAILY_FORMAT), month: parsed.format(MONTHLY_FORMAT) }
}

// Pure (no Firestore dependency) so it is trivially unit-testable: given a stored
// gold transaction, returns the numeric deltas to apply to its rollup docs, or
// null when the transaction is not aggregatable.
function computeStatsDeltas(transaction = {}) {
    const direction = transaction.direction
    const field = DIRECTION_FIELDS[direction]
    if (!field) return null

    const amount = Number(transaction.amount)
    if (!Number.isFinite(amount) || amount < 0) return null

    const before = Number(transaction.balanceBefore)
    const after = Number(transaction.balanceAfter)
    const haveBalances = Number.isFinite(before) && Number.isFinite(after)

    // `fieldValue` is what lands in the direction's own bucket (gross positive for
    // earn/spend/refund, signed for adjustments). `netDelta` is the universal
    // contribution to circulating gold (earn/refund add, spend subtracts,
    // adjustments use the actual balance change).
    let fieldValue
    let netDelta
    if (direction === 'spend') {
        fieldValue = amount
        netDelta = -amount
    } else if (direction === 'adjustment') {
        const signed = haveBalances ? after - before : amount
        fieldValue = signed
        netDelta = signed
    } else {
        // earn, refund
        fieldValue = amount
        netDelta = amount
    }

    const deltas = {
        count: 1,
        net: netDelta,
        [field]: fieldValue,
        [`${field}Count`]: 1,
    }

    let bySource = null
    let dimensions = []
    if (SOURCE_TRACKED_DIRECTIONS.has(direction)) {
        const rawSource = typeof transaction.source === 'string' ? transaction.source.trim() : ''
        bySource = { field: `${field}BySource`, source: rawSource || 'unknown', amount }
        // Billing dimensions (AT-2487): `spendByBilling` / `spendByModel`, and the same
        // pair for refunds so a source's NET Gold cost stays decomposable. A transaction
        // that declares neither dimension produces nothing at all, so a charge site that
        // knows no model does not grow the rollup document.
        dimensions = computeStatsDimensions(transaction, field, amount)
    }

    return { deltas, bySource, dimensions }
}

function buildRollupPayload(labelKey, labelValue, { deltas, bySource, dimensions = [] }) {
    const payload = { [labelKey]: labelValue, updatedAt: FieldValue.serverTimestamp() }

    Object.entries(deltas).forEach(([key, value]) => {
        payload[key] = FieldValue.increment(value)
    })

    if (bySource) {
        payload[bySource.field] = { [bySource.source]: FieldValue.increment(bySource.amount) }
    }

    // Merged rather than assigned: `spendByBilling` and `spendByModel` are distinct maps,
    // but two dimensions could in future share one map, and an assignment would drop the
    // first silently. The set below runs with `{ merge: true }`, so each nested key becomes
    // its own field path and untouched keys in the same map are preserved.
    dimensions.forEach(({ field, key, amount: dimensionAmount }) => {
        payload[field] = { ...(payload[field] || {}), [key]: FieldValue.increment(dimensionAmount) }
    })

    return payload
}

// Applies one gold transaction to the daily + monthly rollups exactly once.
// Idempotency: the write runs in a Firestore transaction that stamps
// `aggregatedAt` on the source ledger doc and skips if it is already set. This
// guards against Cloud Functions at-least-once duplicate delivery double-counting
// and lets the backfill safely co-exist with the live trigger (each transaction
// is aggregated once, whichever path reaches it first). Stamping `aggregatedAt`
// is an update, so it does not re-fire the onDocumentCreated trigger.
async function recordGoldTransactionStats({ ref, data, eventTime }) {
    if (!ref || !data) return { applied: false, reason: 'missing-input' }

    const result = computeStatsDeltas(data)
    if (!result) return { applied: false, reason: 'unsupported' }

    const buckets = resolveBucketDates(data.createdAt, eventTime)
    if (!buckets) return { applied: false, reason: 'no-date' }

    const db = admin.firestore()
    const dailyRef = db.doc(`goldStats/daily/days/${buckets.day}`)
    const monthlyRef = db.doc(`goldStats/monthly/months/${buckets.month}`)

    let applied = false
    await db.runTransaction(async tx => {
        const sourceDoc = await tx.get(ref)
        if (!sourceDoc.exists || sourceDoc.get('aggregatedAt')) return

        tx.set(dailyRef, buildRollupPayload('date', buckets.day, result), { merge: true })
        tx.set(monthlyRef, buildRollupPayload('month', buckets.month, result), { merge: true })
        tx.update(ref, { aggregatedAt: FieldValue.serverTimestamp() })
        applied = true
    })

    return { applied, reason: applied ? 'applied' : 'already-aggregated', buckets }
}

// onDocumentCreated entrypoint for users/{userId}/goldTransactions/{transactionId}.
async function aggregateGoldTransaction(event) {
    const snapshot = event.data
    if (!snapshot) return

    try {
        await recordGoldTransactionStats({ ref: snapshot.ref, data: snapshot.data(), eventTime: event.time })
    } catch (error) {
        // Never let a stats failure surface back into the gold ledger write path.
        console.error('[goldStats] Failed to aggregate gold transaction', {
            path: snapshot.ref && snapshot.ref.path,
            error: error && error.message,
        })
    }
}

module.exports = {
    STATS_TIMEZONE,
    DIRECTION_FIELDS,
    resolveBucketDates,
    computeStatsDeltas,
    recordGoldTransactionStats,
    aggregateGoldTransaction,
}
