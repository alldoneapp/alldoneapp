'use strict'

// Contribution margin per paying user, kept only as a distribution (growth scoreboard).
//
// margin = revenue after fees and taxes - estimated upstream cost of the Gold the user spent,
// both over the same trailing window. Individual users never leave this module: the scoreboard
// stores counts, sums and percentiles, broken down by plan, by how long the account exists and by
// signup source, so a segment can be judged without naming anybody.

const { capBreakdown } = require('./growthSignups')

const round2 = value => Math.round((Number(value) || 0) * 100) / 100

function percentile(sorted, fraction) {
    if (sorted.length === 0) return null
    const position = (sorted.length - 1) * fraction
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
    return round2(value)
}

const tenureBucket = days => {
    if (!Number.isFinite(days)) return 'unknown'
    if (days < 30) return 'under_30_days'
    if (days < 90) return '30_to_89_days'
    return '90_days_or_more'
}

function summarizeGroup(payers) {
    const margins = payers.map(payer => payer.revenueEur - payer.costEur).sort((a, b) => a - b)
    return {
        payingUsers: payers.length,
        profitableUsers: margins.filter(margin => margin > 0).length,
        revenueEur: round2(payers.reduce((sum, payer) => sum + payer.revenueEur, 0)),
        costEur: round2(payers.reduce((sum, payer) => sum + payer.costEur, 0)),
        marginEur: round2(margins.reduce((sum, margin) => sum + margin, 0)),
        medianMarginEur: percentile(margins, 0.5),
    }
}

function groupBy(payers, keyOf) {
    const groups = {}
    payers.forEach(payer => {
        const key = keyOf(payer)
        groups[key] = groups[key] || []
        groups[key].push(payer)
    })
    return Object.fromEntries(Object.entries(groups).map(([key, members]) => [key, summarizeGroup(members)]))
}

// payers: [{ revenueEur, costEur, plan, tenureDays, source }]
function summarizeMargins(payers = [], { windowDays } = {}) {
    const valid = payers.filter(payer => Number.isFinite(payer.revenueEur) && Number.isFinite(payer.costEur))
    const margins = valid.map(payer => payer.revenueEur - payer.costEur).sort((a, b) => a - b)
    return {
        windowDays,
        ...summarizeGroup(valid),
        percentilesEur: {
            p10: percentile(margins, 0.1),
            p25: percentile(margins, 0.25),
            p50: percentile(margins, 0.5),
            p75: percentile(margins, 0.75),
            p90: percentile(margins, 0.9),
        },
        byPlan: groupBy(valid, payer => payer.plan || 'none'),
        byTenure: groupBy(valid, payer => tenureBucket(payer.tenureDays)),
        bySignupSource: capBreakdown(
            groupBy(valid, payer => payer.source || 'unknown'),
            value => value.payingUsers
        ),
    }
}

module.exports = { percentile, summarizeMargins, tenureBucket, round2 }
