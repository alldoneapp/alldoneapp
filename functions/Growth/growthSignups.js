'use strict'

// Signups, their origin and the three activation candidates (growth scoreboard). Pure functions;
// the reads happen in growthScoreboard.js.
//
// The origin is users/{uid}/private/signupAttribution, written once by the browser at signup
// (utils/growth/signupAttribution.js). Its owner can write it, so everything read from it is
// sanitised again here before it becomes a map key in a server document.

const {
    ACTIVATION_GOLD_DAYS,
    ACTIVATION_LONG_WINDOW_DAYS,
    ACTIVATION_SHORT_WINDOW_DAYS,
    MAX_BREAKDOWN_KEYS,
    SIGNUP_SETUP_GRACE_MS,
    ZERO_COST_GOLD_SOURCES,
} = require('./growthConfig')

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_KEY_LENGTH = 40

function sanitizeKey(value) {
    if (typeof value !== 'string') return ''
    return value
        .trim()
        .toLowerCase()
        .replace(/[\s+.]+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, MAX_KEY_LENGTH)
}

// One label per signup: the first of campaign source, referral code, ad network, referring site,
// else how the visit started. "unknown" means no attribution was recorded at all (an account from
// before attribution existed, or a signup whose write failed).
function resolveSignupSource(attribution) {
    if (!attribution || typeof attribution !== 'object') return 'unknown'
    const explicit =
        sanitizeKey(attribution.utmSource) ||
        sanitizeKey(attribution.ref) ||
        sanitizeKey(attribution.clickSource) ||
        sanitizeKey(attribution.referrerHost)
    if (explicit) return explicit
    const path = typeof attribution.landingPath === 'string' ? attribution.landingPath : ''
    if (/^\/projects\/[^/]+/.test(path)) return 'project-link'
    return 'direct'
}

function resolveSignupCampaign(attribution) {
    if (!attribution || typeof attribution !== 'object') return ''
    return sanitizeKey(attribution.utmCampaign)
}

// Keeps a breakdown bounded: the biggest MAX_BREAKDOWN_KEYS keys, the rest summed under "other".
function capBreakdown(counts, valueOf = value => value) {
    const entries = Object.entries(counts).sort((a, b) => valueOf(b[1]) - valueOf(a[1]) || a[0].localeCompare(b[0]))
    if (entries.length <= MAX_BREAKDOWN_KEYS) return Object.fromEntries(entries)
    const kept = entries.slice(0, MAX_BREAKDOWN_KEYS - 1)
    const rest = entries.slice(MAX_BREAKDOWN_KEYS - 1)
    const restValue = rest.reduce(
        (sum, [, value]) => {
            if (typeof value === 'number') return sum + value
            Object.entries(value).forEach(([field, number]) => {
                sum[field] = (sum[field] || 0) + (Number(number) || 0)
            })
            return sum
        },
        typeof rest[0][1] === 'number' ? 0 : {}
    )
    return Object.fromEntries([...kept, ['other', restValue]])
}

const toMillis = value => {
    if (typeof value === 'number') return value
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    return NaN
}

// What a user has connected now. For the 7-day cohort this is read on day 7, so it stands for
// "connected within 7 days" (a connection made and removed again inside the week is missed).
function getConnectedIntegrations(userData = {}) {
    const connected = { whatsapp: false, gmail: false, calendar: false }
    if (typeof userData.phone === 'string' && userData.phone.trim()) connected.whatsapp = true
    const apis = userData.apisConnected && typeof userData.apisConnected === 'object' ? userData.apisConnected : {}
    Object.values(apis).forEach(project => {
        if (!project || typeof project !== 'object') return
        if (project.gmail === true || project.email === true) connected.gmail = true
        if (project.calendar === true) connected.calendar = true
    })
    const accounts =
        userData.emailConnections && typeof userData.emailConnections === 'object' ? userData.emailConnections : {}
    if (Object.keys(accounts).length > 0) connected.gmail = true
    return { ...connected, any: connected.whatsapp || connected.gmail || connected.calendar }
}

// The three candidates for one signup.
//   taskCreatedAt: creation times of tasks the user created
//   goldTransactions: { direction, source, createdAt } of the user's ledger after signup
function evaluateActivation({ signupAt, taskCreatedAt = [], goldTransactions = [], userData = {} }) {
    const shortEnd = signupAt + ACTIVATION_SHORT_WINDOW_DAYS * DAY_MS
    const longEnd = signupAt + ACTIVATION_LONG_WINDOW_DAYS * DAY_MS
    const inRange = (time, start, end) => Number.isFinite(time) && time >= start && time < end

    const createdTask = taskCreatedAt.some(time => inRange(toMillis(time), signupAt + SIGNUP_SETUP_GRACE_MS, shortEnd))
    const spends = goldTransactions
        .filter(transaction => transaction && transaction.direction === 'spend')
        .map(transaction => ({ source: transaction.source, time: toMillis(transaction.createdAt) }))
    const gotAssistantReply = spends.some(
        spend => spend.source === 'assistant_usage' && inRange(spend.time, signupAt, shortEnd)
    )
    const workDays = new Set(
        spends
            .filter(spend => !ZERO_COST_GOLD_SOURCES.includes(spend.source) && inRange(spend.time, signupAt, longEnd))
            .map(spend => new Date(spend.time).toISOString().slice(0, 10))
    )

    return {
        taskAndAssistantReply: createdTask && gotAssistantReply,
        connectedIntegration: getConnectedIntegrations(userData).any,
        goldOnThreeDays: workDays.size >= ACTIVATION_GOLD_DAYS,
    }
}

// One cohort's result: totals and the same per signup source.
function summarizeCohort(day, members, candidates) {
    const total = { signups: 0 }
    candidates.forEach(candidate => {
        total[candidate] = 0
    })
    const bySource = {}
    members.forEach(member => {
        total.signups += 1
        const bucket = (bySource[member.source] = bySource[member.source] || { signups: 0 })
        bucket.signups += 1
        candidates.forEach(candidate => {
            bucket[candidate] = bucket[candidate] || 0
            if (member.activation[candidate]) {
                total[candidate] += 1
                bucket[candidate] += 1
            }
        })
    })
    return { day, ...total, bySource: capBreakdown(bySource, value => value.signups) }
}

module.exports = {
    DAY_MS,
    sanitizeKey,
    resolveSignupSource,
    resolveSignupCampaign,
    capBreakdown,
    toMillis,
    getConnectedIntegrations,
    evaluateActivation,
    summarizeCohort,
}
