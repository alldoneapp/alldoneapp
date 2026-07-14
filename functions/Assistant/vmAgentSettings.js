const admin = require('firebase-admin')

const VALID_VM_AGENTS = ['claude', 'codex']
const VALID_VM_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const SYSTEM_DEFAULT_VM_AGENT = 'claude'

function isValidVmAgent(agent) {
    return VALID_VM_AGENTS.includes(agent)
}

function isValidVmReasoningEffort(effort) {
    return VALID_VM_REASONING_EFFORTS.includes(effort)
}

async function readStoredVmAgentSettings(userId) {
    if (!userId) return { defaultAgent: null, defaultReasoningEffort: null }

    const snapshot = await admin.firestore().doc(`users/${userId}`).get()
    if (!snapshot.exists) return { defaultAgent: null, defaultReasoningEffort: null }

    const data = snapshot.data() || {}
    return {
        defaultAgent: isValidVmAgent(data.defaultVmAgent) ? data.defaultVmAgent : null,
        defaultReasoningEffort: isValidVmReasoningEffort(data.defaultVmAgentReasoningEffort)
            ? data.defaultVmAgentReasoningEffort
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

    const { defaultAgent, defaultReasoningEffort } = await readStoredVmAgentSettings(userId)
    return {
        defaultAgent,
        effectiveDefaultAgent: defaultAgent || SYSTEM_DEFAULT_VM_AGENT,
        defaultReasoningEffort,
        validAgents: VALID_VM_AGENTS,
        validReasoningEfforts: VALID_VM_REASONING_EFFORTS,
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
    await admin
        .firestore()
        .doc(`users/${userId}`)
        .update({
            defaultVmAgentReasoningEffort: effort === null ? admin.firestore.FieldValue.delete() : effort,
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
 * omitted values use the requesting user's preference and then the historic provider fallback.
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
                : storedSettings.defaultReasoningEffort,
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed reading user VM defaults, using provider defaults', {
            userId,
            error: error.message,
        })
        return {
            agent: hasExplicitAgent ? explicitAgent : SYSTEM_DEFAULT_VM_AGENT,
            reasoningEffort: hasExplicitReasoningEffort ? explicitReasoningEffort : null,
        }
    }
}

module.exports = {
    VALID_VM_AGENTS,
    VALID_VM_REASONING_EFFORTS,
    SYSTEM_DEFAULT_VM_AGENT,
    isValidVmAgent,
    isValidVmReasoningEffort,
    readStoredVmAgentSettings,
    readStoredDefaultVmAgent,
    getVmAgentSettings,
    setDefaultVmAgent,
    setDefaultVmAgentReasoningEffort,
    resolveVmAgent,
    resolveVmAgentSettings,
}
