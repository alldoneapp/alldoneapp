const admin = require('firebase-admin')

const VALID_VM_AGENTS = ['claude', 'codex']
const SYSTEM_DEFAULT_VM_AGENT = 'claude'

function isValidVmAgent(agent) {
    return VALID_VM_AGENTS.includes(agent)
}

async function readStoredDefaultVmAgent(userId) {
    if (!userId) return null

    const snapshot = await admin.firestore().doc(`users/${userId}`).get()
    if (!snapshot.exists) return null

    const storedAgent = snapshot.data()?.defaultVmAgent
    return isValidVmAgent(storedAgent) ? storedAgent : null
}

async function getVmAgentSettings({ userId }) {
    if (!userId) {
        const { HttpsError } = require('firebase-functions/v2/https')
        throw new HttpsError('unauthenticated', 'Authentication required.')
    }

    const defaultAgent = await readStoredDefaultVmAgent(userId)
    return {
        defaultAgent,
        effectiveDefaultAgent: defaultAgent || SYSTEM_DEFAULT_VM_AGENT,
        validAgents: VALID_VM_AGENTS,
    }
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

/**
 * Resolve the VM agent at the authoritative launch boundary. A valid agent supplied by the
 * caller always wins; otherwise use the requesting user's preference and finally the historic
 * system default. A settings read failure must not make VM execution unavailable.
 */
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

module.exports = {
    VALID_VM_AGENTS,
    SYSTEM_DEFAULT_VM_AGENT,
    isValidVmAgent,
    readStoredDefaultVmAgent,
    getVmAgentSettings,
    setDefaultVmAgent,
    resolveVmAgent,
}
