const { callBrowserWorker } = require('./browserWorkerClient')
const { loadProjectBrowserConfig, resolveBrowserConfig } = require('./browserConfig')
const { sanitizeTakeoverInput } = require('./browserTakeover')
const { claimBrowserGesture, releaseBrowserGesture } = require('../annaWorkspaceControl')
const { beginBrowserStep, completeBrowserStep, applyRunUsage, isRunUsable } = require('./browserAudit')
const { resolveBrowserLimits } = require('./browserLimits')
const { BROWSER_STEP_GOLD, hasGoldForBrowserStep, chargeGoldForBrowserStep } = require('./browserGold')
const { redactUrl } = require('./browserRedaction')

const fail = (code, message, reason) => {
    throw Object.assign(new Error(message), { code, ...(reason ? { details: { reason } } : {}) })
}

// Human-only viewport. Frames and typed text are returned over the authenticated request,
// never saved as chat messages or passed to a model. Merely watching is not a paid browser step.
async function browserWorkspace({ db, env, userId, runId, action = 'frame', input = {}, deps = {}, now = Date.now() }) {
    if (typeof runId !== 'string' || !/^brun_[a-zA-Z0-9]+$/.test(runId))
        fail('invalid-argument', 'Invalid browser session.')
    const ref = db.doc(`browserRuns/${runId}`)
    const snapshot = await ref.get()
    let run = snapshot.data()
    if (!snapshot.exists || run.requestUserId !== userId)
        fail('permission-denied', 'This browser belongs to another user.')
    const project = await db.doc(`projects/${run.projectId}`).get()
    if (!project.data()?.userIds?.includes(userId)) fail('permission-denied', 'This project is no longer accessible.')
    const config = resolveBrowserConfig({ env, projectConfig: await loadProjectBrowserConfig(db, run.projectId) })
    if (!config.enabled) fail('failed-precondition', 'The browser is not configured.')
    if (!isRunUsable(run, resolveBrowserLimits(config.limits), now))
        fail(
            'failed-precondition',
            'This browser session has ended. Its results remain in Alldone.',
            'browser_session_ended'
        )

    if (action === 'take' || action === 'release') {
        run = await db.runTransaction(async tx => {
            const current = (await tx.get(ref)).data()
            if (action === 'release' && current.workspaceGesture?.until > now)
                fail('failed-precondition', 'Wait for the current browser action to finish.')
            const patch = { workspaceControl: action === 'take' ? 'user' : 'assistant' }
            if (action === 'release') patch.workspacePaused = false
            tx.set(ref, patch, { merge: true })
            return { ...current, ...patch, resume: action === 'release' && current.workspacePaused }
        })
        return {
            control: run.workspaceControl,
            ready: !(run.workspaceGesture?.until > now),
            resume: run.resume
                ? {
                      projectId: run.projectId,
                      objectId: run.objectId,
                      objectType: run.objectType,
                      assistantId: run.assistantId,
                      at: now,
                  }
                : null,
        }
    }

    const watching = action === 'frame'
    const normalized = sanitizeTakeoverInput(watching ? 'snapshot' : action, input)
    let gesture, step
    if (!watching) {
        gesture = await claimBrowserGesture(db, runId, userId, true, now)
        if (!gesture.ok) fail('failed-precondition', 'Take control and wait for the current action to finish first.')
    }
    try {
        if (!watching) {
            if (!(await hasGoldForBrowserStep(db, userId, BROWSER_STEP_GOLD)).ok)
                fail('failed-precondition', 'There is not enough Gold for another browser action.')
            step = await beginBrowserStep(db, {
                projectId: run.projectId,
                objectId: run.objectId,
                objectType: run.objectType,
                assistantId: run.assistantId,
                requestUserId: userId,
                sourceChannel: 'browser_takeover',
                toolName: 'browser_takeover',
                action: `takeover_${action}`,
                args: normalized.auditArgs,
                config,
                expectedRunId: runId,
                now,
            })
            if (!step.ok) fail('failed-precondition', step.message)
        }
        const result = await (deps.callBrowserWorker || callBrowserWorker)({
            operation: 'takeover',
            payload: normalized.payload,
            config,
            runId,
            sessionId: run.workerSessionId,
            projectId: run.projectId,
            userId,
            affinityCookie: run.affinityCookie || '',
            now,
        })
        if (!result.ok) fail('failed-precondition', result.error || 'The browser is unavailable.')
        if (result.affinityCookie) await ref.set({ affinityCookie: result.affinityCookie }, { merge: true })
        if (result.usage) await applyRunUsage(db, { runId, usage: result.usage, now })
        if (step) {
            await chargeGoldForBrowserStep({
                db,
                userId,
                runId,
                stepId: step.stepId,
                projectId: run.projectId,
                objectId: run.objectId,
                objectType: run.objectType,
                toolName: `browser_takeover_${action}`,
                deductGoldImpl: deps.deductGold,
            })
            await completeBrowserStep(db, {
                runId,
                stepId: step.stepId,
                outcome: { status: 'completed', decision: 'human', reason: 'user_takeover' },
                now,
            })
            await ref.set({ lastPageUrl: result.url || run.lastPageUrl, lastActivityAt: now }, { merge: true })
        }
        // Re-read control because a different device may have taken or released it during capture.
        const current = (await ref.get()).data()
        return {
            screenshotDataUrl: `data:image/jpeg;base64,${result.screenshotBase64 || ''}`,
            title: result.title || '',
            url: redactUrl(result.url || ''),
            viewport: result.viewport,
            focused: result.focused || null,
            control: current.workspaceControl || 'assistant',
            ready: !watching || !(current.workspaceGesture?.until > Date.now()),
            capturedAt: Date.now(),
        }
    } catch (error) {
        if (step?.ok)
            await completeBrowserStep(db, {
                runId,
                stepId: step.stepId,
                outcome: { status: 'failed', decision: 'human', reason: 'workspace_action_failed' },
                now,
            })
        throw error
    } finally {
        if (gesture?.ok) await releaseBrowserGesture(db, runId, gesture.token).catch(() => {})
    }
}

module.exports = { browserWorkspace }
