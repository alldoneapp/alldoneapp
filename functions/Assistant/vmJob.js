const admin = require('firebase-admin')
const crypto = require('crypto')
const { getFunctions } = require('firebase-admin/functions')
const { createInitialStatusMessage } = require('./assistantStatusHelper')

// Hybrid Gold pricing for a VM run:
//   total = VM_JOB_BASE_GOLD + ceil(runtimeMinutes) * VM_GOLD_PER_MINUTE
//                            + round(totalTokens / VM_TOKENS_PER_GOLD)
// The base reserve is charged up-front (refunded if the run fails); the per-minute
// (E2B compute) + per-token (LLM usage) top-up is charged by the worker on completion
// from the agent's actual reported usage. Per-token rate matches in-app assistant usage.
const VM_JOB_BASE_GOLD = 2
const VM_GOLD_PER_MINUTE = 1
const VM_TOKENS_PER_GOLD = 100

// Gold transaction sources (labels live in GoldTransactionsModal.getTransactionLabel).
const VM_JOB_GOLD_SOURCE = 'vm_execution'
const VM_JOB_GOLD_REFUND_SOURCE = 'vm_execution_refund'

// Generous expiry — must be larger than the worker's own runtime ceiling so the
// worker always finalizes the job before cleanupExpiredWebhooks could reap it.
const VM_JOB_EXPIRY_MS = 90 * 60 * 1000 // 90 minutes

// Safety cap: how many VM jobs a single user may have running at once.
const MAX_CONCURRENT_VM_JOBS_PER_USER = 3

const REGION = 'europe-west1'
const RUN_VM_JOB_FUNCTION_NAME = 'runVmJob'

const VALID_TASK_TYPES = ['research', 'document', 'prototype', 'data']

// Coding agents the assistant can choose to run in the VM (E2B prebuilt templates).
const VALID_AGENTS = ['claude', 'codex']
const DEFAULT_AGENT = 'claude'
const DEFAULT_CLAUDE_MODEL = 'opus'
const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol'
const DEFAULT_CLAUDE_EFFORT_LEVEL = 'high'
const DEFAULT_CODEX_REASONING_EFFORT = 'high'
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
    if (projectId) {
        return `locations/${REGION}/functions/${RUN_VM_JOB_FUNCTION_NAME}`
    }
    return RUN_VM_JOB_FUNCTION_NAME
}

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
    agent = DEFAULT_AGENT,
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
    const selectedAgent = VALID_AGENTS.includes(agent) ? agent : DEFAULT_AGENT
    const selectedAgentLabel = getAgentLabel(selectedAgent)
    const modelResult = normalizeAgentModel(selectedAgent, agentModel)
    if (modelResult.error) {
        return { success: false, message: modelResult.error }
    }
    const effortResult = normalizeAgentReasoningEffort(selectedAgent, agentReasoningEffort)
    if (effortResult.error) {
        return { success: false, message: effortResult.error }
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

    // Enforce the per-user concurrency cap.
    const activeJobs = await countActiveVmJobsForUser(requestUserId)
    if (activeJobs >= MAX_CONCURRENT_VM_JOBS_PER_USER) {
        return {
            success: false,
            message: `You already have ${activeJobs} VM tasks running. Please wait for one to finish before starting another.`,
        }
    }

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
            )} in a VM to work on this…`,
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

    // Enqueue the long-running worker via Cloud Tasks.
    try {
        const queue = getFunctions().taskQueue(getRunVmJobQueueResource())
        await queue.enqueue({ correlationId })
    } catch (error) {
        console.error('🖥️ VM JOB: Failed to enqueue worker — refunding', { correlationId, error: error.message })
        const { refundGold } = require('../Gold/goldHelper')
        await refundGold(requestUserId, VM_JOB_BASE_GOLD, {
            source: VM_JOB_GOLD_REFUND_SOURCE,
            channel: 'assistant',
            projectId,
            objectId,
            objectType,
            note: 'VM task could not be queued',
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
            message: 'Could not start the VM task right now. Your Gold has been refunded.',
        }
    }

    return {
        success: true,
        status: 'started',
        correlationId,
        agent: selectedAgent,
        message: `VM task started with ${selectedAgentLabel}. It will work autonomously and post the finished result back into this conversation when ready.`,
    }
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
    MAX_CONCURRENT_VM_JOBS_PER_USER,
    VALID_TASK_TYPES,
    getAgentLabel,
    formatAgentRunSuffix,
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CLAUDE_EFFORT_LEVEL,
    DEFAULT_CODEX_REASONING_EFFORT,
}
