'use strict'

// AT-2913. The Gmail label summary behind the email line costs about 125 Gmail calls for a
// mailbox with many labels (up to 60 labels, each needing a thread list and an unread count,
// plus the has:userlabels scan), about 1,300 quota units against a per-user limit of 250 per
// second. It therefore took about 7 seconds (p50, p90 11s), and half of all requests arrived
// within 5 seconds of the previous one from the same device, because the app asks for the same
// mailbox under a project key and under a connection key.
//
// The mailbox historyId (users.getProfile, 1 quota unit) changes with every change to the
// mailbox: new mail, read state, labels, archiving. A summary computed at a historyId is
// therefore still exact while the historyId is unchanged, so it is reused for that mailbox and
// user whichever key asked. Concurrent requests at the same historyId share one computation.
// SUMMARY_MAX_AGE_MS bounds the only staleness left: a label renamed or created without any
// mailbox change does not move the historyId.
//
// In-memory per instance, like gmailResolvedThreadCache: a miss only costs the old latency.

const SUMMARY_MAX_AGE_MS = 10 * 60 * 1000
const MAX_CACHED_SUMMARIES = 500

const summaries = new Map()
const inFlight = new Map()

function buildLabelSummaryCacheKey(userId, mailboxKey) {
    return `${userId}:${String(mailboxKey || '').toLowerCase()}`
}

function copySummary(summary) {
    return { ...summary, labels: (summary.labels || []).map(label => ({ ...label })) }
}

function getCachedLabelSummary(key, historyId, now = Date.now()) {
    const cached = summaries.get(key)
    if (!cached) return null
    if (cached.historyId !== historyId || now - cached.cachedAt >= SUMMARY_MAX_AGE_MS) {
        summaries.delete(key)
        return null
    }
    return copySummary(cached.summary)
}

function storeLabelSummary(key, historyId, summary, now = Date.now()) {
    summaries.delete(key)
    summaries.set(key, { historyId, summary, cachedAt: now })
    // Map iteration is insertion order, so the first key is the oldest entry.
    while (summaries.size > MAX_CACHED_SUMMARIES) summaries.delete(summaries.keys().next().value)
}

// Runs `compute` once per key and historyId; callers arriving while it runs get its result.
function runLabelSummaryOnce(key, historyId, compute) {
    const inFlightKey = `${key}#${historyId}`
    const running = inFlight.get(inFlightKey)
    if (running) return running.then(copySummary)
    const promise = Promise.resolve()
        .then(compute)
        .then(summary => {
            storeLabelSummary(key, historyId, summary)
            return summary
        })
        .finally(() => inFlight.delete(inFlightKey))
    inFlight.set(inFlightKey, promise)
    return promise.then(copySummary)
}

function isLabelSummaryInFlight(key, historyId) {
    return inFlight.has(`${key}#${historyId}`)
}

function resetLabelSummaryCacheForTests() {
    summaries.clear()
    inFlight.clear()
}

module.exports = {
    SUMMARY_MAX_AGE_MS,
    MAX_CACHED_SUMMARIES,
    buildLabelSummaryCacheKey,
    getCachedLabelSummary,
    isLabelSummaryInFlight,
    resetLabelSummaryCacheForTests,
    runLabelSummaryOnce,
    storeLabelSummary,
}
