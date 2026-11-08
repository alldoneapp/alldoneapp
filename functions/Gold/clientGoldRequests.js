'use strict'

/**
 * What a client may ask the Gold callables for (security audit 2026-11,
 * gold-callables-client-chosen-amount).
 *
 * deductGoldSecondGen and earnGoldSecondGen take an amount from the browser. The ledger already
 * refuses a delta whose sign does not match its direction, and refundGoldSecondGen only gives back
 * one of the caller's own charges (refundClientSpend). What was still the client's choice:
 *
 * - the SOURCE of a spend: any string, so a client could write ledger entries under server
 *   sources (`vm_execution`, `assistant_usage`) and skew the goldStats rollups, and pay any price
 *   it liked for a goal unlock;
 * - the AMOUNT and the RECIPIENT of a reward, and the project and statistics document it lands in.
 *
 * Spends: only the sources the app starts itself are accepted. A fixed-price purchase is charged at
 * the server's price whatever the request says; a spend whose price belongs to somebody else (an
 * embedded alldone.team page) must be a positive whole amount under a cap. It is the caller's own
 * Gold either way.
 *
 * Rewards: the caller and the rewarded user must both be members of the project, and one call can
 * pay at most MAX_CLIENT_REWARD_GOLD. The daily cap (`dailyGold`, server-owned) still bounds the
 * total. Rewards are still decided in the browser; see CLAUDE.md "Nothing a client sends can create
 * Gold" for what moving them to the server would take.
 */

// Must equal UNLOCK_GOAL_COST in components/Guides/guidesHelper.js (pinned by clientGoldRequests.test.js).
const GOAL_UNLOCK_GOLD = 80
const MAX_IFRAME_DEDUCTION_GOLD = 10000

const CLIENT_SPEND_SOURCES = {
    goal_unlock: { fixedAmount: GOAL_UNLOCK_GOLD },
    iframe_deduction: { maxAmount: MAX_IFRAME_DEDUCTION_GOLD },
}

// MAX_GOLD_TO_EARN_BY_CHECK_TASKS (5) and MAX_GOLD_TO_EARN_BY_COMMENT (3) in TasksHelper.js.
const MAX_CLIENT_REWARD_GOLD = 5

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

    let amount
    if (rule.fixedAmount) {
        amount = rule.fixedAmount
    } else {
        amount = Number(data.gold)
        if (!Number.isInteger(amount) || amount <= 0 || amount > rule.maxAmount) {
            return { ok: false, message: 'Invalid gold amount' }
        }
    }

    return { ok: true, amount, context: { ...pickStrings(data, SPEND_CONTEXT_FIELDS), source } }
}

async function resolveClientReward(db, callerUid, data = {}) {
    const projectId = typeof data.projectId === 'string' ? data.projectId.trim() : ''
    const userId = typeof data.userId === 'string' ? data.userId.trim() : ''
    if (!callerUid || !projectId || !userId) return { ok: false, message: 'Invalid reward' }

    const gold = Number(data.gold)
    if (!Number.isInteger(gold) || gold <= 0) return { ok: false, message: 'Invalid gold amount' }

    // statistics/{projectId}/{userId}/{slimDate}: the date parts become a document path.
    const slimDate = typeof data.slimDate === 'string' ? data.slimDate : ''
    const dayDate = Number(data.dayDate)
    const timestamp = Number(data.timestamp)
    if (!/^\d{8}$/.test(slimDate) || !Number.isInteger(dayDate) || !Number.isFinite(timestamp)) {
        return { ok: false, message: 'Invalid reward date' }
    }

    const projectDoc = await db.doc(`projects/${projectId}`).get()
    const memberIds = projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    if (!memberIds.includes(callerUid) || !memberIds.includes(userId)) {
        return { ok: false, message: 'User has no access to project' }
    }

    return {
        ok: true,
        projectId,
        userId,
        gold: Math.min(gold, MAX_CLIENT_REWARD_GOLD),
        slimDate,
        dayDate,
        timestamp,
        context: pickStrings(data, ['rewardKey', 'objectId', 'objectType']),
    }
}

module.exports = {
    resolveClientSpend,
    resolveClientReward,
    CLIENT_SPEND_SOURCES,
    GOAL_UNLOCK_GOLD,
    MAX_CLIENT_REWARD_GOLD,
    MAX_IFRAME_DEDUCTION_GOLD,
}
