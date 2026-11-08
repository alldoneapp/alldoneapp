'use strict'

/**
 * What a client may ask deductGoldSecondGen for (security audit 2026-11,
 * gold-callables-client-chosen-amount).
 *
 * The ledger already refuses a delta whose sign does not match its direction, and
 * refundGoldSecondGen only gives back one of the caller's own charges (refundClientSpend). What was
 * still the client's choice was the SOURCE of a spend: any string, so a client could write ledger
 * entries under server sources (`vm_execution`, `assistant_usage`) and skew the goldStats rollups.
 * Only the sources the app starts itself are accepted, and a spend whose price belongs to somebody
 * else (an embedded alldone.team page) must be a positive whole amount under a cap.
 *
 * Rewards and goal unlocks no longer go through here (AT-2978): rewards are granted by the server
 * (serverGoldRewards.js) and a goal unlock charges and unlocks in one transaction
 * (Guides/unlockGuideGoal.js), so a client can neither pay itself nor unlock without paying.
 */

const MAX_IFRAME_DEDUCTION_GOLD = 10000

const CLIENT_SPEND_SOURCES = {
    iframe_deduction: { maxAmount: MAX_IFRAME_DEDUCTION_GOLD },
}

const SPEND_CONTEXT_FIELDS = ['projectId', 'goalId', 'objectId', 'objectType', 'channel', 'note']

function pickStrings(data, fields) {
    const picked = {}
    fields.forEach(field => {
        if (typeof data?.[field] === 'string' && data[field].trim()) picked[field] = data[field].trim()
    })
    return picked
}

function resolveClientSpend(data = {}) {
    const source = typeof data.source === 'string' ? data.source.trim() : ''
    const rule = CLIENT_SPEND_SOURCES[source]
    if (!rule) return { ok: false, message: 'This charge cannot be made from the app' }

    const amount = Number(data.gold)
    if (!Number.isInteger(amount) || amount <= 0 || amount > rule.maxAmount) {
        return { ok: false, message: 'Invalid gold amount' }
    }

    return { ok: true, amount, context: { ...pickStrings(data, SPEND_CONTEXT_FIELDS), source } }
}

module.exports = {
    resolveClientSpend,
    CLIENT_SPEND_SOURCES,
    MAX_IFRAME_DEDUCTION_GOLD,
}
