'use strict'

// Session-only human takeover for login pages.
//
// The user drives the existing Playwright context through authenticated callable requests. Every
// request performs at most one gesture and returns a JPEG of the resulting viewport. Credentials
// exist only in the callable and worker request bodies; they are never written to Firestore, audit
// arguments, evidence storage, logs or the assistant conversation. Finishing hands the same
// in-memory context (and its cookies) back to the assistant. Closing/expiry destroys the context;
// there is deliberately no storageState export.

const { loadProjectBrowserConfig, resolveBrowserConfig } = require('./browserConfig')
const { applyRunUsage, beginBrowserStep, completeBrowserStep, runRef, RUN_STATUS } = require('./browserAudit')
const { BROWSER_STEP_GOLD, chargeGoldForBrowserStep, hasGoldForBrowserStep } = require('./browserGold')
const { redactUrl } = require('./browserRedaction')
const { callBrowserWorker } = require('./browserWorkerClient')

const TAKEOVER_ACTIONS = new Set(['snapshot', 'click', 'type', 'key', 'scroll'])
const TAKEOVER_ACTIVE_STATUSES = new Set(['pending', 'in_progress'])
const MAX_TYPED_CHARS = 4096

function takeoverError(message, reason = 'takeover_failed') {
    const error = new Error(message)
    error.reason = reason
    return error
}

function sanitizeTakeoverInput(action, input = {}) {
    switch (action) {
        case 'snapshot':
            return { payload: { action }, auditArgs: {} }
        case 'click': {
            const x = Number(input.x)
            const y = Number(input.y)
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw takeoverError('A valid click position is required.', 'invalid_position')
            }
            return {
                payload: { action, x: Math.round(x), y: Math.round(y) },
                auditArgs: { x: Math.round(x), y: Math.round(y) },
            }
        }
        case 'type': {
            const text = typeof input.text === 'string' ? input.text.slice(0, MAX_TYPED_CHARS) : ''
            if (!text) throw takeoverError('Enter text before sending it to the browser.', 'empty_text')
            // Never put the value itself in the audit arguments.
            return { payload: { action, text }, auditArgs: { textLength: text.length } }
        }
        case 'key': {
            const key = typeof input.key === 'string' ? input.key.slice(0, 32) : ''
            if (!key) throw takeoverError('A keyboard key is required.', 'invalid_key')
            return { payload: { action, key }, auditArgs: { key } }
        }
        case 'scroll': {
            const deltaX = Math.min(Math.max(Number(input.deltaX) || 0, -2000), 2000)
            const deltaY = Math.min(Math.max(Number(input.deltaY) || 0, -2000), 2000)
            if (!deltaX && !deltaY) throw takeoverError('A scroll distance is required.', 'invalid_scroll')
            return { payload: { action, deltaX, deltaY }, auditArgs: { deltaX, deltaY } }
        }
        default:
            throw takeoverError('Unsupported secure-login interaction.', 'unsupported_action')
    }
}

async function readAndValidateApproval(db, { approvalId, userId, now }) {
    if (!approvalId) throw takeoverError('The secure-login request is missing.', 'missing_approval')
    const snapshot = await db.doc(`browserApprovals/${approvalId}`).get()
    if (!snapshot.exists) throw takeoverError('This secure-login request no longer exists.', 'missing_approval')
    const approval = snapshot.data()
    if (approval.requestUserId !== userId) {
        throw takeoverError('Only the person who started this browsing run can use secure login.', 'not_owner')
    }
    if (approval.category !== 'login') {
        throw takeoverError('This request is not a login takeover.', 'not_login')
    }
    if (!TAKEOVER_ACTIVE_STATUSES.has(approval.status)) {
        throw takeoverError('This secure-login request has already ended.', 'not_active')
    }
    if (Number(approval.expiresAt) && Number(approval.expiresAt) <= now) {
        throw takeoverError('This secure-login request has expired.', 'expired')
    }
    return approval
}

async function claimTakeover(db, approval, userId, now) {
    const patch = {
        status: 'in_progress',
        takeoverLastActivityAt: now,
        takeoverUserId: userId,
    }
    if (approval.status === 'pending') patch.takeoverStartedAt = now
    await db.doc(`browserApprovals/${approval.approvalId}`).set(patch, { merge: true })
}

async function executeBrowserTakeover({
    db,
    env,
    approvalId,
    userId,
    action,
    input = {},
    fetchImpl = globalThis.fetch,
    identityTokenProvider,
    deductGold,
    now = Date.now(),
}) {
    if (!TAKEOVER_ACTIONS.has(action))
        throw takeoverError('Unsupported secure-login interaction.', 'unsupported_action')
    const approval = await readAndValidateApproval(db, { approvalId, userId, now })
    const runSnapshot = await runRef(db, approval.runId).get()
    const approvedRun = runSnapshot.exists ? runSnapshot.data() : null
    if (!approvedRun || approvedRun.status !== RUN_STATUS.ACTIVE || approvedRun.requestUserId !== userId) {
        throw takeoverError('The browsing session for this login is no longer active.', 'no_session')
    }

    const projectConfig = await loadProjectBrowserConfig(db, approval.projectId)
    const config = resolveBrowserConfig({ env, projectConfig })
    if (!config.enabled) throw takeoverError('Secure browser login is not configured.', 'not_configured')

    const normalized = sanitizeTakeoverInput(action, input)
    const step = await beginBrowserStep(db, {
        projectId: approval.projectId,
        objectId: approval.objectId,
        objectType: approval.objectType,
        assistantId: approval.assistantId,
        requestUserId: userId,
        sourceChannel: 'browser_takeover',
        toolName: 'browser_takeover',
        action: `takeover_${action}`,
        args: normalized.auditArgs,
        config,
        expectedRunId: approval.runId,
        now,
    })
    if (!step.ok) throw takeoverError(step.message, step.reason)

    const affordable = await hasGoldForBrowserStep(db, userId, BROWSER_STEP_GOLD)
    if (!affordable.ok) {
        await completeBrowserStep(db, {
            runId: step.runId,
            stepId: step.stepId,
            outcome: { status: 'blocked', decision: 'deny', reason: 'insufficient_gold' },
            now,
        })
        throw takeoverError('There is not enough Gold for another browser interaction.', 'insufficient_gold')
    }

    await claimTakeover(db, approval, userId, now)
    const workerResult = await callBrowserWorker({
        operation: 'takeover',
        payload: normalized.payload,
        config,
        runId: step.runId,
        sessionId: step.run.workerSessionId,
        projectId: approval.projectId,
        userId,
        fetchImpl,
        identityTokenProvider,
        affinityCookie: step.run.affinityCookie || '',
        now,
    })

    if (workerResult.affinityCookie) {
        await runRef(db, step.runId).set({ affinityCookie: workerResult.affinityCookie }, { merge: true })
    }
    if (workerResult.usage) await applyRunUsage(db, { runId: step.runId, usage: workerResult.usage, now })

    if (!workerResult.ok) {
        await completeBrowserStep(db, {
            runId: step.runId,
            stepId: step.stepId,
            outcome: { status: 'failed', decision: 'human', reason: workerResult.reason, error: workerResult.error },
            usage: workerResult.usage || null,
            now,
        })
        throw takeoverError(workerResult.error || 'The browser interaction failed.', workerResult.reason)
    }

    const goldCharge = await chargeGoldForBrowserStep({
        db,
        userId,
        runId: step.runId,
        stepId: step.stepId,
        projectId: approval.projectId,
        objectId: approval.objectId,
        objectType: approval.objectType,
        toolName: `browser_takeover_${action}`,
        hostname: null,
        deductGoldImpl: deductGold || null,
    })

    const finalUrl = workerResult.url || approvedRun.lastPageUrl || ''
    await runRef(db, step.runId).set({ lastPageUrl: finalUrl, lastActivityAt: now }, { merge: true })
    await db.doc(`browserApprovals/${approvalId}`).set({ takeoverLastActivityAt: now }, { merge: true })
    await completeBrowserStep(db, {
        runId: step.runId,
        stepId: step.stepId,
        outcome: {
            status: 'completed',
            decision: 'human',
            reason: 'user_takeover',
            pageUrl: approvedRun.lastPageUrl || finalUrl,
            finalUrl,
            typedValue: action === 'type' ? { length: normalized.auditArgs.textLength } : null,
        },
        usage: workerResult.usage || null,
        now,
    })

    return {
        success: true,
        action,
        screenshotDataUrl: `data:image/jpeg;base64,${workerResult.screenshotBase64 || ''}`,
        viewport: workerResult.viewport || { width: 1280, height: 900 },
        focused: workerResult.focused || null,
        title: String(workerResult.title || '').slice(0, 200),
        url: redactUrl(finalUrl, { mode: 'model' }),
        goldCost: goldCharge.charged || goldCharge.alreadyProcessed ? BROWSER_STEP_GOLD : 0,
    }
}

async function finishBrowserTakeover(db, { approvalId, userId, cancelled = false, now = Date.now() }) {
    return db.runTransaction(async transaction => {
        const approvalRef = db.doc(`browserApprovals/${approvalId}`)
        const snapshot = await transaction.get(approvalRef)
        if (!snapshot.exists) throw takeoverError('This secure-login request no longer exists.', 'missing_approval')
        const approval = snapshot.data()
        if (approval.requestUserId !== userId)
            throw takeoverError('This secure login belongs to another user.', 'not_owner')
        if (approval.category !== 'login') throw takeoverError('This request is not a login takeover.', 'not_login')

        const currentRunRef = runRef(db, approval.runId)
        const runSnapshot = await transaction.get(currentRunRef)
        const run = runSnapshot.exists ? runSnapshot.data() : null
        const pending =
            run?.pendingApprovals && typeof run.pendingApprovals === 'object' ? { ...run.pendingApprovals } : {}
        delete pending[approval.signature]

        transaction.set(
            approvalRef,
            {
                status: cancelled ? 'denied' : 'completed_by_user',
                respondedAt: now,
                respondedBy: userId,
                scope: null,
                takeoverCompletedAt: now,
            },
            { merge: true }
        )
        if (run) transaction.set(currentRunRef, { pendingApprovals: pending, lastActivityAt: now }, { merge: true })
        return { success: true, status: cancelled ? 'cancelled' : 'completed' }
    })
}

module.exports = {
    MAX_TYPED_CHARS,
    TAKEOVER_ACTIONS,
    executeBrowserTakeover,
    finishBrowserTakeover,
    sanitizeTakeoverInput,
}
