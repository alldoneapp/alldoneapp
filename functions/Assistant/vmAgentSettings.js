const admin = require('firebase-admin')

const {
    APPROVAL_POLICY_LEVELS,
    DEFAULT_APPROVAL_POLICY_LEVEL,
    isValidApprovalPolicyLevel,
} = require('./vmAgentApprovalPolicy')

const { isValidFamilyId, isValidModelSelection, OPENROUTER_PROVIDER } = require('./vmAgentModelCatalog')
const { isOpenRouterSelection } = require('./vmModelRouting')

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

/**
 * Per-agent default model families (AT-2221), stored as a map so switching the agent toggle
 * in Settings does not discard the other agent's choice:
 *   users/{uid}.defaultVmAgentModel = { claude: 'sonnet', codex: 'terra' }
 * A family id is stored, never a concrete version — see vmAgentModelCatalog.js for why.
 *
 * Since AT-2230 the codex slot may instead hold an OpenRouter model selection
 * ('openrouter:deepseek/deepseek-chat'). It shares this slot rather than getting its own field
 * because it answers the same question — "which model does Codex run?" — and two fields would
 * allow a state where both are set and neither obviously wins.
 */
function readStoredModelFamilies(data) {
    const stored = data && typeof data.defaultVmAgentModel === 'object' ? data.defaultVmAgentModel : null
    const families = {}
    for (const agent of VALID_VM_AGENTS) {
        const value = stored ? stored[agent] : null
        // An OpenRouter selection is only meaningful for Codex; Claude cannot run one, so a value
        // that somehow landed in the claude slot is read as "no preference" rather than honoured.
        const valid = agent === 'codex' ? isValidModelSelection(value) : isValidFamilyId(value)
        families[agent] = valid ? value : null
    }
    return families
}

async function readStoredVmAgentSettings(userId) {
    if (!userId)
        return {
            defaultAgent: null,
            defaultReasoningEffort: null,
            hasStoredReasoningEffort: false,
            defaultApprovalPolicy: null,
            defaultModelFamilies: readStoredModelFamilies(null),
        }

    const snapshot = await admin.firestore().doc(`users/${userId}`).get()
    if (!snapshot.exists) {
        return {
            defaultAgent: null,
            defaultReasoningEffort: null,
            hasStoredReasoningEffort: false,
            defaultApprovalPolicy: null,
            defaultModelFamilies: readStoredModelFamilies(null),
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
        defaultModelFamilies: readStoredModelFamilies(data),
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

    const {
        defaultAgent,
        defaultReasoningEffort,
        hasStoredReasoningEffort,
        defaultApprovalPolicy,
        defaultModelFamilies,
    } = await readStoredVmAgentSettings(userId)

    // Model families ride along on the same call so the Settings screen loads in one round trip.
    // getAllModelCatalogs never throws (it degrades to cached/static), but belt-and-braces here:
    // a catalog problem must not take down the agent/effort/policy settings the UI also needs.
    let modelCatalogs
    try {
        modelCatalogs = await require('./vmAgentModelCatalog').getAllModelCatalogs()
    } catch (error) {
        console.warn('🖥️ VM MODELS: Falling back to static catalogs for settings', { error: error.message })
        const { FALLBACK_CATALOGS } = require('./vmAgentModelCatalog')
        modelCatalogs = {
            claude: { ...FALLBACK_CATALOGS.claude, fetchedAt: 0, source: 'fallback' },
            codex: { ...FALLBACK_CATALOGS.codex, fetchedAt: 0, source: 'fallback' },
            [OPENROUTER_PROVIDER]: {
                ...FALLBACK_CATALOGS[OPENROUTER_PROVIDER],
                fetchedAt: 0,
                source: 'fallback',
                // Unknown at this point (the throw came from the catalog module itself). Treat the
                // source as unavailable so the UI does not offer a model the run may not reach.
                available: false,
            },
        }
    }

    return {
        defaultAgent,
        defaultModelFamilies,
        modelCatalogs,
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

/**
 * Persist (or clear) the default model family for ONE agent, leaving the other agent's choice
 * untouched — the whole point of storing a per-agent map. `family: null` means "no default",
 * which falls back to the agent's built-in default model at run time.
 *
 * The family is validated against the live catalog so a typo or a stale client cannot pin a
 * user to a family the provider does not offer. If the catalog is degraded we accept any
 * well-formed id rather than blocking the save on a provider outage.
 */
async function setDefaultVmAgentModel({ userId, agent, family }) {
    const { HttpsError } = require('firebase-functions/v2/https')
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!isValidVmAgent(agent)) {
        throw new HttpsError('invalid-argument', 'agent must be "claude" or "codex".')
    }
    if (family !== null && !isValidModelSelection(family)) {
        throw new HttpsError('invalid-argument', 'family must be null or a valid model family id.')
    }

    // OpenRouter is a source for the Codex harness only — Claude Code cannot be pointed at it.
    // Reject the pairing here rather than storing a preference that would be dropped at run time.
    const openRouterSelected = isOpenRouterSelection(family)
    if (openRouterSelected && agent !== 'codex') {
        throw new HttpsError('invalid-argument', 'OpenRouter models are only available for the Codex agent.')
    }

    if (family !== null) {
        const { getModelCatalog } = require('./vmAgentModelCatalog')
        const catalogProvider = openRouterSelected ? OPENROUTER_PROVIDER : agent
        let catalog = null
        try {
            catalog = await getModelCatalog(catalogProvider)
        } catch (error) {
            console.warn('🖥️ VM MODELS: Could not verify family on save', { agent, family, error: error.message })
        }
        if (catalog && catalog.source !== 'fallback' && !catalog.families.some(entry => entry.id === family)) {
            throw new HttpsError('invalid-argument', `"${family}" is not an available ${agent} model family.`)
        }
        if (openRouterSelected && catalog && catalog.available === false) {
            throw new HttpsError('failed-precondition', 'OpenRouter is not configured for this environment.')
        }
    }

    const updatedAt = Date.now()
    await admin
        .firestore()
        .doc(`users/${userId}`)
        .update({
            // Dotted path so the other agent's saved family is preserved.
            [`defaultVmAgentModel.${agent}`]: family,
            defaultVmAgentModelUpdatedAt: updatedAt,
        })

    return { success: true, agent, family, updatedAt }
}

/**
 * The saved family for one agent, or null. Read failures degrade to "no preference" so a
 * Firestore hiccup can never make a VM run unavailable.
 */
async function resolveVmAgentModelFamily(userId, agent) {
    if (!isValidVmAgent(agent) || !userId) return null
    try {
        const stored = await readStoredVmAgentSettings(userId)
        return stored.defaultModelFamilies[agent] || null
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed reading user default VM model, using agent default', {
            userId,
            error: error.message,
        })
        return null
    }
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
    setDefaultVmAgentModel,
    setDefaultVmApprovalPolicy,
    resolveVmAgent,
    resolveVmAgentModelFamily,
    resolveVmAgentSettings,
    resolveVmApprovalPolicy,
}
