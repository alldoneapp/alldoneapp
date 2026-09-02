'use strict'

// Billing dimensions for the gold rollups (AT-2487).
//
// `spendBySource` answers "which feature spent Gold". It cannot answer "why did that
// number move", because the amount charged for one unit of the same feature depends on
// how the run was billed and which model it talked to. The VM is the case that forced
// this: a run on a user's own Claude subscription or their own API key pays the 20-Gold
// base reserve and 10 Gold per minute of sandbox compute, but **zero** Gold for model
// tokens (`tokenBillingExempt` in vmJob.js / vmJobRunner.js). So `vm_execution` — 63% of
// August 2026's total spend — falls when users connect a subscription and falls when
// usage drops, and `goldStats` alone cannot tell those apart. Answering it meant reading
// `vmJobs` by hand and matching runs to ledger entries that carried no run id at all.
//
// These dimensions put the answer in the rollup. They are deliberately generic rather
// than VM-specific: any charge site that knows its model declares it, so `assistant_usage`
// (the second-largest spend line), Gmail labeling, the routing classifiers and the rambler
// are attributed by the same code.
//
// KEYS ARE SOURCE-SCOPED (`vm_execution__opus`, `assistant_usage__gpt-5-2`). Two reasons:
// a bare `opus` bucket would silently merge VM spend with any other future consumer of the
// same model, and a source-scoped bucket can be reconciled against the matching
// `spendBySource[source]` entry, which is what makes the numbers auditable rather than
// merely plausible. The dimension is written only by charge sites that actually declare
// it, so a source that has no model contributes nothing instead of an `unknown` bucket.

// Firestore field names are permissive, but a raw model id is not: `gpt-5.6-sol` carries a
// dot (which needs backtick quoting in every field path that reads it) and an OpenRouter id
// like `openrouter:deepseek/deepseek-v4-flash-0731` carries a colon and a solidus. Keys are
// therefore slugged down to `[a-z0-9_-]` so a rollup map stays directly addressable from the
// console, a `select` in BigQuery and a `FieldPath` in code. The raw value is kept verbatim
// on the ledger entry, so slugging loses nothing that cannot be recovered.
const MAX_KEY_SEGMENT_LENGTH = 60
const KEY_SEPARATOR = '__'

function sanitizeStatsKeySegment(value) {
    if (typeof value !== 'string') return ''
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
    return slug.slice(0, MAX_KEY_SEGMENT_LENGTH)
}

// `<source>__<value>`. A missing/unusable source still produces a usable key so a
// dimension is never dropped merely because the source string was malformed — it lands
// under `unknown__…`, exactly as `computeStatsDeltas` already does for `spendBySource`.
function buildStatsDimensionKey(source, value) {
    const valueSegment = sanitizeStatsKeySegment(value)
    if (!valueSegment) return ''
    const sourceSegment = sanitizeStatsKeySegment(source) || 'unknown'
    return `${sourceSegment}${KEY_SEPARATOR}${valueSegment}`
}

// Ledger field -> rollup map suffix + the value normalizer for that dimension.
//
// `billingExempt` is a TRISTATE on purpose and must stay one: `true` = the user's own
// subscription/API key paid for the model tokens, `false` = Alldone Gold paid for them,
// and ABSENT = the question does not apply to this charge (a Gmail label classification is
// always Gold-billed; there is no exempt version of it to compare against). Coercing an
// absent value to `false` would quietly declare every non-VM source "billed" and bloat the
// map with a constant, and coercing it to `true` would understate real Gold cost. Only
// charge sites where both answers are genuinely possible declare it.
const STATS_DIMENSIONS = [
    {
        field: 'billingExempt',
        suffix: 'ByBilling',
        normalize: value => {
            if (value === true) return 'exempt'
            if (value === false) return 'billed'
            return ''
        },
    },
    {
        field: 'model',
        suffix: 'ByModel',
        normalize: value => (typeof value === 'string' ? value : ''),
    },
]

// Given a stored ledger transaction and the rollup field name for its direction
// (`spend`, `refund`, …), return the `{ field, key, amount }` increments to apply.
// Amount is the same gross amount the direction bucket receives, so each dimension map
// is directly comparable with `spendBySource` rather than being on a different scale.
function computeStatsDimensions(transaction = {}, directionField, amount) {
    if (!directionField || !Number.isFinite(amount)) return []

    const source = typeof transaction.source === 'string' ? transaction.source : ''

    return STATS_DIMENSIONS.map(dimension => {
        const key = buildStatsDimensionKey(source, dimension.normalize(transaction[dimension.field]))
        if (!key) return null
        return { field: `${directionField}${dimension.suffix}`, key, amount }
    }).filter(Boolean)
}

module.exports = {
    KEY_SEPARATOR,
    MAX_KEY_SEGMENT_LENGTH,
    STATS_DIMENSIONS,
    sanitizeStatsKeySegment,
    buildStatsDimensionKey,
    computeStatsDimensions,
}
