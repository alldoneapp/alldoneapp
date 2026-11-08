'use strict'

// The growth scoreboard: one server-only document per UTC day at growthMetrics/daily/days/{day},
// the reward signal of the growth loop. Written by the daily `growthScoreboardSecondGen` schedule;
// no client rule exists for `growthMetrics` or `revenueEvents`, so the catch-all deny keeps both
// out of every browser and every agent. A private artifact renders it (growthScoreboardArtifact.js).
//
// What one run reads, all bounded by design (reported in `run` on the document):
//   - Firebase Auth user list (API pages, no Firestore reads) for the signup dates
//   - the user and attribution documents of three days' signups, their tasks and Gold ledgers
//   - three count() queries for active users, one query for premium users
//   - one goldStats rollup, the Stripe balance transactions of the day, recorded Apple events
//   - the Growth project's contacts (outreach pipeline) and two GA4 reports per readable property
//   - on the weekly margin run: every paying user's Gold ledger over MARGIN_WINDOW_DAYS
//
// Every value is an aggregate: counts, sums, percentiles. No email, name or user id is written to
// the daily document; the only ids kept are the premium user ids in the server-only state
// document, which the next run needs to count who started and who stopped paying.

const admin = require('firebase-admin')
const moment = require('moment')
const {
    ACTIVATION_LONG_WINDOW_DAYS,
    ACTIVATION_SHORT_WINDOW_DAYS,
    EXCLUDED_USER_IDS,
    FX_TO_EUR,
    MARGIN_WEEKDAY_UTC,
    MARGIN_WINDOW_DAYS,
    MAX_BREAKDOWN_KEYS,
} = require('./growthConfig')
const { estimateRollupCostUsdBySource, estimateTransactionCostUsd } = require('./growthCostModel')
const {
    readAppleRevenueRows,
    readStripeRevenueRows,
    recognizedInWindow,
    resolveStripeRowUsers,
    round2,
    summarizeRevenue,
} = require('./growthRevenue')
const {
    DAY_MS,
    capBreakdown,
    evaluateActivation,
    resolveSignupCampaign,
    resolveSignupSource,
    summarizeCohort,
    toMillis,
} = require('./growthSignups')
const { summarizeMargins } = require('./growthMargin')
const { readTraffic } = require('./growthTraffic')
const { SCOREBOARD_ARTIFACT_TARGETS } = require('./growthConfig')

const METRICS_DAYS_COLLECTION = 'growthMetrics/daily/days'
const STATE_DOC = 'growthMetrics/state'
const GET_ALL_CHUNK = 100
const MAX_TASKS_PER_PROJECT = 50
const MAX_PROJECTS_PER_SIGNUP = 5

const usdToEur = usd => usd * FX_TO_EUR.USD

const dayStartOf = day => moment.utc(day, 'YYYY-MM-DD', true).valueOf()
const dayKey = ms => moment.utc(ms).format('YYYY-MM-DD')

async function getAllInChunks(db, refs, counter) {
    const snapshots = []
    for (let index = 0; index < refs.length; index += GET_ALL_CHUNK) {
        const chunk = refs.slice(index, index + GET_ALL_CHUNK)
        if (chunk.length === 0) continue
        const result = await db.getAll(...chunk)
        counter.firestoreDocs += chunk.length
        snapshots.push(...result)
    }
    return snapshots
}

// Every account's creation time, from Firebase Auth. Anonymous accounts (a visitor opening a shared
// link signs in anonymously) have neither an email nor a provider and are not signups.
async function listAccountCreationTimes(auth, counter) {
    const createdAtByUid = new Map()
    let pageToken
    do {
        const page = await auth.listUsers(1000, pageToken)
        counter.authPages += 1
        ;(page.users || []).forEach(user => {
            const isAnonymous = !user.email && (!user.providerData || user.providerData.length === 0)
            if (isAnonymous) return
            const createdAt = Date.parse(user.metadata && user.metadata.creationTime)
            if (Number.isFinite(createdAt)) createdAtByUid.set(user.uid, createdAt)
        })
        pageToken = page.pageToken
    } while (pageToken)
    return createdAtByUid
}

async function readAdministratorId(db, counter) {
    const snapshot = await db.doc('roles/administrator').get()
    counter.firestoreDocs += 1
    return snapshot.exists ? (snapshot.data() || {}).userId || null : null
}

async function readGoldTransactions(db, userId, from, to, counter) {
    const snapshot = await db
        .collection(`users/${userId}/goldTransactions`)
        .where('createdAt', '>=', new Date(from))
        .where('createdAt', '<', new Date(to))
        .select('direction', 'amount', 'source', 'model', 'billingExempt', 'createdAt')
        .get()
    counter.firestoreDocs += snapshot.size
    return snapshot.docs.map(doc => doc.data() || {})
}

async function readCreatedTaskTimes(db, userId, projectIds, counter) {
    const times = []
    for (const projectId of projectIds.slice(0, MAX_PROJECTS_PER_SIGNUP)) {
        if (typeof projectId !== 'string' || !projectId || projectId.includes('/')) continue
        const snapshot = await db
            .collection(`items/${projectId}/tasks`)
            .where('creatorId', '==', userId)
            .select('created')
            .limit(MAX_TASKS_PER_PROJECT)
            .get()
        counter.firestoreDocs += snapshot.size || 1
        snapshot.docs.forEach(doc => times.push(toMillis((doc.data() || {}).created)))
    }
    return times
}

// Signups of the report day, and the two cohorts whose activation windows just closed.
async function computeSignups({ db, createdAtByUid, reportDayStart, counter }) {
    const ranges = {
        report: reportDayStart,
        short: reportDayStart - ACTIVATION_SHORT_WINDOW_DAYS * DAY_MS,
        long: reportDayStart - ACTIVATION_LONG_WINDOW_DAYS * DAY_MS,
    }
    const members = { report: [], short: [], long: [] }
    createdAtByUid.forEach((createdAt, uid) => {
        Object.entries(ranges).forEach(([name, start]) => {
            if (createdAt >= start && createdAt < start + DAY_MS) members[name].push({ uid, createdAt })
        })
    })

    const all = [...members.report, ...members.short, ...members.long]
    const userRefs = all.map(member => db.doc(`users/${member.uid}`))
    const attributionRefs = all.map(member => db.doc(`users/${member.uid}/private/signupAttribution`))
    const [userSnapshots, attributionSnapshots] = await Promise.all([
        getAllInChunks(db, userRefs, counter),
        getAllInChunks(db, attributionRefs, counter),
    ])
    all.forEach((member, index) => {
        member.exists = !!(userSnapshots[index] && userSnapshots[index].exists)
        member.userData = member.exists ? userSnapshots[index].data() || {} : {}
        const attribution =
            attributionSnapshots[index] && attributionSnapshots[index].exists
                ? attributionSnapshots[index].data() || {}
                : null
        member.source = resolveSignupSource(attribution)
        member.campaign = resolveSignupCampaign(attribution)
        member.hasAttribution = !!attribution
    })

    const reportMembers = members.report.filter(member => member.exists)
    const bySource = {}
    const byCampaign = {}
    reportMembers.forEach(member => {
        bySource[member.source] = (bySource[member.source] || 0) + 1
        if (member.campaign) byCampaign[member.campaign] = (byCampaign[member.campaign] || 0) + 1
    })

    const evaluate = async (member, windowDays) => {
        const end = member.createdAt + windowDays * DAY_MS
        const [goldTransactions, taskCreatedAt] = await Promise.all([
            readGoldTransactions(db, member.uid, member.createdAt, end, counter),
            windowDays === ACTIVATION_SHORT_WINDOW_DAYS
                ? readCreatedTaskTimes(
                      db,
                      member.uid,
                      Array.isArray(member.userData.projectIds) ? member.userData.projectIds : [],
                      counter
                  )
                : Promise.resolve([]),
        ])
        member.activation = evaluateActivation({
            signupAt: member.createdAt,
            taskCreatedAt,
            goldTransactions,
            userData: member.userData,
        })
    }

    const shortMembers = members.short.filter(member => member.exists)
    const longMembers = members.long.filter(member => member.exists)
    for (const member of shortMembers) await evaluate(member, ACTIVATION_SHORT_WINDOW_DAYS)
    for (const member of longMembers) await evaluate(member, ACTIVATION_LONG_WINDOW_DAYS)

    return {
        signups: {
            count: reportMembers.length,
            withAttribution: reportMembers.filter(member => member.hasAttribution).length,
            bySource: capBreakdown(bySource),
            byCampaign: capBreakdown(byCampaign),
        },
        activation: {
            shortCohort: summarizeCohort(dayKey(ranges.short), shortMembers, [
                'taskAndAssistantReply',
                'connectedIntegration',
            ]),
            longCohort: summarizeCohort(dayKey(ranges.long), longMembers, ['goldOnThreeDays']),
        },
    }
}

async function countActiveUsers(db, now, counter) {
    const result = {}
    for (const [name, days] of [
        ['day', 1],
        ['week', 7],
        ['month', 30],
    ]) {
        const snapshot = await db
            .collection('users')
            .where('lastLogin', '>=', now - days * DAY_MS)
            .count()
            .get()
        const count = Number((snapshot.data() || {}).count) || 0
        counter.firestoreDocs += Math.max(1, Math.ceil(count / 1000))
        result[name] = count
    }
    return result
}

async function readPremiumUsers(db, counter) {
    const snapshot = await db.collection('users').where('premium.status', '==', 'premium').select('premium').get()
    counter.firestoreDocs += snapshot.size || 1
    return snapshot.docs.map(doc => {
        const premium = (doc.data() || {}).premium || {}
        return {
            uid: doc.id,
            plan: premium.source === 'apple_iap' ? 'apple' : 'stripe',
            planInterval: premium.planInterval || null,
        }
    })
}

function summarizePremium(premiumUsers, previousIds) {
    const current = new Set(premiumUsers.map(user => user.uid))
    const previous = Array.isArray(previousIds) ? new Set(previousIds) : null
    const byPlan = {}
    const byInterval = {}
    premiumUsers.forEach(user => {
        byPlan[user.plan] = (byPlan[user.plan] || 0) + 1
        const interval = user.planInterval || 'unknown'
        byInterval[interval] = (byInterval[interval] || 0) + 1
    })
    return {
        payingUsers: current.size,
        byPlan,
        byInterval,
        started: previous ? [...current].filter(uid => !previous.has(uid)).length : null,
        stopped: previous ? [...previous].filter(uid => !current.has(uid)).length : null,
    }
}

async function computeGold(db, reportDay, counter) {
    const snapshot = await db.doc(`goldStats/daily/days/${reportDay}`).get()
    counter.firestoreDocs += 1
    const rollup = snapshot.exists ? snapshot.data() || {} : {}
    const costUsdBySource = estimateRollupCostUsdBySource(rollup)
    const costEurBySource = Object.fromEntries(
        Object.entries(costUsdBySource).map(([source, usd]) => [source, round2(usdToEur(usd))])
    )
    const totalCostUsd = Object.values(costUsdBySource).reduce((sum, usd) => sum + usd, 0)
    return {
        available: snapshot.exists,
        spent: Number(rollup.spend) || 0,
        earned: Number(rollup.earn) || 0,
        refunded: Number(rollup.refund) || 0,
        spendBySource: capBreakdown(rollup.spendBySource || {}),
        earnBySource: capBreakdown(rollup.earnBySource || {}),
        estimatedCostEur: round2(usdToEur(totalCostUsd)),
        estimatedCostEurBySource: capBreakdown(costEurBySource),
    }
}

// Payments up to a year back: a yearly plan's payment is spread over the year it pays for.
const REVENUE_LOOKBACK_DAYS = 365

async function computeMargin({ db, stripe, now, premiumUsers, createdAtByUid, excludedIds, counter }) {
    const from = now - MARGIN_WINDOW_DAYS * DAY_MS
    const revenueFrom = now - REVENUE_LOOKBACK_DAYS * DAY_MS
    const [stripeResult, appleResult] = await Promise.all([
        readStripeRevenueRows({ stripe, from: revenueFrom, to: now }),
        readAppleRevenueRows({ db, from: revenueFrom, to: now }),
    ])
    counter.stripeApiCalls += stripeResult.apiPages
    counter.firestoreDocs += appleResult.docsRead
    const resolution = await resolveStripeRowUsers(stripeResult.rows, { db, stripe })
    counter.firestoreDocs += resolution.docsRead
    counter.stripeApiCalls += resolution.apiCalls

    const rows = [...stripeResult.rows, ...appleResult.rows]
    const intervalByUser = new Map(premiumUsers.map(user => [user.uid, user.planInterval]))
    const revenueByUser = new Map()
    let unresolvedRevenueEur = 0
    rows.forEach(row => {
        if (row.netEur === null || row.kind === 'fee' || row.kind === 'other') return
        const periodDays = row.periodDays || (intervalByUser.get(row.userId) === 'year' ? 365 : 30)
        const recognized = recognizedInWindow(row, { from, to: now, periodDays })
        if (!recognized) return
        if (!row.userId) {
            unresolvedRevenueEur += recognized
            return
        }
        revenueByUser.set(row.userId, (revenueByUser.get(row.userId) || 0) + recognized)
    })

    const planByUser = new Map(premiumUsers.map(user => [user.uid, user.plan]))
    const payerIds = [...new Set([...planByUser.keys(), ...revenueByUser.keys()])].filter(uid => !excludedIds.has(uid))

    const attributionSnapshots = await getAllInChunks(
        db,
        payerIds.map(uid => db.doc(`users/${uid}/private/signupAttribution`)),
        counter
    )
    const costBySourceUsd = {}
    const payers = []
    for (const [index, uid] of payerIds.entries()) {
        const transactions = await readGoldTransactions(db, uid, from, now, counter)
        let costUsd = 0
        transactions.forEach(transaction => {
            const cost = estimateTransactionCostUsd(transaction)
            if (!cost) return
            costUsd += cost
            const source = String(transaction.source || 'unknown').replace(/_refund$/, '')
            costBySourceUsd[source] = (costBySourceUsd[source] || 0) + cost
        })
        const attribution =
            attributionSnapshots[index] && attributionSnapshots[index].exists
                ? attributionSnapshots[index].data() || {}
                : null
        const createdAt = createdAtByUid.get(uid)
        payers.push({
            revenueEur: revenueByUser.get(uid) || 0,
            costEur: usdToEur(costUsd),
            plan: planByUser.get(uid) || 'none',
            tenureDays: Number.isFinite(createdAt) ? Math.floor((now - createdAt) / DAY_MS) : NaN,
            source: resolveSignupSource(attribution),
        })
    }

    return {
        computedAt: now,
        ...summarizeMargins(payers, { windowDays: MARGIN_WINDOW_DAYS }),
        unresolvedRevenueEur: round2(unresolvedRevenueEur),
        costEurBySource: capBreakdown(
            Object.fromEntries(Object.entries(costBySourceUsd).map(([source, usd]) => [source, round2(usdToEur(usd))]))
        ),
        stripeAvailable: !stripeResult.unavailable,
        stripeTruncated: stripeResult.truncated,
    }
}

// The outbound pipeline the growth loop works in: contacts of the Growth project per status.
async function readOutreachPipeline(db, projectId, counter) {
    if (!projectId) return null
    const [projectSnapshot, contactsSnapshot] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.collection(`projectsContacts/${projectId}/contacts`).select('contactStatusId').get(),
    ])
    counter.firestoreDocs += 1 + (contactsSnapshot.size || 1)
    const statuses = ((projectSnapshot.exists && projectSnapshot.data()) || {}).contactStatuses || {}
    const ordered = Object.entries(statuses).sort(
        (a, b) => (Number((a[1] || {}).sortIndex) || 0) - (Number((b[1] || {}).sortIndex) || 0)
    )
    const counts = Object.fromEntries(ordered.map(([id]) => [id, 0]))
    let withoutStatus = 0
    contactsSnapshot.docs.forEach(doc => {
        const statusId = (doc.data() || {}).contactStatusId
        if (statusId && Object.prototype.hasOwnProperty.call(counts, statusId)) counts[statusId] += 1
        else withoutStatus += 1
    })
    return {
        contacts: contactsSnapshot.size,
        byStatus: ordered.map(([id, status]) => ({
            name: String((status || {}).name || id).slice(0, 60),
            count: counts[id],
        })),
        withoutStatus,
    }
}

// options.day: the UTC day to report (default: yesterday). options.forceMargin: compute the margin
// even when it is not the weekly margin day. deps.environment ('production' | 'staging') decides
// whether the Growth project's outreach pipeline is read; deps.analytics replaces the GA client.
async function runGrowthScoreboard(options = {}, deps = {}) {
    const db = deps.db || admin.firestore()
    const auth = deps.auth || admin.auth()
    const stripe = deps.stripe === undefined ? null : deps.stripe
    const now = typeof deps.now === 'function' ? deps.now() : Date.now()
    const startedAt = Date.now()
    const counter = { firestoreDocs: 0, authPages: 0, stripeApiCalls: 0 }

    const reportDay = options.day || dayKey(now - DAY_MS)
    const reportDayStart = dayStartOf(reportDay)
    if (!Number.isFinite(reportDayStart)) throw new Error(`Invalid report day: ${reportDay}`)
    const reportDayEnd = reportDayStart + DAY_MS

    const stateRef = db.doc(STATE_DOC)
    const stateSnapshot = await stateRef.get()
    counter.firestoreDocs += 1
    const state = stateSnapshot.exists ? stateSnapshot.data() || {} : {}

    const [createdAtByUid, administratorId] = await Promise.all([
        listAccountCreationTimes(auth, counter),
        readAdministratorId(db, counter),
    ])
    const excludedIds = new Set([...EXCLUDED_USER_IDS, administratorId].filter(Boolean))

    const { signups, activation } = await computeSignups({ db, createdAtByUid, reportDayStart, counter })
    const activeUsers = await countActiveUsers(db, now, counter)

    const premiumUsers = await readPremiumUsers(db, counter)
    // A rerun of the same day compares with the snapshot before that day, not with itself.
    const previousPremiumIds =
        state.premiumSnapshotDay === reportDay ? state.previousPremiumUserIds : state.premiumUserIds
    const premium = summarizePremium(premiumUsers, previousPremiumIds)

    const [stripeDay, appleDay] = await Promise.all([
        readStripeRevenueRows({ stripe, from: reportDayStart, to: reportDayEnd }),
        readAppleRevenueRows({ db, from: reportDayStart, to: reportDayEnd }),
    ])
    counter.stripeApiCalls += stripeDay.apiPages
    counter.firestoreDocs += appleDay.docsRead
    const revenue = {
        ...summarizeRevenue([...stripeDay.rows, ...appleDay.rows]),
        stripeAvailable: !stripeDay.unavailable,
    }

    const gold = await computeGold(db, reportDay, counter)
    const traffic = await readTraffic({ day: reportDay, signups: signups.count, client: deps.analytics })
    const target = SCOREBOARD_ARTIFACT_TARGETS[deps.environment || '']
    const outreach = await readOutreachPipeline(db, target ? target.projectId : null, counter)

    const isMarginDay = moment.utc(now).isoWeekday() === MARGIN_WEEKDAY_UTC
    const margin =
        options.forceMargin || isMarginDay
            ? await computeMargin({ db, stripe, now, premiumUsers, createdAtByUid, excludedIds, counter })
            : null

    const metrics = {
        day: reportDay,
        generatedAt: now,
        outreach,
        traffic,
        signups,
        activation,
        activeUsers,
        premium,
        revenue,
        gold,
        margin,
        run: {
            ...counter,
            durationMs: Date.now() - startedAt,
            maxBreakdownKeys: MAX_BREAKDOWN_KEYS,
        },
    }

    await db.doc(`${METRICS_DAYS_COLLECTION}/${reportDay}`).set(metrics)
    const nextState = {
        lastRunDay: reportDay,
        lastRunAt: now,
        premiumSnapshotDay: reportDay,
        previousPremiumUserIds: Array.isArray(previousPremiumIds) ? previousPremiumIds : null,
        premiumUserIds: premiumUsers.map(user => user.uid),
    }
    if (margin) {
        nextState.latestMargin = margin
        nextState.latestMarginDay = reportDay
    }
    await stateRef.set(nextState, { merge: true })

    return { metrics, state: { ...state, ...nextState } }
}

async function readScoreboardHistory(db, endDay, days) {
    const end = dayStartOf(endDay)
    const refs = []
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        refs.push(db.doc(`${METRICS_DAYS_COLLECTION}/${dayKey(end - offset * DAY_MS)}`))
    }
    const snapshots = await db.getAll(...refs)
    return snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() || {})
}

module.exports = {
    METRICS_DAYS_COLLECTION,
    STATE_DOC,
    runGrowthScoreboard,
    readScoreboardHistory,
    summarizePremium,
    listAccountCreationTimes,
}
