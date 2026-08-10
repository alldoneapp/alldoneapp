const admin = require('firebase-admin')

const {
    APPROVAL_POLICY_LEVELS,
    DEFAULT_APPROVAL_POLICY_LEVEL,
    isValidApprovalPolicyLevel,
} = require('./vmAgentApprovalPolicy')

const VALID_VM_AGENTS = ['claude', 'codex']
const VALID_VM_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const SYSTEM_DEFAULT_VM_AGENT = 'codex'
const SYSTEM_DEFAULT_VM_REASONING_EFFORT = 'medium'
const VALID_VM_APPROVAL_POLICIES = APPROVAL_POLICY_LEVELS
const SYSTEM_DEFAULT_VM_APPROVAL_POLICY = DEFAULT_APPROVAL_POLICY_LEVEL

function isValidVmAgent(agent) {
    return VALID_VM_AGENTS.includes(agent)
}

function isValidVmReasoningEffort(effort) {
    return VALID_VM_REASONING_EFFORTS.includes(effort)
}

function isValidVmApprovalPolicy(policy) {
    return isValidApprovalPolicyLevel(policy)
}

async function readStoredVmAgentSettings(userId) {
    if (!userId)
        return {
            defaultAgent: null,
            defaultReasoningEffort: null,
            hasStoredReasoningEffort: false,
            defaultApprovalPolicy: null,
        }

    const snapshot = await admin.firestore().doc(`users/${userId}`).get()
    if (!snapshot.exists) {
        return {
            defaultAgent: null,
            defaultReasoningEffort: null,
            hasStoredReasoningEffort: false,
            defaultApprovalPolicy: null,
        }
    }

    const data = snapshot.data() || {}
    const hasReasoningEffortField = Object.prototype.hasOwnProperty.call(data, 'defaultVmAgentReasoningEffort')
    const hasStoredReasoningEffort =
        (hasReasoningEffortField &&
            (data.defaultVmAgentReasoningEffort === null ||
                isValidVmReasoningEffort(data.defaultVmAgentReasoningEffort))) ||
        (!hasReasoningEffortField &&
            Object.prototype.hasOwnProperty.call(data, 'defaultVmAgentReasoningEffortUpdatedAt'))
    return {
        defaultAgent: isValidVmAgent(data.defaultVmAgent) ? data.defaultVmAgent : null,
        defaultReasoningEffort: isValidVmReasoningEffort(data.defaultVmAgentReasoningEffort)
            ? data.defaultVmAgentReasoningEffort
            : null,
        hasStoredReasoningEffort,
        defaultApprovalPolicy: isValidVmApprovalPolicy(data.defaultVmApprovalPolicy)
            ? data.defaultVmApprovalPolicy
            : null,
    }
}

async function readStoredDefaultVmAgent(userId) {
    return (await readStoredVmAgentSettings(userId)).defaultAgent
}

async function getVmAgentSettings({ userId }) {
    if (!userId) {
        const { HttpsError } = require('firebase-functions/v2/https')
        throw new HttpsError('unauthenticated', 'Authentication required.')
    }

    const { defaultAgent, defaultReasoningEffort, hasStoredReasoningEffort, defaultApprovalPolicy } =
        await readStoredVmAgentSettings(userId)
    return {
        defaultAgent,
        effectiveDefaultAgent: defaultAgent || SYSTEM_DEFAULT_VM_AGENT,
        defaultReasoningEffort,
        effectiveDefaultReasoningEffort: hasStoredReasoningEffort
            ? defaultReasoningEffort
            : SYSTEM_DEFAULT_VM_REASONING_EFFORT,
        defaultApprovalPolicy,
        effectiveDefaultApprovalPolicy: defaultApprovalPolicy || SYSTEM_DEFAULT_VM_APPROVAL_POLICY,
        validAgents: VALID_VM_AGENTS,
        validReasoningEfforts: VALID_VM_REASONING_EFFORTS,
        validApprovalPolicies: VALID_VM_APPROVAL_POLICIES,
    }
}

async function setDefaultVmApprovalPolicy({ userId, policy }) {
    const { HttpsError } = require('firebase-functions/v2/https')
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!isValidVmApprovalPolicy(policy)) {
        throw new HttpsError('invalid-argument', `policy must be one of: ${VALID_VM_APPROVAL_POLICIES.join(', ')}.`)
    }

    const updatedAt = Date.now()
    await admin.firestore().doc(`users/${userId}`).update({
        defaultVmApprovalPolicy: policy,
        defaultVmApprovalPolicyUpdatedAt: updatedAt,
    })

    return { success: true, defaultApprovalPolicy: policy, effectiveDefaultApprovalPolicy: policy, updatedAt }
}

/**
 * Resolve the approval strictness for one VM run. An explicit per-run value wins, then the
 * requesting user's preference, then the system default. As with the agent defaults, a settings
 * read failure must never make VM execution unavailable - it degrades to the system default.
 */
async function resolveVmApprovalPolicy(userId, explicitPolicy) {
    if (isValidVmApprovalPolicy(explicitPolicy)) return explicitPolicy

    try {
        const stored = await readStoredVmAgentSettings(userId)
        return stored.defaultApprovalPolicy || SYSTEM_DEFAULT_VM_APPROVAL_POLICY
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed reading user VM approval policy, using system default', {
            userId,
            error: error.message,
        })
        return SYSTEM_DEFAULT_VM_APPROVAL_POLICY
    }
}

async function setDefaultVmAgentReasoningEffort({ userId, effort }) {
    const { HttpsError } = require('firebase-functions/v2/https')
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (effort !== null && !isValidVmReasoningEffort(effort)) {
        throw new HttpsError(
            'invalid-argument',
            `effort must be null or one of: ${VALID_VM_REASONING_EFFORTS.join(', ')}.`
        )
    }

    const updatedAt = Date.now()
    await admin.firestore().doc(`users/${userId}`).update({
        // Keep an explicit null so "No default" remains distinguishable from a user who
        // has never chosen an effort and should receive the system default.
        defaultVmAgentReasoningEffort: effort,
        defaultVmAgentReasoningEffortUpdatedAt: updatedAt,
    })

    return { success: true, defaultReasoningEffort: effort, updatedAt }
}

async function setDefaultVmAgent({ userId, agent }) {
    const { HttpsError } = require('firebase-functions/v2/https')
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!isValidVmAgent(agent)) {
        throw new HttpsError('invalid-argument', 'agent must be "claude" or "codex".')
    }

    const updatedAt = Date.now()
    await admin.firestore().doc(`users/${userId}`).update({
        defaultVmAgent: agent,
        defaultVmAgentUpdatedAt: updatedAt,
    })

    return { success: true, defaultAgent: agent, effectiveDefaultAgent: agent, updatedAt }
}

async function resolveVmAgent(userId, explicitAgent) {
    if (isValidVmAgent(explicitAgent)) return explicitAgent

    try {
        return (await readStoredDefaultVmAgent(userId)) || SYSTEM_DEFAULT_VM_AGENT
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed reading user default VM agent, using system default', {
            userId,
            error: error.message,
        })
        return SYSTEM_DEFAULT_VM_AGENT
    }
}

/**
 * Resolve both defaults at the authoritative launch boundary. Each valid explicit value wins;
 * omitted values use the requesting user's preference and then the system defaults.
 * A settings read failure must not make VM execution unavailable.
 */
async function resolveVmAgentSettings(userId, explicitAgent, explicitReasoningEffort) {
    const hasExplicitAgent = isValidVmAgent(explicitAgent)
    const hasExplicitReasoningEffort =
        typeof explicitReasoningEffort === 'string' && explicitReasoningEffort.trim() !== ''

    if (hasExplicitAgent && hasExplicitReasoningEffort) {
        return { agent: explicitAgent, reasoningEffort: explicitReasoningEffort }
    }

    try {
        const storedSettings = await readStoredVmAgentSettings(userId)
        return {
            agent: hasExplicitAgent ? explicitAgent : storedSettings.defaultAgent || SYSTEM_DEFAULT_VM_AGENT,
            reasoningEffort: hasExplicitReasoningEffort
                ? explicitReasoningEffort
                : storedSettings.hasStoredReasoningEffort
                  ? storedSettings.defaultReasoningEffort
                  : SYSTEM_DEFAULT_VM_REASONING_EFFORT,
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed reading user VM defaults, using system defaults', {
            userId,
            error: error.message,
        })
        return {
            agent: hasExplicitAgent ? explicitAgent : SYSTEM_DEFAULT_VM_AGENT,
            reasoningEffort: hasExplicitReasoningEffort ? explicitReasoningEffort : SYSTEM_DEFAULT_VM_REASONING_EFFORT,
        }
    }
}

module.exports = {
    VALID_VM_AGENTS,
    VALID_VM_REASONING_EFFORTS,
    VALID_VM_APPROVAL_POLICIES,
    SYSTEM_DEFAULT_VM_AGENT,
    SYSTEM_DEFAULT_VM_REASONING_EFFORT,
    SYSTEM_DEFAULT_VM_APPROVAL_POLICY,
    isValidVmAgent,
    isValidVmReasoningEffort,
    isValidVmApprovalPolicy,
    readStoredVmAgentSettings,
    readStoredDefaultVmAgent,
    getVmAgentSettings,
    setDefaultVmAgent,
    setDefaultVmAgentReasoningEffort,
    setDefaultVmApprovalPolicy,
    resolveVmAgent,
    resolveVmAgentSettings,
    resolveVmApprovalPolicy,
}
