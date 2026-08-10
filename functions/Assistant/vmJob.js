const admin = require('firebase-admin')
const crypto = require('crypto')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { MAX_CONCURRENT_VM_JOBS_PER_USER } = require('./vmJobConfig')
const {
    VALID_VM_AGENTS: VALID_AGENTS,
    SYSTEM_DEFAULT_VM_AGENT: DEFAULT_AGENT,
    VALID_VM_APPROVAL_POLICIES,
    isValidVmApprovalPolicy,
    resolveVmAgentSettings,
    resolveVmAgentModelFamily,
    resolveVmApprovalPolicy,
} = require('./vmAgentSettings')
const { resolveVmRunOverrides } = require('./vmRunOverrideGuard')
const { resolveFamilyToModel } = require('./vmAgentModelCatalog')
const { vmThreadSessionRef, admitVmJobToThread, isVmThreadOccupied, advanceVmThreadQueue } = require('./vmThreadQueue')
const { buildVmChatPath } = require('./vmHostTaskHelper')
const { applyVmFailureWorkflowHold } = require('./vmWorkflowHold')
const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { sanitizeTaskDescriptionText, buildTaskDescriptionMediaContextLines } = require('./taskDescriptionContext')
const { Timestamp } = require('firebase-admin/firestore')

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

// A queued follow-up whose owner just finished is only worth launching if the user can still afford
// to make progress. Below one VM minute's worth of Gold, a launched run would immediately hit
// gold-exhaustion, so we short-circuit it (refund the base reserve, settle as insufficient_gold)
// instead of burning a sandbox + Cloud Run execution to fail. Matches the runner's failure reason.
const VM_MIN_GOLD_TO_LAUNCH_QUEUED = VM_GOLD_PER_MINUTE
const VM_GOLD_EXHAUSTED_FAILURE_REASON = 'insufficient_gold'
const VM_QUEUED_GOLD_EXHAUSTED_TEXT =
    '🛑 Skipped this queued VM task because you ran out of Gold. Add Gold and start a new VM task to continue.'

// Generous expiry — must be larger than the detached job's runtime ceiling so the
// worker always finalizes the job before cleanupExpiredWebhooks could reap it.
const VM_JOB_EXPIRY_MS = 7 * 60 * 60 * 1000
const VM_CLOUD_RUN_LAUNCH_RECONCILIATION_MS = 10 * 60 * 1000
const VALID_TASK_TYPES = ['research', 'document', 'prototype', 'data']
const DEFAULT_VM_EXECUTION_MODE = 'automatic'
const VALID_VM_EXECUTION_MODES = [DEFAULT_VM_EXECUTION_MODE, 'plan_first', 'interactive']

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
 * can see which model and effort level the agent is running with (e.g. "(Opus 5.0 · high effort)").
 * Returns an empty string when neither is known, so older callers stay unchanged.
 */
function formatAgentModelLabel(model) {
    if (typeof model !== 'string' || !model) return model

    const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1)

    // A bare family name is one of Claude Code's moving aliases — the concrete version is only
    // known once the CLI reports it, which vmJobRunner captures into `resolvedAgentModel`.
    if (/^[a-z]+$/.test(model)) return `${capitalize(model)} latest; resolving version…`

    // claude-<family>-<major>[-<minor>][-<yyyymmdd>]  →  "Sonnet 4.6"
    const claudeVersion = /^claude-([a-z][a-z0-9]*)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(model)
    if (claudeVersion) {
        const [, family, major, minorOrDate] = claudeVersion
        const minor = minorOrDate && !/^\d{8}$/.test(minorOrDate) ? minorOrDate : '0'
        return `${capitalize(family)} ${major}.${minor}`
    }

    // gpt-<major>[.<minor>]-<family>  →  "Sol 5.6". Naming the tier (not the raw id) keeps the
    // status text aligned with the family the user actually picked in Settings.
    const codexVersion = /^gpt-(\d+)(?:\.(\d+))?-([a-z][a-z0-9]*)$/.exec(model)
    if (codexVersion) {
        const [, major, minor, family] = codexVersion
        return `${capitalize(family)} ${major}.${minor || '0'}`
    }

    return model
}

function formatAgentRunSuffix(model, effort) {
    const parts = []
    if (model) parts.push(formatAgentModelLabel(model))
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
        const model = trimmed === 'fable' ? 'claude-fable-5' : trimmed
        return isClaudeModelId(model)
            ? { value: model }
            : { error: 'agentModel must be a Claude model id when agent="claude".' }
    }
    if (agent === 'codex') {
        return isCodexModelId(trimmed)
            ? { value: trimmed }
            : { error: 'agentModel must be an OpenAI model id when agent="codex".' }
    }
    return { value: fallback }
}

/**
 * Decide which model this run uses (AT-2221).
 *
 * Precedence mirrors `agent` and `agentReasoningEffort`: an explicit tool argument wins, then
 * the requesting user's saved default *family*, then the agent's built-in default. The family
 * is resolved to a concrete id (or a Claude Code moving alias) at this moment rather than at
 * save time, which is what makes "always the latest version of that family" true.
 *
 * Every failure path falls through to the previous behaviour, so a user with no preference —
 * or a degraded catalog — gets exactly what they got before this feature existed.
 */
async function resolveAgentModelForRun(userId, agent, explicitModel) {
    const explicit = typeof explicitModel === 'string' ? explicitModel.trim() : ''
    if (explicit) return normalizeAgentModel(agent, explicit)

    try {
        const family = await resolveVmAgentModelFamily(userId, agent)
        if (family) {
            const resolved = await resolveFamilyToModel(agent, family)
            if (resolved) {
                const normalized = normalizeAgentModel(agent, resolved)
                // A catalog entry that fails our own shape check means something is off upstream;
                // prefer the known-good default over refusing to run.
                if (!normalized.error) return normalized
                console.warn('🖥️ VM MODELS: Resolved family failed validation, using agent default', {
                    agent,
                    family,
                    resolved,
                })
            }
        }
    } catch (error) {
        console.warn('🖥️ VM MODELS: Failed resolving default model family, using agent default', {
            agent,
            error: error.message,
        })
    }

    return normalizeAgentModel(agent, '')
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
                // Descriptions embed media as opaque sentinel tokens. Render the readable text and
                // list the media as downloadable URLs the agent can actually fetch in the sandbox.
                const rawBody = typeof data.description === 'string' ? data.description : ''
                const body = sanitizeTaskDescriptionText(rawBody)
                const mediaLines = buildTaskDescriptionMediaContextLines(rawBody)
                const section = `### ${candidate.type}: ${title}\n${body ? body : '(no text description available)'}${
                    mediaLines ? `\n${mediaLines}` : ''
                }`
                sections.push(section.trim())
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
    approvalPolicy,
    executionMode = DEFAULT_VM_EXECUTION_MODE,
    contextObjectIds = [],
    deliverable = '',
    threadContext = '',
    projectId,
    objectType = 'tasks',
    objectId,
    assistantId,
    requestUserId,
    // User-authored text this run was requested with (their message, the workflow step prompt).
    // Used only to corroborate the per-run overrides above — see vmRunOverrideGuard.
    requestText = '',
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
    if (!VALID_VM_EXECUTION_MODES.includes(executionMode)) {
        return {
            success: false,
            message: `executionMode must be one of: ${VALID_VM_EXECUTION_MODES.join(', ')}.`,
        }
    }
    if (approvalPolicy != null && approvalPolicy !== '' && !isValidVmApprovalPolicy(approvalPolicy)) {
        return {
            success: false,
            message: `approvalPolicy must be one of: ${VALID_VM_APPROVAL_POLICIES.join(', ')}.`,
        }
    }

    // An explicit per-run override outranks the user's saved defaults, so it is only accepted when
    // the user actually asked for it. The assistant otherwise fills these in on its own — a workflow
    // step for a coding task would pick Codex for a user whose saved default is Claude (AT-2224).
    // Anything not corroborated is dropped here and resolves from the saved preference below.
    const overrides = resolveVmRunOverrides({
        requestText,
        agent,
        agentModel,
        agentReasoningEffort,
        approvalPolicy,
    })
    if (overrides.ignored.length) {
        console.log('🖥️ VM JOB: Ignoring per-run overrides the request does not ask for', {
            requestUserId,
            projectId,
            objectId,
            ignored: overrides.ignored,
            hasRequestText: !!(requestText && requestText.trim()),
        })
    }

    // Explicit per-run value wins, then the requesting user's saved preference, then the system
    // default. Only consulted by interactive runs; automatic runs never pause for approvals.
    const resolvedApprovalPolicy = await resolveVmApprovalPolicy(requestUserId, overrides.approvalPolicy)
    const resolvedAgentSettings = await resolveVmAgentSettings(
        requestUserId,
        overrides.agent,
        overrides.agentReasoningEffort
    )
    const selectedAgent = resolvedAgentSettings.agent
    const selectedAgentLabel = getAgentLabel(selectedAgent)
    // `overrides.agentModel`, not the raw argument: an uncorroborated model the assistant invented is
    // dropped by the guard, which lets it resolve from the user's saved model family (AT-2221) instead.
    const modelResult = await resolveAgentModelForRun(requestUserId, selectedAgent, overrides.agentModel)
    if (modelResult.error) {
        return { success: false, message: modelResult.error }
    }
    const effortResult = normalizeAgentReasoningEffort(selectedAgent, resolvedAgentSettings.reasoningEffort)
    if (effortResult.error) {
        return { success: false, message: effortResult.error }
    }

    // Enforce the per-user concurrency cap — but only for a job that will actually start a sandbox
    // now. A same-thread follow-up (this thread's VM is still busy) is queued, not run, so it does
    // not consume a concurrency slot and must not be rejected by the cross-thread cap. Best-effort
    // peek; the authoritative launch-vs-queue decision is the admission transaction below.
    const threadSessionRef = vmThreadSessionRef(projectId, objectId)
    const threadOccupied = await isVmThreadOccupied(threadSessionRef).catch(() => false)
    if (!threadOccupied) {
        const activeJobs = await countActiveVmJobsForUser(requestUserId)
        if (activeJobs >= MAX_CONCURRENT_VM_JOBS_PER_USER) {
            return {
                success: false,
                message: `You already have ${activeJobs} VM tasks running. Please wait for one to finish before starting another.`,
            }
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
    // Frozen routing context for the asynchronous callback. The task/chat can change while the VM
    // runs, so the worker must not re-resolve the assistant from their eventual state.
    const callbackContext = {
        projectId,
        objectType,
        objectId,
        assistantId,
    }

    // Decide launch-vs-queue atomically. If this thread's VM is already running (or has jobs
    // waiting), queue this one so it runs on the SAME sandbox when the current job finishes, instead
    // of spinning up a throwaway isolated sandbox. Gold stays reserved for a queued job (refunded if
    // it's later cancelled/fails). On admission failure, refund and bail before posting anything.
    let admission
    try {
        admission = await admitVmJobToThread(threadSessionRef, correlationId)
    } catch (error) {
        console.error('🖥️ VM JOB: thread admission failed — refunding', { correlationId, error: error.message })
        const { refundGold } = require('../Gold/goldHelper')
        await refundGold(requestUserId, VM_JOB_BASE_GOLD, {
            source: VM_JOB_GOLD_REFUND_SOURCE,
            channel: 'assistant',
            projectId,
            objectId,
            objectType,
            note: 'VM task could not be queued',
        }).catch(() => {})
        return { success: false, message: 'Could not start the VM task right now. Your Gold has been refunded.' }
    }
    const queued = admission.decision === 'queue'

    // Read existing chat visibility, if any, to mirror it on notifications.
    let isPublicFor = []
    try {
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
        if (chatDoc.exists) isPublicFor = chatDoc.data().isPublicFor || []
    } catch (_) {}

    // Post the single status comment that the worker will update in place.
    let statusCommentId = null
    try {
        const initialStatusText = queued
            ? `⏳ Queued behind the current VM task on this thread. ${selectedAgentLabel}${formatAgentRunSuffix(
                  modelResult.value,
                  effortResult.value
              )} will start on this as soon as the running task finishes.\n\n${formatVmBillingStatus(
                  selectedAgentLabel,
                  credentialMode
              )}`
            : `🖥️ Spinning up ${selectedAgentLabel}${formatAgentRunSuffix(
                  modelResult.value,
                  effortResult.value
              )} in a VM to work on this…\n\n${formatVmBillingStatus(selectedAgentLabel, credentialMode)}`
        statusCommentId = await createInitialStatusMessage(
            projectId,
            objectType,
            objectId,
            assistantId,
            initialStatusText,
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
        callbackContext,
        userIdsToNotify,
        isPublicFor,
        statusCommentId,
        goldCharged: VM_JOB_BASE_GOLD,
        credentialMode,
        subscriptionUsed,
        personalApiKeyUsed,
        tokenBillingExempt,
        executionMode,
        approvalPolicy: resolvedApprovalPolicy,
        threadRunOrder: admission.sequence,
        threadRunCreatedAt: admission.admittedAt,
        // A queued job waits in the thread's FIFO queue and is flipped to 'pending' + launched by
        // the current job's drain (or the stalled-queue sweeper). 'queued' is excluded from the
        // cross-thread concurrency count so it never blocks jobs on other threads.
        status: queued ? 'queued' : 'pending',
        ...(queued ? { queuedAt: Date.now() } : {}),
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
            executionMode,
            approvalPolicy: resolvedApprovalPolicy,
            threadRunOrder: admission.sequence,
            threadRunCreatedAt: admission.admittedAt,
            deliverable: deliverable || '',
            packagedContext: packagedContext || '',
            threadContext: threadContext || '',
            projectId,
            objectType,
            objectId,
            assistantId,
            callbackContext,
            requestUserId,
            createdAt: Date.now(),
        })

    const pendingRef = admin.firestore().doc(`pendingWebhooks/${correlationId}`)

    // The thread hosting this job. Returned to the calling assistant so it can link the user to
    // where the work actually lives — which the caller cannot otherwise know when the job is hosted
    // in a freshly-created task (contextless / delegated dispatch), and which is also the id to
    // pass back as continue_in_object_id to carry this run on later.
    const hostThread = {
        hostProjectId: projectId,
        hostObjectType: objectType,
        hostObjectId: objectId,
        hostThreadUrl: `${getBaseUrl()}${buildVmChatPath(projectId, objectType, objectId)}`,
    }
    const hostThreadHint =
        `The work lives in this thread: ${hostThread.hostThreadUrl} — include that link in your answer so the user ` +
        `can follow progress, check the source, or continue there. To continue this same VM later (keeping its files ` +
        `and conversation), call execute_task_in_vm again with continue_in_object_id="${objectId}".`

    // Queued follow-up: don't launch a Cloud Run execution now. The running job's drain (or the
    // stalled-queue sweeper) flips this to 'pending' and launches it on the same thread sandbox when
    // the current task finishes.
    if (queued) {
        return {
            success: true,
            status: 'queued',
            correlationId,
            agent: selectedAgent,
            credentialMode,
            ...hostThread,
            message:
                `That VM is still working on the previous task on this thread. I've queued this — it will run on the ` +
                `same VM as soon as the current one finishes. ${hostThreadHint}`,
        }
    }

    const launch = await performVmCloudRunLaunch({
        correlationId,
        pendingRef,
        projectId,
        objectType,
        objectId,
        requestUserId,
        statusCommentId,
        assistantId,
    })
    if (launch.outcome === 'ambiguous') {
        return {
            success: true,
            status: 'started',
            correlationId,
            ...hostThread,
            message: `VM task launch is being confirmed. The result will be posted into the host thread when it finishes. ${hostThreadHint}`,
        }
    }
    if (launch.outcome === 'failed') {
        return {
            success: false,
            message: 'Could not launch the VM task right now. Your Gold has been refunded.',
        }
    }

    return {
        success: true,
        status: 'started',
        correlationId,
        agent: selectedAgent,
        credentialMode,
        ...hostThread,
        message: `VM task started with ${selectedAgentLabel} using ${
            subscriptionUsed
                ? 'your subscription'
                : personalApiKeyUsed
                  ? 'your personal API key'
                  : 'Alldone API billing'
        }. ${
            executionMode === 'plan_first'
                ? 'It will prepare a plan in the host thread and wait for approval before making changes.'
                : executionMode === 'interactive'
                  ? 'It will approve routine in-VM work automatically and pause in the host thread only for questions or risky operations.'
                  : 'It will work autonomously and post the finished result into the host thread when ready.'
        } ${hostThreadHint}`,
    }
}

/**
 * Launch a Cloud Run Job execution for an already-recorded VM job (its pendingWebhooks + vmJobs docs
 * exist). Shared by the initial dispatch and by the drain path that starts queued follow-ups. On a
 * definitive launch failure it refunds Gold, marks the job failed, finalizes the status comment, and
 * hands the thread to the next queued job so a launch failure never wedges the queue.
 *
 * @returns {Promise<{outcome: 'launched'|'ambiguous'|'failed'}>}
 */
async function performVmCloudRunLaunch({
    correlationId,
    pendingRef,
    projectId,
    objectType,
    objectId,
    requestUserId,
    statusCommentId,
    assistantId = null,
    executionAttemptId = crypto.randomUUID(),
}) {
    // The HTTP request only launches the detached execution; the five-hour sliced E2B supervision
    // is not tied to Cloud Tasks.
    await pendingRef.set(
        {
            launchBackend: 'cloud_run_job',
            launchState: 'requested',
            launchRequestedAt: Date.now(),
            executionAttemptId,
        },
        { merge: true }
    )
    try {
        const { launchVmCloudRunJob } = require('./vmCloudRunLauncher')
        const launch = await launchVmCloudRunJob(correlationId, { executionAttemptId })
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
        return { outcome: 'launched' }
    } catch (error) {
        if (error.ambiguous) {
            console.warn('🖥️ VM JOB: Cloud Run launch result unknown; deferring to reconciler', {
                correlationId,
                error: error.message,
            })
            await pendingRef
                .set(
                    { launchState: 'unknown', launchError: error.message, launchLastCheckedAt: Date.now() },
                    { merge: true }
                )
                .catch(() => {})
            return { outcome: 'ambiguous' }
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
        await pendingRef.update({ status: 'failed', error: error.message, failedAt: Date.now() }).catch(() => {})
        // Replace the initial VM status comment so it doesn't linger and contradict the failure.
        if (statusCommentId) {
            const failureText = "❌ Couldn't start the VM task — your Gold has been refunded."
            await admin
                .firestore()
                .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${statusCommentId}`)
                .set(
                    {
                        commentText: failureText,
                        originalContent: failureText,
                        lastChangeDate: Timestamp.now(),
                    },
                    { merge: true }
                )
                .catch(() => {})
        }
        // AT-2196: the job never ran, so nothing else will ever move its task. Hand it to the
        // requesting user (workflow step untouched) the same way a failed run does.
        await applyVmFailureWorkflowHold(
            admin.firestore(),
            { projectId, objectId, objectType, assistantId },
            { correlationId, reviewerId: requestUserId, failureReason: 'launch_failed' }
        ).catch(() => {})
        // Don't wedge the thread behind a job that never started: advance to the next queued job.
        await advanceThreadAndLaunchNext(projectId, objectId)
        return { outcome: 'failed' }
    }
}

/**
 * Advance the thread's FIFO queue and launch whatever comes next (if anything). Shared by the launch
 * failure paths, the reconciler, and the queued-job Gold short-circuit so the queue never wedges.
 */
async function advanceThreadAndLaunchNext(projectId, objectId) {
    try {
        const next = await advanceVmThreadQueue(vmThreadSessionRef(projectId, objectId))
        if (next) await launchQueuedVmJob(next)
    } catch (error) {
        console.warn('🖥️ VM JOB: advance-and-launch-next failed', { projectId, objectId, error: error.message })
    }
}

/**
 * Current Gold balance for a user (read-only). Fails open (returns Infinity) on a read error so a
 * transient failure never wrongly short-circuits a job — the in-run gold-exhausted path is the
 * backstop.
 */
async function readUserGoldBalance(userId) {
    try {
        const snap = await admin.firestore().doc(`users/${userId}`).get()
        return snap.exists ? Number(snap.data().gold) || 0 : 0
    } catch (error) {
        console.warn('🖥️ VM JOB: could not read Gold balance for queued launch; launching anyway', {
            userId,
            error: error.message,
        })
        return Number.POSITIVE_INFINITY
    }
}

/**
 * Settle a queued job that can't run because the user is out of Gold: refund the base reserve it
 * charged at dispatch (it never ran), finalize its status comment, and mark it failed. The caller
 * drains the rest of the queue (same user → cascades).
 */
async function settleQueuedVmJobInsufficientGold(pending) {
    const correlationId = pending.correlationId
    const { refundGold } = require('../Gold/goldHelper')
    await refundGold(pending.userId, Number(pending.goldCharged) || VM_JOB_BASE_GOLD, {
        source: VM_JOB_GOLD_REFUND_SOURCE,
        channel: 'assistant',
        projectId: pending.projectId,
        objectId: pending.objectId,
        objectType: pending.objectType,
        note: 'Queued VM task skipped — out of Gold',
    }).catch(() => {})
    await admin
        .firestore()
        .doc(`pendingWebhooks/${correlationId}`)
        .set(
            {
                status: 'failed',
                failureReason: VM_GOLD_EXHAUSTED_FAILURE_REASON,
                skippedForInsufficientGold: true,
                failedAt: Date.now(),
            },
            { merge: true }
        )
        .catch(() => {})
    if (pending.statusCommentId) {
        await admin
            .firestore()
            .doc(
                `chatComments/${pending.projectId}/${pending.objectType}/${pending.objectId}/comments/${pending.statusCommentId}`
            )
            .set(
                {
                    commentText: VM_QUEUED_GOLD_EXHAUSTED_TEXT,
                    originalContent: VM_QUEUED_GOLD_EXHAUSTED_TEXT,
                    isLoading: false,
                    assistantRun: {
                        kind: 'vm_job',
                        runId: correlationId,
                        requestUserId: pending.userId,
                        status: 'failed',
                    },
                    lastChangeDate: Timestamp.now(),
                },
                { merge: true }
            )
            .catch(() => {})
    }
    // AT-2196: this job failed without ever running, so nothing else will move its task. Hand it to
    // the requesting user (workflow step untouched) the same way a failed run does.
    await applyVmFailureWorkflowHold(admin.firestore(), pending, {
        correlationId,
        reviewerId: pending.userId,
        failureReason: VM_GOLD_EXHAUSTED_FAILURE_REASON,
    }).catch(() => {})
}

/**
 * Flip a queued job to 'pending' and launch its Cloud Run execution. Called by the runner's drain
 * when the current thread job finishes, and by the stalled-queue sweeper. No-op if the job already
 * settled (e.g. cancelled while queued).
 *
 * @returns {Promise<{success: boolean, reason?: string, outcome?: string}>}
 */
async function launchQueuedVmJob(correlationId) {
    const pendingRef = admin.firestore().doc(`pendingWebhooks/${correlationId}`)
    const snap = await pendingRef.get()
    if (!snap.exists) return { success: false, reason: 'not_found' }
    const pending = snap.data() || {}
    if (pending.kind !== 'vm_job') return { success: false, reason: 'wrong_kind' }
    if (['completed', 'failed', 'cancelled', 'cancel_requested'].includes(pending.status)) {
        return { success: false, reason: 'settled', status: pending.status }
    }
    // Gold short-circuit: if the user can no longer afford to make progress, don't launch a run that
    // would immediately hit gold-exhaustion. Settle this one (refund base) and drain the rest — the
    // whole queue is the same user, so it cascades. A top-up between jobs is respected (live read).
    const gold = await readUserGoldBalance(pending.userId)
    if (gold < VM_MIN_GOLD_TO_LAUNCH_QUEUED) {
        console.log('🖥️ VM JOB: skipping queued job — insufficient Gold', {
            correlationId,
            userId: pending.userId,
            gold,
        })
        await settleQueuedVmJobInsufficientGold(pending)
        await advanceThreadAndLaunchNext(pending.projectId, pending.objectId)
        return { success: false, reason: 'insufficient_gold' }
    }
    await pendingRef.set({ status: 'pending' }, { merge: true })
    const launch = await performVmCloudRunLaunch({
        correlationId,
        pendingRef,
        projectId: pending.projectId,
        objectType: pending.objectType,
        objectId: pending.objectId,
        requestUserId: pending.userId,
        statusCommentId: pending.statusCommentId,
        assistantId: pending.assistantId || null,
    })
    return { success: launch.outcome !== 'failed', outcome: launch.outcome }
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
                executionAttemptId: pending.executionAttemptId || '',
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
                            lastChangeDate: Timestamp.now(),
                        },
                        { merge: true }
                    )
                    .catch(() => {})
            }
            // AT-2196: same as any other job that never ran — the task goes to its requesting user.
            await applyVmFailureWorkflowHold(db, pending, {
                correlationId: pending.correlationId || doc.id,
                reviewerId: pending.userId,
                failureReason: 'launch_unconfirmed',
            }).catch(() => {})
            // Hand the thread to the next queued job so a follow-up isn't stuck behind a launch that
            // was never confirmed (its dispatch lease would otherwise have to expire first).
            await advanceThreadAndLaunchNext(pending.projectId, pending.objectId)
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
    launchQueuedVmJob,
    performVmCloudRunLaunch,
    countActiveVmJobsForUser,
    VM_JOB_BASE_GOLD,
    VM_GOLD_PER_MINUTE,
    VM_TOKENS_PER_GOLD,
    VM_JOB_GOLD_SOURCE,
    VM_JOB_GOLD_REFUND_SOURCE,
    VM_JOB_EXPIRY_MS,
    reconcileUnknownVmCloudRunLaunches,
    MAX_CONCURRENT_VM_JOBS_PER_USER,
    DEFAULT_VM_EXECUTION_MODE,
    VALID_VM_EXECUTION_MODES,
    VALID_TASK_TYPES,
    getAgentLabel,
    formatAgentModelLabel,
    formatAgentRunSuffix,
    formatVmBillingStatus,
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CLAUDE_EFFORT_LEVEL,
    DEFAULT_CODEX_REASONING_EFFORT,
    resolveAgentModelForRun,
    __private__: { packageContextObjects, normalizeAgentModel },
}
