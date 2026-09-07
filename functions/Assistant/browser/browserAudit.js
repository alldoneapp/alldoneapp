'use strict'

// The audit trail, and the run state the trail is derived from.
//
// One document per RUN (`browserRuns/{runId}`) and one per TOOL CALL under it
// (`browserRuns/{runId}/steps/{stepId}`). Both are server-written only: there is no security rule
// for `browserRuns`, and Firestore's default is deny, so a client can neither read nor forge one.
//
// The run document is also the run's live state, and that is deliberate rather than convenient. The
// budget has to be charged in the same transaction that hands out the step, or two tool calls
// racing inside one thread each see "9 of 10 navigations used" and both proceed; and it has to
// survive a Functions instance recycling, or every limit silently means "per instance". So the
// counters live next to the record of what spent them.
//
// What a step records: the tool, the action, the REDACTED arguments, the policy decision and the
// evidence it was made on, the approval that unblocked it (if any), what the worker did, what it
// cost, and pointers to the screenshot and DOM/accessibility snapshot captured for it. Enough to
// answer "what did the assistant do on that site, why was it allowed, and what did the page look
// like at that moment" without holding the page's personal data a second time.

const crypto = require('crypto')

const { chargeBrowserBudget, createRunBudget, normalizeBudget, resolveBrowserLimits } = require('./browserLimits')
const { redactObjectForAudit, redactUrl } = require('./browserRedaction')
const { serializeAllowlistEntry } = require('./browserConfig')

const RUNS_COLLECTION = 'browserRuns'
const SESSIONS_COLLECTION = 'browserSessions'
const STEPS_COLLECTION = 'steps'

const RUN_STATUS = {
    ACTIVE: 'active',
    FINISHED: 'finished',
    EXPIRED: 'expired',
    ABORTED: 'aborted',
}

function newId(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}

/** A run is scoped to ONE thread, exactly like a VM session (`vmSessions/{projectId}__{objectId}`). */
function buildSessionKey(projectId, objectId) {
    return `${projectId || 'no-project'}__${objectId || 'no-object'}`
}

function runRef(db, runId) {
    return db.doc(`${RUNS_COLLECTION}/${runId}`)
}

function sessionRef(db, sessionKey) {
    return db.doc(`${SESSIONS_COLLECTION}/${sessionKey}`)
}

function stepRef(db, runId, stepId) {
    return db.doc(`${RUNS_COLLECTION}/${runId}/${STEPS_COLLECTION}/${stepId}`)
}

function summarizeAllowlist(allowlist) {
    return (Array.isArray(allowlist) ? allowlist : []).map(entry => serializeAllowlistEntry(entry)).filter(Boolean)
}

function isRunUsable(run, limits, now) {
    if (!run || run.status !== RUN_STATUS.ACTIVE) return false
    const effectiveLimits = resolveBrowserLimits(limits)
    const startedAt = Number(run.startedAt) || 0
    const lastActivityAt = Number(run.lastActivityAt) || startedAt
    if (now - startedAt > effectiveLimits.maxRunWallClockMs) return false
    // An idle session is torn down by the worker anyway; reusing its id would resume a context that
    // no longer exists and report the failure as a page problem.
    if (now - lastActivityAt > effectiveLimits.maxSessionIdleMs) return false
    return true
}

/**
 * Open a step.
 *
 * Everything that has to be decided atomically happens here: which run this thread is on, whether
 * that run is still alive, whether the budget covers the step, and the step's id. A caller that
 * gets `{ ok: false }` back has consumed nothing.
 *
 * `startsRun` is what a navigation passes: only a navigation may open a fresh run, because every
 * other action needs a page that is already open.
 */
async function beginBrowserStep(
    db,
    {
        projectId,
        objectId,
        objectType = 'tasks',
        assistantId = null,
        requestUserId = null,
        sourceChannel = null,
        toolName,
        action,
        args = {},
        config,
        startsRun = false,
        charges = {},
        now = Date.now(),
    }
) {
    const sessionKey = buildSessionKey(projectId, objectId)
    const limits = resolveBrowserLimits(config?.limits)

    return db.runTransaction(async transaction => {
        const sessionDocRef = sessionRef(db, sessionKey)
        const sessionSnapshot = await transaction.get(sessionDocRef)
        const session = sessionSnapshot.exists ? sessionSnapshot.data() : null

        let run = null
        let runId = session?.runId || null
        if (runId) {
            const existing = await transaction.get(runRef(db, runId))
            run = existing.exists ? existing.data() : null
            if (!isRunUsable(run, limits, now)) {
                run = null
                runId = null
            }
        }

        if (!run) {
            if (!startsRun) {
                return {
                    ok: false,
                    reason: 'no_session',
                    message:
                        'There is no open browsing session in this thread (or it has expired). Start with browser_navigate.',
                }
            }
            runId = newId('brun')
            run = {
                runId,
                sessionKey,
                projectId: projectId || null,
                objectId: objectId || null,
                objectType,
                assistantId: assistantId || null,
                requestUserId: requestUserId || null,
                sourceChannel: sourceChannel || null,
                status: RUN_STATUS.ACTIVE,
                startedAt: now,
                lastActivityAt: now,
                stepCount: 0,
                budget: createRunBudget(now),
                limits,
                allowlist: summarizeAllowlist(config?.allowlist),
                workerSessionId: newId('bsess'),
            }
        }

        const charge = chargeBrowserBudget(run.budget, limits, { steps: 1, ...charges }, now)
        if (!charge.ok) {
            // The refusal is recorded on the run so a run that ended at a limit says so, rather than
            // simply stopping with the last successful step as its final word.
            transaction.set(
                runDocRefForWrite(db, runId),
                { lastActivityAt: now, lastViolation: charge.violation },
                { merge: true }
            )
            return {
                ok: false,
                runId,
                reason: 'limit_exceeded',
                violation: charge.violation,
                message: charge.violation.message,
            }
        }

        const stepId = newId('bstep')
        const stepNumber = (Number(run.stepCount) || 0) + 1
        const stepRecord = {
            stepId,
            runId,
            stepNumber,
            toolName,
            action,
            projectId: projectId || null,
            objectId: objectId || null,
            assistantId: assistantId || null,
            requestUserId: requestUserId || null,
            sourceChannel: sourceChannel || null,
            startedAt: now,
            status: 'started',
            args: redactObjectForAudit(args),
        }

        const nextRun = {
            ...run,
            runId,
            budget: charge.budget,
            stepCount: stepNumber,
            lastActivityAt: now,
        }

        transaction.set(runDocRefForWrite(db, runId), nextRun, { merge: true })
        transaction.set(stepRef(db, runId, stepId), stepRecord)
        transaction.set(
            sessionDocRef,
            { sessionKey, runId, projectId: projectId || null, objectId: objectId || null, updatedAt: now },
            { merge: true }
        )

        return { ok: true, runId, stepId, stepNumber, run: nextRun, budget: charge.budget, limits }
    })
}

// Split out so the transaction body reads the same for the create and the reuse branch.
function runDocRefForWrite(db, runId) {
    return runRef(db, runId)
}

/**
 * Close a step with what actually happened. Never throws: the browsing already occurred, and losing
 * the tail of a record must not turn a successful page read into a tool error. A failure is logged
 * (loudly — an audit trail that quietly stops recording is worse than no audit trail).
 */
async function completeBrowserStep(db, { runId, stepId, outcome = {}, usage = null, now = Date.now() }) {
    if (!db || !runId || !stepId) return false
    try {
        const patch = {
            status: outcome.status || 'completed',
            finishedAt: now,
            durationMs: Number(outcome.durationMs) || null,
            decision: outcome.decision || null,
            decisionReason: outcome.reason || null,
            category: outcome.category || null,
            categories: Array.isArray(outcome.categories) ? outcome.categories : [],
            policyEvidence: Array.isArray(outcome.evidence) ? outcome.evidence : [],
            approvalId: outcome.approvalId || null,
            approvalScope: outcome.approvalScope || null,
            pageUrl: outcome.pageUrl ? redactUrl(outcome.pageUrl, { mode: 'audit' }) : null,
            finalUrl: outcome.finalUrl ? redactUrl(outcome.finalUrl, { mode: 'audit' }) : null,
            httpStatus: Number.isFinite(outcome.httpStatus) ? outcome.httpStatus : null,
            redirectChain: Array.isArray(outcome.redirectChain)
                ? outcome.redirectChain.slice(0, 12).map(url => redactUrl(url, { mode: 'audit' }))
                : [],
            target: outcome.target ? redactObjectForAudit(outcome.target) : null,
            typedValue: outcome.typedValue || null,
            evidence: outcome.evidence_refs || null,
            error: outcome.error ? redactObjectForAudit(String(outcome.error)) : null,
            usage: usage || null,
        }
        await stepRef(db, runId, stepId).set(patch, { merge: true })

        const runPatch = { lastActivityAt: now }
        if (usage && typeof usage === 'object') runPatch.lastUsage = usage
        await runRef(db, runId).set(runPatch, { merge: true })
        return true
    } catch (error) {
        console.error('🌐 BROWSER AUDIT: could not record the step outcome', {
            runId,
            stepId,
            error: error.message,
        })
        return false
    }
}

/** Fold the worker's reported per-step usage into the run budget. Best effort, same reasoning. */
async function applyRunUsage(db, { runId, usage, now = Date.now() }) {
    if (!db || !runId || !usage) return false
    try {
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(runRef(db, runId))
            if (!snapshot.exists) return
            const run = snapshot.data()
            const budget = normalizeBudget(run.budget, now)
            const requests = Number(usage.networkRequests)
            const bytes = Number(usage.responseBytes)
            if (Number.isFinite(requests) && requests > 0) budget.networkRequests += requests
            if (Number.isFinite(bytes) && bytes > 0) budget.responseBytes += bytes
            transaction.set(runRef(db, runId), { budget, lastActivityAt: now }, { merge: true })
        })
        return true
    } catch (error) {
        console.warn('🌐 BROWSER AUDIT: could not apply worker usage to the run budget', {
            runId,
            error: error.message,
        })
        return false
    }
}

async function finishBrowserRun(db, { runId, status = RUN_STATUS.FINISHED, reason = null, now = Date.now() }) {
    if (!db || !runId) return false
    try {
        await runRef(db, runId).set({ status, finishedAt: now, finishReason: reason }, { merge: true })
        return true
    } catch (error) {
        console.warn('🌐 BROWSER AUDIT: could not close the run', { runId, error: error.message })
        return false
    }
}

module.exports = {
    RUNS_COLLECTION,
    RUN_STATUS,
    SESSIONS_COLLECTION,
    STEPS_COLLECTION,
    applyRunUsage,
    beginBrowserStep,
    buildSessionKey,
    completeBrowserStep,
    finishBrowserRun,
    isRunUsable,
    runRef,
    sessionRef,
    stepRef,
    summarizeAllowlist,
}
