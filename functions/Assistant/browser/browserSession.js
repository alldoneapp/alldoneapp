'use strict'

// The orchestrator: what happens between the model calling `browser_click` and something happening
// in a browser. Every browser tool call goes through `executeBrowserTool`, in this fixed order:
//
//   configuration → step + budget (one transaction) → OBSERVE → policy → approval → act →
//   evidence → audit → redacted result
//
// The step that makes the whole thing hold together is OBSERVE. For `click` and `type` the worker
// is first asked to *describe* the element — resolve it in the live DOM and report its role,
// accessible name, input type, the enclosing form's method and action, and the labels of that
// form's submit controls — WITHOUT touching it. Only then does the policy run, on what the page
// actually says rather than on anything the model wrote. That ordering is the answer to "a generic
// click bypasses the gates": there is no argument the model can pass that makes a Buy button look
// like a link.
//
// Everything here fails closed. A worker that cannot resolve the element, a policy input that is
// missing, a configuration that is incomplete, an approval that has not been given — all of them
// end the call without the action being performed, and all of them are recorded.

const {
    BROWSER_TOOL_KEY,
    DENY_REASONS,
    getBrowserActionForTool,
    isMutatingBrowserAction,
} = require('./browserToolContract')
const { describeMissingConfiguration, loadProjectBrowserConfig, resolveBrowserConfig } = require('./browserConfig')
const { evaluateBrowserAction } = require('./browserPolicy')
const {
    applyRunUsage,
    beginBrowserStep,
    completeBrowserStep,
    finishBrowserRun,
    runRef,
    RUN_STATUS,
} = require('./browserAudit')
const {
    consumeApprovalGrant,
    findApprovalGrant,
    isSignatureDenied,
    requestBrowserApproval,
} = require('./browserApprovals')
const { getDefaultEvidenceBucket, storeBrowserEvidence } = require('./browserEvidence')
const { BROWSER_STEP_GOLD, chargeGoldForBrowserStep, hasGoldForBrowserStep } = require('./browserGold')
const { describeTypedValue, redactForModel, redactUrl } = require('./browserRedaction')
const { callBrowserWorker } = require('./browserWorkerClient')
const { summarizeBudget } = require('./browserLimits')

const MAX_ELEMENTS_RETURNED = 60

function failure(message, extra = {}) {
    return { success: false, error: message, ...extra }
}

function resolveThreadObjectId(toolRuntimeContext, requestUserId) {
    const objectId = toolRuntimeContext?.objectId
    if (typeof objectId === 'string' && objectId.trim()) return objectId.trim()
    // An MCP or contextless caller has no thread. It still gets a run — auditing an unowned browsing
    // session is exactly as important — keyed to the requesting user instead.
    return `direct__${requestUserId || 'unknown'}`
}

function buildChargesForAction(action) {
    if (action === 'navigate') return { navigations: 1 }
    if (action === 'screenshot') return { screenshots: 1 }
    return {}
}

function sanitizeElementsForModel(elements, maxChars) {
    if (!Array.isArray(elements)) return []
    return elements.slice(0, MAX_ELEMENTS_RETURNED).map(element => ({
        ref: element?.ref || '',
        role: element?.role || '',
        name: redactForModel(String(element?.name || '')).slice(0, 160),
        type: element?.inputType || '',
        disabled: element?.disabled === true,
        // Flagged so the model can see which controls will pause for an approval before it plans a
        // sequence around one. It is a hint, never a permission — the policy re-decides at act time.
        needsApproval: element?.isSubmit === true || element?.inputType === 'password',
    }))
}

function buildPageResult(action, workerResult, evidence, budgetSummary, maxChars) {
    const text = typeof workerResult.text === 'string' ? redactForModel(workerResult.text).slice(0, maxChars) : ''
    return {
        success: true,
        action,
        url: redactUrl(workerResult.url || '', { mode: 'model' }),
        finalUrl: workerResult.finalUrl ? redactUrl(workerResult.finalUrl, { mode: 'model' }) : undefined,
        title: typeof workerResult.title === 'string' ? redactForModel(workerResult.title).slice(0, 300) : '',
        httpStatus: Number.isFinite(workerResult.httpStatus) ? workerResult.httpStatus : undefined,
        redirects: Array.isArray(workerResult.redirectChain)
            ? workerResult.redirectChain.map(url => redactUrl(url, { mode: 'model' }))
            : undefined,
        text: text || undefined,
        textTruncated: workerResult.textTruncated === true || undefined,
        elements: sanitizeElementsForModel(workerResult.elements, maxChars),
        evidence: buildEvidenceForModel(evidence),
        budget: budgetSummary,
    }
}

function buildEvidenceForModel(evidence) {
    if (!evidence) return undefined
    const output = {}
    if (evidence.screenshot) {
        output.screenshotUrl = evidence.screenshot.url
        output.screenshotSha256 = evidence.screenshot.sha256
    }
    if (evidence.snapshot) {
        output.snapshotUrl = evidence.snapshot.url
        output.snapshotSha256 = evidence.snapshot.sha256
    }
    if (Array.isArray(evidence.errors) && evidence.errors.length) output.notStored = evidence.errors
    return Object.keys(output).length ? output : undefined
}

/** Spend one use of a `once` grant, in a transaction, so two concurrent steps cannot share it. */
async function consumeGrant(db, runId, signature, now) {
    return db.runTransaction(async transaction => {
        const reference = runRef(db, runId)
        const snapshot = await transaction.get(reference)
        if (!snapshot.exists) return null
        const run = snapshot.data()
        const { grant, grants } = consumeApprovalGrant(run, signature, now)
        if (!grant) return null
        transaction.set(reference, { approvalGrants: grants, lastActivityAt: now }, { merge: true })
        return grant
    })
}

/**
 * Ask the worker what the target element IS, without touching it. Returns `{ ok, pageUrl, target }`.
 * A worker that cannot resolve the element reports `ok: false` and the action is refused — an
 * unresolvable element must never fall through to an unclassified click.
 */
async function describeTarget({
    config,
    runId,
    sessionId,
    projectId,
    userId,
    args,
    fetchImpl,
    identityTokenProvider,
    affinityCookie,
    now,
}) {
    return callBrowserWorker({
        operation: 'describe',
        payload: { ref: args.ref || '', selector: args.selector || '' },
        config,
        runId,
        sessionId,
        projectId,
        userId,
        fetchImpl,
        identityTokenProvider,
        affinityCookie,
        now,
    })
}

async function executeBrowserTool({
    toolName,
    toolArgs = {},
    projectId,
    assistantId = null,
    requestUserId = null,
    toolRuntimeContext = null,
    deps = {},
} = {}) {
    const action = getBrowserActionForTool(toolName)
    if (!action) return failure(`Unknown browser tool: ${toolName}`, { reason: DENY_REASONS.UNKNOWN_ACTION })

    const now = typeof deps.now === 'function' ? deps.now() : Date.now()
    const db = deps.db || getDefaultDb()
    if (!db) return failure('Browsing is unavailable: no database connection.', { reason: 'no_db' })

    const env = deps.env || getDefaultEnv()
    const projectConfig = await loadProjectBrowserConfig(db, projectId)
    const config = resolveBrowserConfig({ env, projectConfig })
    if (!config.enabled) {
        return failure(describeMissingConfiguration(config), {
            reason: DENY_REASONS.NOT_CONFIGURED,
            toolKey: BROWSER_TOOL_KEY,
        })
    }

    const objectId = resolveThreadObjectId(toolRuntimeContext, requestUserId)
    const objectType = toolRuntimeContext?.objectType || 'tasks'
    const fetchImpl = deps.fetchImpl || globalThis.fetch
    const identityTokenProvider = deps.identityTokenProvider

    const step = await beginBrowserStep(db, {
        projectId,
        objectId,
        objectType,
        assistantId,
        requestUserId,
        sourceChannel: toolRuntimeContext?.sourceChannel || null,
        toolName,
        action,
        args: toolArgs,
        config,
        startsRun: action === 'navigate',
        charges: buildChargesForAction(action),
        now,
    })

    if (!step.ok) {
        // A run that hit a limit is over: close the worker session so a wedged page is not held for
        // the rest of the idle window.
        if (step.reason === 'limit_exceeded' && step.runId) {
            await closeBrowserSession({
                db,
                config,
                runId: step.runId,
                fetchImpl,
                identityTokenProvider,
                reason: 'limit_exceeded',
                now,
            })
        }
        return failure(step.message, { reason: step.reason, violation: step.violation || undefined })
    }

    const { runId, stepId, run, budget, limits } = step
    const sessionId = run.workerSessionId
    const startedAt = now
    let affinityCookie = run.affinityCookie || ''

    try {
        // ---- OBSERVE ---------------------------------------------------------------------
        let target = null
        let pageUrl = typeof toolArgs.url === 'string' ? toolArgs.url : run.lastPageUrl || ''

        if (isMutatingBrowserAction(action)) {
            const described = await describeTarget({
                config,
                runId,
                sessionId,
                projectId,
                userId: requestUserId,
                args: toolArgs,
                fetchImpl,
                identityTokenProvider,
                affinityCookie,
                now,
            })
            if (described.affinityCookie) {
                affinityCookie = described.affinityCookie
                await runRef(db, runId).set({ affinityCookie }, { merge: true })
            }
            if (!described.ok || !described.target) {
                const message =
                    described.error ||
                    'The element could not be found on the current page. Take a fresh browser_inspect snapshot and use a ref from it.'
                await completeBrowserStep(db, {
                    runId,
                    stepId,
                    outcome: { status: 'failed', error: message, decision: 'deny', reason: 'target_unresolved' },
                    now,
                })
                return failure(message, { reason: 'target_unresolved' })
            }
            target = described.target
            pageUrl = described.pageUrl || pageUrl
        }

        // ---- POLICY ----------------------------------------------------------------------
        const decision = evaluateBrowserAction({
            action,
            args: toolArgs,
            // The whole policy, not just the allowlist: the mode and the denylist decide the same
            // question and must not be answerable anywhere else.
            allowlist: config.policy,
            target,
            pageUrl,
            allowSearchSubmit: config.allowSearchSubmit,
        })

        if (decision.decision === 'deny') {
            await completeBrowserStep(db, {
                runId,
                stepId,
                outcome: {
                    status: 'blocked',
                    decision: 'deny',
                    reason: decision.reason,
                    categories: decision.categories,
                    evidence: decision.evidence,
                    target,
                    pageUrl,
                    error: decision.message,
                    durationMs: Date.now() - startedAt,
                },
                now,
            })
            return failure(decision.message, { reason: decision.reason, blocked: true })
        }

        let approvalScope = null
        let approvalId = null
        if (decision.decision === 'requires_approval') {
            const signature = decision.signature
            const currentRun = await readRun(db, runId)

            if (isSignatureDenied(currentRun, signature)) {
                const message = `The user declined this action (${decision.category}) earlier in this browsing run. Do not try it again; report back instead.`
                await completeBrowserStep(db, {
                    runId,
                    stepId,
                    outcome: {
                        status: 'blocked',
                        decision: 'denied_by_user',
                        reason: 'approval_denied',
                        category: decision.category,
                        categories: decision.categories,
                        evidence: decision.evidence,
                        target,
                        pageUrl,
                        durationMs: Date.now() - startedAt,
                    },
                    now,
                })
                return failure(message, { reason: 'approval_denied', blocked: true, category: decision.category })
            }

            const grant = findApprovalGrant(currentRun, signature, now)
            if (grant) {
                const consumed = await consumeGrant(db, runId, signature, now)
                if (!consumed) {
                    return failure('The approval for this action was already used. Ask the user again.', {
                        reason: 'approval_consumed',
                    })
                }
                approvalScope = consumed.scope
                approvalId = consumed.approvalId
            } else {
                const request = await requestBrowserApproval(db, runRef(db, runId), currentRun, {
                    runId,
                    stepId,
                    projectId,
                    objectId,
                    objectType,
                    assistantId,
                    requestUserId,
                    toolName,
                    action,
                    category: decision.category,
                    categories: decision.categories,
                    signature,
                    hostname: decision.hostname,
                    pageUrl: redactUrl(pageUrl, { mode: 'audit' }),
                    message: decision.message,
                    evidence: decision.evidence,
                    target,
                    allowRunScope: decision.allowRunScope === true,
                    // The comment the user is reading when the assistant stops and asks. Without it
                    // the approval exists but has nowhere to render.
                    assistantCommentId: toolRuntimeContext?.assistantCommentId || null,
                    now,
                })
                await completeBrowserStep(db, {
                    runId,
                    stepId,
                    outcome: {
                        status: 'awaiting_approval',
                        decision: 'requires_approval',
                        reason: decision.reason,
                        category: decision.category,
                        categories: decision.categories,
                        evidence: decision.evidence,
                        approvalId: request.approvalId,
                        target,
                        pageUrl,
                        durationMs: Date.now() - startedAt,
                    },
                    now,
                })
                return {
                    success: false,
                    status: 'approval_required',
                    approvalId: request.approvalId,
                    category: decision.category,
                    action,
                    hostname: decision.hostname,
                    allowRunScope: decision.allowRunScope === true,
                    error: decision.message,
                    message: `${decision.message} It was NOT performed. The user has to approve it explicitly first.`,
                    instruction:
                        'Tell the user exactly what you are about to do and that it needs their approval, then stop. Do not retry this call and do not look for another way to perform the same action.',
                    observed: {
                        role: target?.role || null,
                        name: redactForModel(String(target?.name || '')).slice(0, 160),
                        submits: target?.isSubmit === true,
                    },
                }
            }
        }

        // ---- BILLING GATE ----------------------------------------------------------------
        // Asked before the browser is touched: acting first and discovering an empty balance
        // afterwards would perform something on a third-party site that Alldone cannot bill.
        const affordable = await hasGoldForBrowserStep(db, requestUserId, BROWSER_STEP_GOLD)
        if (!affordable.ok) {
            await completeBrowserStep(db, {
                runId,
                stepId,
                outcome: {
                    status: 'blocked',
                    decision: 'deny',
                    reason: 'insufficient_gold',
                    category: decision.category,
                    categories: decision.categories,
                    target,
                    pageUrl,
                    error: 'Not enough Gold for another browsing step.',
                    durationMs: Date.now() - startedAt,
                },
                now,
            })
            return failure(
                `Browsing costs ${BROWSER_STEP_GOLD} Gold per step and there is not enough Gold left. Tell the user, and stop browsing.`,
                { reason: 'insufficient_gold', blocked: true }
            )
        }

        // ---- ACT -------------------------------------------------------------------------
        const workerResult = await callBrowserWorker({
            operation: 'act',
            payload: buildWorkerPayload(action, toolArgs, decision, limits),
            config,
            runId,
            sessionId,
            projectId,
            userId: requestUserId,
            fetchImpl,
            identityTokenProvider,
            affinityCookie,
            now,
        })

        if (workerResult.affinityCookie) {
            affinityCookie = workerResult.affinityCookie
            await runRef(db, runId).set({ affinityCookie }, { merge: true })
        }

        if (!workerResult.ok) {
            await completeBrowserStep(db, {
                runId,
                stepId,
                outcome: {
                    status: 'failed',
                    decision: decision.decision,
                    reason: workerResult.reason || 'worker_error',
                    category: decision.category,
                    categories: decision.categories,
                    approvalId,
                    approvalScope,
                    target,
                    pageUrl,
                    error: workerResult.error,
                    durationMs: Date.now() - startedAt,
                },
                usage: workerResult.usage || null,
                now,
            })
            if (workerResult.usage) await applyRunUsage(db, { runId, usage: workerResult.usage, now })
            return failure(workerResult.error, { reason: workerResult.reason || 'worker_error' })
        }

        // ---- BILLING ---------------------------------------------------------------------
        // Only a step that actually did something in the browser is charged; a refusal, a pause for
        // an approval and a worker failure all return above this line. The step id is the
        // idempotency key, so a retry of this whole call cannot charge twice.
        const goldCharge = await chargeGoldForBrowserStep({
            db,
            userId: requestUserId,
            runId,
            stepId,
            projectId,
            objectId,
            objectType,
            toolName,
            hostname: decision.hostname || null,
            deductGoldImpl: deps.deductGold || null,
        })

        // ---- EVIDENCE + AUDIT ------------------------------------------------------------
        const bucket = deps.bucket !== undefined ? deps.bucket : getDefaultEvidenceBucket()
        const evidence = await storeBrowserEvidence({
            bucket,
            runId,
            stepId,
            screenshotBase64: workerResult.screenshotBase64 || '',
            snapshot: workerResult.snapshot || null,
        })

        if (workerResult.usage) await applyRunUsage(db, { runId, usage: workerResult.usage, now })
        await db
            .doc(`browserRuns/${runId}`)
            .set(
                { lastPageUrl: workerResult.finalUrl || workerResult.url || pageUrl, lastActivityAt: now },
                { merge: true }
            )

        await completeBrowserStep(db, {
            runId,
            stepId,
            outcome: {
                status: 'completed',
                decision: decision.decision,
                reason: decision.reason,
                category: decision.category,
                categories: decision.categories,
                evidence: decision.evidence,
                approvalId,
                approvalScope,
                target,
                pageUrl,
                finalUrl: workerResult.finalUrl || workerResult.url,
                httpStatus: workerResult.httpStatus,
                redirectChain: workerResult.redirectChain,
                typedValue: action === 'type' ? describeTypedValue(toolArgs.text) : null,
                evidence_refs: {
                    screenshotPath: evidence.screenshot?.path || null,
                    screenshotSha256: evidence.screenshot?.sha256 || null,
                    snapshotPath: evidence.snapshot?.path || null,
                    snapshotSha256: evidence.snapshot?.sha256 || null,
                    missing: evidence.errors,
                },
                durationMs: Date.now() - startedAt,
            },
            usage: workerResult.usage || null,
            now,
        })

        const budgetSummary = summarizeBudget(budget, limits)
        const result = buildPageResult(action, workerResult, evidence, budgetSummary, limits.maxSnapshotChars)

        if (action === 'type') {
            result.typed = describeTypedValue(toolArgs.text)
            result.submitted = toolArgs.submit === true
        }
        if (action === 'click') {
            result.clicked = {
                role: target?.role || null,
                name: redactForModel(String(target?.name || '')).slice(0, 160),
            }
        }
        if (action === 'wait') result.waitedMs = Number(workerResult.waitedMs) || null
        if (approvalId) result.approvedBy = { approvalId, scope: approvalScope }
        // Reported so the model can tell the user what a browsing session is costing them, and so a
        // step that could not be billed is visible rather than silently free.
        result.goldCost = goldCharge.charged || goldCharge.alreadyProcessed ? BROWSER_STEP_GOLD : 0
        return result
    } catch (error) {
        await completeBrowserStep(db, {
            runId,
            stepId,
            outcome: { status: 'failed', error: error.message, durationMs: Date.now() - startedAt },
            now,
        })
        console.error('🌐 BROWSER: tool call failed', { toolName, projectId, error: error.message })
        return failure(`The browsing step failed: ${error.message}`, { reason: 'internal_error' })
    }
}

function buildWorkerPayload(action, toolArgs, decision, limits) {
    switch (action) {
        case 'navigate':
            return {
                action,
                url: decision.url,
                waitUntil: toolArgs.waitUntil === 'load' ? 'load' : 'domcontentloaded',
                maxChars: limits.maxSnapshotChars,
                captureSnapshot: true,
            }
        case 'inspect':
            return {
                action,
                scope: typeof toolArgs.scope === 'string' ? toolArgs.scope.slice(0, 200) : '',
                maxChars: limits.maxSnapshotChars,
                captureSnapshot: true,
            }
        case 'click':
            return {
                action,
                ref: toolArgs.ref || '',
                selector: toolArgs.selector || '',
                maxChars: limits.maxSnapshotChars,
            }
        case 'type':
            return {
                action,
                ref: toolArgs.ref || '',
                selector: toolArgs.selector || '',
                text: String(toolArgs.text || ''),
                submit: toolArgs.submit === true,
                clearFirst: toolArgs.clearFirst !== false,
                maxChars: limits.maxSnapshotChars,
            }
        case 'wait':
            return {
                action,
                ms: Number(toolArgs.ms) || 0,
                selector: typeof toolArgs.selector === 'string' ? toolArgs.selector.slice(0, 200) : '',
                state: toolArgs.state === 'hidden' ? 'hidden' : 'visible',
            }
        case 'screenshot':
            return { action, fullPage: toolArgs.fullPage === true }
        default:
            return { action }
    }
}

async function readRun(db, runId) {
    const snapshot = await runRef(db, runId).get()
    return snapshot.exists ? snapshot.data() : null
}

/** Tear the worker context down and close the run. Best effort on both halves. */
async function closeBrowserSession({
    db,
    config,
    runId,
    fetchImpl,
    identityTokenProvider,
    reason = 'finished',
    now = Date.now(),
}) {
    try {
        const run = await readRun(db, runId)
        if (run?.workerSessionId && config?.enabled) {
            await callBrowserWorker({
                operation: 'close',
                payload: {},
                config,
                runId,
                sessionId: run.workerSessionId,
                projectId: run.projectId,
                userId: run.requestUserId,
                fetchImpl,
                identityTokenProvider,
                affinityCookie: run.affinityCookie || '',
                now,
            })
        }
    } catch (error) {
        console.warn('🌐 BROWSER: could not close the worker session', { runId, error: error.message })
    }
    await finishBrowserRun(db, {
        runId,
        status: reason === 'limit_exceeded' ? RUN_STATUS.ABORTED : RUN_STATUS.FINISHED,
        reason,
        now,
    })
}

function getDefaultDb() {
    try {
        const admin = require('firebase-admin')
        return admin.firestore()
    } catch (error) {
        console.error('🌐 BROWSER: firebase-admin is unavailable', { error: error.message })
        return null
    }
}

function getDefaultEnv() {
    try {
        const { getEnvFunctions } = require('../../envFunctionsHelper')
        return getEnvFunctions()
    } catch (error) {
        console.error('🌐 BROWSER: environment configuration is unavailable', { error: error.message })
        return {}
    }
}

module.exports = {
    buildWorkerPayload,
    closeBrowserSession,
    executeBrowserTool,
    resolveThreadObjectId,
    sanitizeElementsForModel,
}
