const admin = require('firebase-admin')
const crypto = require('crypto')
const { getFunctions } = require('firebase-admin/functions')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { MAX_CONCURRENT_VM_JOBS_PER_USER } = require('./vmJobConfig')
const {
    VALID_VM_AGENTS: VALID_AGENTS,
    SYSTEM_DEFAULT_VM_AGENT: DEFAULT_AGENT,
    resolveVmAgentSettings,
} = require('./vmAgentSettings')

// Hybrid Gold pricing for a VM run:
//   total = VM_JOB_BASE_GOLD + ceil(runtimeMinutes) * VM_GOLD_PER_MINUTE
//                            + round(totalTokens / VM_TOKENS_PER_GOLD)
// The base reserve is charged up-front (refunded if the run fails); the per-minute
// (E2B compute) + per-token (LLM usage) top-up is charged by the worker on completion
// from the agent's actual reported usage. Per-token rate matches in-app assistant usage.
const VM_JOB_BASE_GOLD = 20
const VM_GOLD_PER_MINUTE = 10
const VM_TOKENS_PER_GOLD = 100

// Gold transaction sources (labels live in GoldTransactionsModal.getTransactionLabel).
const VM_JOB_GOLD_SOURCE = 'vm_execution'
const VM_JOB_GOLD_REFUND_SOURCE = 'vm_execution_refund'

// Generous expiry — must be larger than the detached job's runtime ceiling so the
// worker always finalizes the job before cleanupExpiredWebhooks could reap it.
const VM_JOB_EXPIRY_MS = 6 * 60 * 60 * 1000
const VM_CLOUD_RUN_LAUNCH_RECONCILIATION_MS = 10 * 60 * 1000
const REGION = 'europe-west1'
const RUN_VM_JOB_FUNCTION_NAME = 'runVmJob'

const VALID_TASK_TYPES = ['research', 'document', 'prototype', 'data']

function cloudRunVmJobsEnabled() {
    const configuredValue = process.env.VM_CLOUD_RUN_JOBS_ENABLED || getEnvFunctions().VM_CLOUD_RUN_JOBS_ENABLED
    return String(configuredValue || '').toLowerCase() === 'true'
}

function getRunVmJobQueueResource() {
    const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (() => {
            try {
                return admin.app().options.projectId
            } catch (_) {
                return undefined
            }
        })()
    if (projectId) return `locations/${REGION}/functions/${RUN_VM_JOB_FUNCTION_NAME}`
    return RUN_VM_JOB_FUNCTION_NAME
}

// Coding agents the assistant can choose to run in the VM (E2B prebuilt templates).
const DEFAULT_CLAUDE_MODEL = 'opus'
const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol'
const DEFAULT_CLAUDE_EFFORT_LEVEL = 'high'
const DEFAULT_CODEX_REASONING_EFFORT = 'medium'
const VALID_CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh']
const VALID_CODEX_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const MODEL_SAFE_PATTERN = /^[A-Za-z0-9._-]+$/
const AGENT_LABELS = {
    claude: 'Claude',
    codex: 'Codex',
}

function getAgentLabel(agent) {
    return AGENT_LABELS[agent] || AGENT_LABELS[DEFAULT_AGENT]
}

/**
 * Human-readable "(model · effort)" suffix appended to the VM status messages so the user
 * can see which model and effort level the agent is running with (e.g. "(opus · high effort)").
 * Returns an empty string when neither is known, so older callers stay unchanged.
 */
function formatAgentRunSuffix(model, effort) {
    const parts = []
    if (model) parts.push(model)
    if (effort) parts.push(`${effort} effort`)
    return parts.length ? ` (${parts.join(' · ')})` : ''
}

function formatVmBillingStatus(agentLabel, credentialMode) {
    const mode = typeof credentialMode === 'boolean' ? (credentialMode ? 'subscription' : 'api') : credentialMode
    if (mode === 'subscription') {
        return `🔐 Using your ${agentLabel} subscription. VM tokens will not cost Gold.`
    }
    if (mode === 'byok') {
        return `🔐 Using your personal ${agentLabel} API key. Provider token costs are billed directly to you; Alldone charges no token Gold.`
    }
    return '🔑 Using Alldone API billing. VM tokens will cost Gold.'
}

function isClaudeModelId(model) {
    return model === 'opus' || model === 'sonnet' || model === 'haiku' || model.startsWith('claude-')
}

function isCodexModelId(model) {
    if (model.startsWith('gpt-')) return true
    return /^o\d/.test(model)
}

function normalizeAgentModel(agent, agentModel) {
    const trimmed = typeof agentModel === 'string' ? agentModel.trim() : ''
    const fallback = agent === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL
    if (!trimmed) return { value: fallback }
    if (!MODEL_SAFE_PATTERN.test(trimmed)) {
        return { error: 'agentModel contains invalid characters.' }
    }
    if (agent === 'claude') {
        return isClaudeModelId(trimmed)
            ? { value: trimmed }
            : { error: 'agentModel must be a Claude model id when agent="claude".' }
    }
    if (agent === 'codex') {
        return isCodexModelId(trimmed)
            ? { value: trimmed }
            : { error: 'agentModel must be an OpenAI model id when agent="codex".' }
    }
    return { value: fallback }
}

function normalizeAgentReasoningEffort(agent, effort) {
    const trimmed = typeof effort === 'string' ? effort.trim().toLowerCase() : ''
    const fallback = agent === 'codex' ? DEFAULT_CODEX_REASONING_EFFORT : DEFAULT_CLAUDE_EFFORT_LEVEL
    if (agent === 'codex') {
        if (!trimmed) return { value: fallback }
        // Current Codex may attach web_search to Responses requests, and OpenAI rejects that
        // tool when reasoning.effort is "minimal". Preserve compatibility with callers that
        // still send the old value by clamping it to the lowest supported VM effort.
        if (trimmed === 'minimal') return { value: 'low' }
        if (!VALID_CODEX_REASONING_EFFORTS.includes(trimmed)) {
            return {
                error: `agentReasoningEffort must be one of: ${VALID_CODEX_REASONING_EFFORTS.join(', ')}.`,
            }
        }
        return { value: trimmed }
    }
    if (agent === 'claude') {
        if (!trimmed) return { value: fallback }
        if (!VALID_CLAUDE_EFFORT_LEVELS.includes(trimmed)) {
            return {
                error: `agentReasoningEffort must be one of: ${VALID_CLAUDE_EFFORT_LEVELS.join(', ')}.`,
            }
        }
        return { value: trimmed }
    }
    if (trimmed) {
        return { error: 'agentReasoningEffort is not supported for this agent.' }
    }
    return { value: null }
}

/**
 * Build the fully-qualified Cloud Tasks queue resource for the worker function so
 * enqueue() targets the correct region instead of the default location.
 */
/**
 * Best-effort packaging of app context for the VM. The VM has no access to the
 * app, so anything it needs must be serialized here into a plain-text bundle.
 */
async function packageContextObjects(projectId, objectIds) {
    const db = admin.firestore()
    const sections = []

    for (const objectId of objectIds) {
        if (!objectId) continue
        const candidates = [
            { type: 'task', path: `items/${projectId}/tasks/${objectId}` },
            { type: 'goal', path: `goals/${projectId}/items/${objectId}` },
            { type: 'note', path: `noteItems/${projectId}/notes/${objectId}` },
        ]
        for (const candidate of candidates) {
            try {
                const doc = await db.doc(candidate.path).get()
                if (!doc.exists) continue
                const data = doc.data() || {}
                const title = data.extendedName || data.name || data.title || objectId
                const body = typeof data.description === 'string' ? data.description : ''
                sections.push(
                    `### ${candidate.type}: ${title}\n${body ? body : '(no text description available)'}`.trim()
                )
                break
            } catch (error) {
                console.warn('🖥️ VM JOB: Failed reading context object', {
                    projectId,
                    objectId,
                    path: candidate.path,
                    error: error.message,
                })
            }
        }
    }

    return sections.join('\n\n')
}

/**
 * Count this user's in-flight VM jobs (used to enforce the concurrency cap).
 */
async function countActiveVmJobsForUser(userId) {
    try {
        const snapshot = await admin
            .firestore()
            .collection('pendingWebhooks')
            .where('userId', '==', userId)
            .where('kind', '==', 'vm_job')
            .where('status', 'in', ['pending', 'initiated'])
            .get()
        return snapshot.size
    } catch (error) {
        // If the composite index isn't ready, don't block the user — log and allow.
        console.warn('🖥️ VM JOB: Failed counting active VM jobs, allowing', { userId, error: error.message })
        return 0
    }
}

/**
 * Start an asynchronous VM job. Called from the execute_task_in_vm tool handler.
 * Returns quickly: it deducts Gold, records the job, posts a status comment and
 * enqueues the long-running worker. The finished result is posted back into the
 * conversation by the worker (see vmJobRunner.js).
 */
async function startVmJob({
    objective,
    taskType,
    agent,
    agentModel,
    agentReasoningEffort,
    contextObjectIds = [],
    deliverable = '',
    threadContext = '',
    projectId,
    objectType = 'tasks',
    objectId,
    assistantId,
    requestUserId,
    triggerChannel = '',
    whatsappTo = '',
    originProjectId = '',
    originObjectType = '',
    originObjectId = '',
    originAssistantId = '',
}) {
    if (!objective || typeof objective !== 'string' || !objective.trim()) {
        return { success: false, message: 'A non-empty objective is required to run a task in a VM.' }
    }
    if (!VALID_TASK_TYPES.includes(taskType)) {
        return {
            success: false,
            message: `task_type must be one of: ${VALID_TASK_TYPES.join(', ')}.`,
        }
    }
    if (!projectId || !objectId) {
        return {
            success: false,
            message: 'A VM task can only be started from within a task or topic conversation.',
        }
    }
    if (!requestUserId) {
        return { success: false, message: 'A VM task requires a requesting user.' }
    }
    if (agent != null && agent !== '' && !VALID_AGENTS.includes(agent)) {
        return { success: false, message: `agent must be one of: ${VALID_AGENTS.join(', ')}.` }
    }

    const resolvedAgentSettings = await resolveVmAgentSettings(requestUserId, agent, agentReasoningEffort)
    const selectedAgent = resolvedAgentSettings.agent
    const selectedAgentLabel = getAgentLabel(selectedAgent)
    const modelResult = normalizeAgentModel(selectedAgent, agentModel)
    if (modelResult.error) {
        return { success: false, message: modelResult.error }
    }
    const effortResult = normalizeAgentReasoningEffort(selectedAgent, resolvedAgentSettings.reasoningEffort)
    if (effortResult.error) {
        return { success: false, message: effortResult.error }
    }

    // Enforce the per-user concurrency cap.
    const activeJobs = await countActiveVmJobsForUser(requestUserId)
    if (activeJobs >= MAX_CONCURRENT_VM_JOBS_PER_USER) {
        return {
            success: false,
            message: `You already have ${activeJobs} VM tasks running. Please wait for one to finish before starting another.`,
        }
    }

    // Resolve the user's explicit provider route. Legacy users keep the old behavior:
    // connected subscription first, otherwise Alldone API billing.
    const credentialMode = await require('./vmApiKeyAuth').resolveVmCredentialMode(requestUserId, selectedAgent)
    const subscriptionUsed = credentialMode === 'subscription'
    const personalApiKeyUsed = credentialMode === 'byok'
    const tokenBillingExempt = subscriptionUsed || personalApiKeyUsed

    // Charge the up-front base reserve. The metered per-minute + per-token top-up is
    // charged by the worker on completion. The base is refunded if the run fails.
    const { deductGold } = require('../Gold/goldHelper')
    const goldResult = await deductGold(requestUserId, VM_JOB_BASE_GOLD, {
        source: VM_JOB_GOLD_SOURCE,
        channel: 'assistant',
        projectId,
        objectId,
        objectType,
        note: `VM task base reserve (${selectedAgent}/${taskType})`,
    })
    if (!goldResult || !goldResult.success) {
        return {
            success: false,
            message: goldResult?.message || 'Not enough Gold to run a task in a VM.',
        }
    }

    const correlationId = crypto.randomUUID()
    const userIdsToNotify = [requestUserId]

    // Read existing chat visibility, if any, to mirror it on notifications.
    let isPublicFor = []
    try {
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
        if (chatDoc.exists) isPublicFor = chatDoc.data().isPublicFor || []
    } catch (_) {}

    // Post the single status comment that the worker will update in place.
    let statusCommentId = null
    try {
        statusCommentId = await createInitialStatusMessage(
            projectId,
            objectType,
            objectId,
            assistantId,
            `🖥️ Spinning up ${selectedAgentLabel}${formatAgentRunSuffix(
                modelResult.value,
                effortResult.value
            )} in a VM to work on this…\n\n${formatVmBillingStatus(selectedAgentLabel, credentialMode)}`,
            userIdsToNotify,
            isPublicFor,
            [requestUserId]
        )
        await admin
            .firestore()
            .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${statusCommentId}`)
            .set(
                {
                    isLoading: true,
                    assistantRun: {
                        kind: 'vm_job',
                        runId: correlationId,
                        requestUserId,
                        status: 'running',
                    },
                },
                { merge: true }
            )
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed posting initial status comment', { correlationId, error: error.message })
    }

    // Package context (originating object + any explicitly referenced objects).
    const contextIds = Array.from(new Set([objectId, ...(Array.isArray(contextObjectIds) ? contextObjectIds : [])]))
    const packagedContext = await packageContextObjects(projectId, contextIds)

    // Job status record (also reaped by cleanupExpiredWebhooks if it ever overruns).
    const pendingWebhookPayload = {
        correlationId,
        kind: 'vm_job',
        userId: requestUserId,
        projectId,
        objectId,
        objectType,
        assistantId,
        userIdsToNotify,
        isPublicFor,
        statusCommentId,
        goldCharged: VM_JOB_BASE_GOLD,
        credentialMode,
        subscriptionUsed,
        personalApiKeyUsed,
        tokenBillingExempt,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + VM_JOB_EXPIRY_MS,
    }
    const normalizedWhatsappTo = typeof whatsappTo === 'string' ? whatsappTo.trim() : ''
    if (triggerChannel === 'whatsapp' && normalizedWhatsappTo) {
        pendingWebhookPayload.triggerChannel = 'whatsapp'
        pendingWebhookPayload.whatsappTo = normalizedWhatsappTo
    }

    // Origin conversation (set when the job was delegated from another thread). Persist it only
    // when it's a real conversation distinct from the host thread, so the worker can post a
    // completion note back where the user is actually talking.
    const trimmedOriginProjectId = typeof originProjectId === 'string' ? originProjectId.trim() : ''
    const trimmedOriginObjectId = typeof originObjectId === 'string' ? originObjectId.trim() : ''
    const trimmedOriginAssistantId = typeof originAssistantId === 'string' ? originAssistantId.trim() : ''
    const isDistinctOrigin =
        trimmedOriginProjectId &&
        trimmedOriginObjectId &&
        trimmedOriginAssistantId &&
        !(trimmedOriginProjectId === projectId && trimmedOriginObjectId === objectId)
    if (isDistinctOrigin) {
        pendingWebhookPayload.originProjectId = trimmedOriginProjectId
        pendingWebhookPayload.originObjectType = originObjectType || 'topics'
        pendingWebhookPayload.originObjectId = trimmedOriginObjectId
        pendingWebhookPayload.originAssistantId = trimmedOriginAssistantId
    }

    await admin.firestore().doc(`pendingWebhooks/${correlationId}`).set(pendingWebhookPayload)

    // Larger payload (objective + context) kept out of the status record.
    await admin
        .firestore()
        .doc(`vmJobs/${correlationId}`)
        .set({
            correlationId,
            objective: objective.trim(),
            taskType,
            agent: selectedAgent,
            agentModel: modelResult.value,
            agentReasoningEffort: effortResult.value,
            credentialMode,
            subscriptionUsed,
            personalApiKeyUsed,
            tokenBillingExempt,
            deliverable: deliverable || '',
            packagedContext: packagedContext || '',
            threadContext: threadContext || '',
            projectId,
            objectType,
            objectId,
            assistantId,
            requestUserId,
            createdAt: Date.now(),
        })

    const pendingRef = admin.firestore().doc(`pendingWebhooks/${correlationId}`)
    if (!cloudRunVmJobsEnabled()) {
        try {
            const queue = getFunctions().taskQueue(getRunVmJobQueueResource())
            await queue.enqueue({ correlationId })
            await pendingRef.set(
                {
                    launchBackend: 'cloud_tasks',
                    launchState: 'launched',
                    launchedAt: Date.now(),
                },
                { merge: true }
            )
        } catch (error) {
            console.error('🖥️ VM JOB: Failed to enqueue rollback worker — refunding', {
                correlationId,
                error: error.message,
            })
            const { refundGold } = require('../Gold/goldHelper')
            await refundGold(requestUserId, VM_JOB_BASE_GOLD, {
                source: VM_JOB_GOLD_REFUND_SOURCE,
                channel: 'assistant',
                projectId,
                objectId,
                objectType,
                note: 'VM task could not be queued',
            }).catch(() => {})
            await pendingRef.update({ status: 'failed', error: error.message, failedAt: Date.now() }).catch(() => {})
            if (statusCommentId) {
                const failureText = "❌ Couldn't start the VM task — your Gold has been refunded."
                await admin
                    .firestore()
                    .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${statusCommentId}`)
                    .set(
                        {
                            commentText: failureText,
                            originalContent: failureText,
                            lastChangeDate: admin.firestore.Timestamp.now(),
                        },
                        { merge: true }
                    )
                    .catch(() => {})
            }
            return {
                success: false,
                message: 'Could not start the VM task right now. Your Gold has been refunded.',
            }
        }
    } else {
        // Start a detached Cloud Run Job execution. The HTTP request only launches
        // the execution; the one-hour E2B supervision is not tied to Cloud Tasks.
        const launchRequestedAt = Date.now()
        await pendingRef.set(
            {
                launchBackend: 'cloud_run_job',
                launchState: 'requested',
                launchRequestedAt,
            },
            { merge: true }
        )
        try {
            const { launchVmCloudRunJob } = require('./vmCloudRunLauncher')
            const launch = await launchVmCloudRunJob(correlationId)
            await pendingRef.set(
                {
                    launchState: launch.executionName ? 'launched' : 'unknown',
                    cloudRunExecution: launch.executionName || null,
                    cloudRunOperation: launch.operationName || null,
                    launchReconciled: !!launch.reconciled,
                    launchedAt: Date.now(),
                },
                { merge: true }
            )
        } catch (error) {
            if (error.ambiguous) {
                console.warn('🖥️ VM JOB: Cloud Run launch result unknown; deferring to reconciler', {
                    correlationId,
                    error: error.message,
                })
                await pendingRef
                    .set(
                        {
                            launchState: 'unknown',
                            launchError: error.message,
                            launchLastCheckedAt: Date.now(),
                        },
                        { merge: true }
                    )
                    .catch(() => {})
                return {
                    success: true,
                    status: 'started',
                    correlationId,
                    message: `VM task launch is being confirmed. I'll post the result here when it finishes.`,
                }
            }
            console.error('🖥️ VM JOB: Failed to enqueue worker — refunding', { correlationId, error: error.message })
            const { refundGold } = require('../Gold/goldHelper')
            await refundGold(requestUserId, VM_JOB_BASE_GOLD, {
                source: VM_JOB_GOLD_REFUND_SOURCE,
                channel: 'assistant',
                projectId,
                objectId,
                objectType,
                note: 'VM Cloud Run Job could not be launched',
            }).catch(() => {})
            await admin
                .firestore()
                .doc(`pendingWebhooks/${correlationId}`)
                .update({ status: 'failed', error: error.message, failedAt: Date.now() })
                .catch(() => {})
            // Replace the initial VM status comment so it doesn't linger and
            // contradict the assistant's failure response.
            if (statusCommentId) {
                const failureText = "❌ Couldn't start the VM task — your Gold has been refunded."
                await admin
                    .firestore()
                    .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${statusCommentId}`)
                    .set(
                        {
                            commentText: failureText,
                            originalContent: failureText,
                            lastChangeDate: admin.firestore.Timestamp.now(),
                        },
                        { merge: true }
                    )
                    .catch(() => {})
            }
            return {
                success: false,
                message: 'Could not launch the VM task right now. Your Gold has been refunded.',
            }
        }
    }

    return {
        success: true,
        status: 'started',
        correlationId,
        agent: selectedAgent,
        credentialMode,
        message: `VM task started with ${selectedAgentLabel} using ${
            subscriptionUsed
                ? 'your subscription'
                : personalApiKeyUsed
                ? 'your personal API key'
                : 'Alldone API billing'
        }. It will work autonomously and post the finished result back into this conversation when ready.`,
    }
}

async function reconcileUnknownVmCloudRunLaunches(now = Date.now()) {
    const db = admin.firestore()
    const snapshot = await db.collection('pendingWebhooks').where('launchState', '==', 'unknown').limit(100).get()
    const result = { checked: 0, reconciled: 0, failed: 0, errors: 0 }
    const { findVmCloudRunExecution } = require('./vmCloudRunLauncher')

    for (const doc of snapshot.docs) {
        const pending = doc.data() || {}
        if (pending.kind !== 'vm_job' || ['completed', 'failed', 'cancelled'].includes(pending.status)) continue
        result.checked += 1
        try {
            const execution = await findVmCloudRunExecution(pending.correlationId || doc.id, {
                minCreateTime: (Number(pending.launchRequestedAt) || Number(pending.createdAt) || now) - 60 * 1000,
            })
            if (execution) {
                await doc.ref.set(
                    {
                        launchState: 'launched',
                        cloudRunExecution: execution.name,
                        launchReconciled: true,
                        launchLastCheckedAt: now,
                    },
                    { merge: true }
                )
                result.reconciled += 1
                continue
            }

            const requestedAt = Number(pending.launchRequestedAt) || Number(pending.createdAt) || now
            if (now - requestedAt < VM_CLOUD_RUN_LAUNCH_RECONCILIATION_MS) {
                await doc.ref.set({ launchLastCheckedAt: now }, { merge: true })
                continue
            }

            const didFail = await db.runTransaction(async transaction => {
                const latest = await transaction.get(doc.ref)
                const data = latest.exists ? latest.data() || {} : {}
                if (data.launchState !== 'unknown' || data.status !== 'pending') return false
                transaction.set(
                    doc.ref,
                    {
                        status: 'failed',
                        launchState: 'failed',
                        error: 'Cloud Run Job launch could not be confirmed',
                        failedAt: now,
                        launchLastCheckedAt: now,
                    },
                    { merge: true }
                )
                return true
            })
            if (!didFail) continue

            const { refundGold } = require('../Gold/goldHelper')
            await refundGold(pending.userId, Number(pending.goldCharged) || VM_JOB_BASE_GOLD, {
                source: VM_JOB_GOLD_REFUND_SOURCE,
                channel: 'assistant',
                projectId: pending.projectId,
                objectId: pending.objectId,
                objectType: pending.objectType,
                note: 'VM Cloud Run Job launch could not be confirmed',
            }).catch(() => {})
            if (pending.statusCommentId) {
                const failureText = "❌ Couldn't start the VM task — your Gold has been refunded."
                await db
                    .doc(
                        `chatComments/${pending.projectId}/${pending.objectType}/${pending.objectId}/comments/${pending.statusCommentId}`
                    )
                    .set(
                        {
                            commentText: failureText,
                            originalContent: failureText,
                            isLoading: false,
                            lastChangeDate: admin.firestore.Timestamp.now(),
                        },
                        { merge: true }
                    )
                    .catch(() => {})
            }
            result.failed += 1
        } catch (error) {
            result.errors += 1
            console.warn('🖥️ VM JOB: Cloud Run launch reconciliation failed', {
                correlationId: pending.correlationId || doc.id,
                error: error.message,
            })
        }
    }
    return result
}

module.exports = {
    startVmJob,
    countActiveVmJobsForUser,
    VM_JOB_BASE_GOLD,
    VM_GOLD_PER_MINUTE,
    VM_TOKENS_PER_GOLD,
    VM_JOB_GOLD_SOURCE,
    VM_JOB_GOLD_REFUND_SOURCE,
    VM_JOB_EXPIRY_MS,
    reconcileUnknownVmCloudRunLaunches,
    MAX_CONCURRENT_VM_JOBS_PER_USER,
    VALID_TASK_TYPES,
    getAgentLabel,
    formatAgentRunSuffix,
    formatVmBillingStatus,
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CLAUDE_EFFORT_LEVEL,
    DEFAULT_CODEX_REASONING_EFFORT,
    __private__: { cloudRunVmJobsEnabled, getRunVmJobQueueResource },
}
