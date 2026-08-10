/**
 * Guard against assistant-invented per-run VM overrides (AT-2224).
 *
 * `execute_task_in_vm` exposes `agent`, `agentModel`, `agentReasoningEffort` and `approvalPolicy`
 * as optional tool arguments, and `startVmJob` treats any explicit value as the highest-precedence
 * choice — above the user's saved Settings → Integrations defaults. That precedence is right when
 * the *user* asked for something specific ("do this one with Codex"), and wrong when the *model*
 * filled the argument in on its own, which it demonstrably does: production tool calls for workflow
 * steps carried `agent: 'codex'` and `approvalPolicy: 'balanced'` for a user whose saved defaults
 * were `claude` / `permissive`, with nothing in the request asking for either. The user experiences
 * that as "my default is ignored, sometimes" — sometimes, because it is a sampling decision.
 *
 * The fix is to require corroboration: an explicit override is honored only when the user's own
 * words asked for it. Evidence is deliberately restricted to *user-authored* text (their message,
 * the workflow step prompt). The tool arguments themselves — including `objective` and
 * `deliverable` — are model-authored and can never corroborate anything, or the guard would be
 * trivially self-satisfying.
 *
 * Failure is safe by construction: an override that cannot be corroborated is dropped, and the run
 * falls back to the user's saved preference (then the system default). The worst case is that a
 * genuine request phrased in a way this module does not recognise runs on the user's own default —
 * never on something they never chose.
 */

// Kept dependency-free on purpose: this is pure text matching, and requiring vmAgentSettings would
// drag firebase-admin in behind it. The value lists are re-checked against vmAgentSettings by
// vmRunOverrideGuard.test.js, so they cannot drift silently.
const VALID_VM_AGENTS = ['claude', 'codex']
const VALID_VM_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const VALID_VM_APPROVAL_POLICIES = ['strict', 'balanced', 'permissive']

// Only the last few user turns are considered. A preference stated much earlier in a long thread is
// not a standing instruction for every later VM run, and widening the window makes a stale "use
// codex" leak into unrelated work.
const MAX_EVIDENCE_MESSAGES = 6
const MAX_EVIDENCE_CHARS = 20000

// Naming an agent's model is naming the agent: "run it with opus" is a Claude request even though
// the word "claude" never appears.
// Naming an OpenRouter-only model names the Codex harness too (AT-2230): OpenRouter models run
// *through* Codex, so "do this one with deepseek" is as much an agent request as "use codex".
const AGENT_EVIDENCE_PATTERNS = {
    claude: [/\bclaude\b/, /\bopus\b/, /\bsonnet\b/, /\bhaiku\b/, /\bfable\b/, /\banthropic\b/],
    codex: [
        /\bcodex\b/,
        /\bopenai\b/,
        /\bgpt[-\s]?\d/,
        /\bopen\s?router\b/,
        /\bdeepseek\b/,
        /\bqwen\b/,
        /\bkimi\b/,
        /\bmoonshot\b/,
        /\bminimax\b/,
        /\bmistral\b/,
        /\bglm\b/,
    ],
}

// Bare Claude aliases that count as naming a model on their own. Anything else has to appear in
// full (e.g. "claude-opus-4-8", "gpt-5.6-sol") — a partial match on a fragment like "gpt" or "5"
// would let an incidental mention pin a model the user never asked for.
const BARE_MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable']

// "high" and "low" are ordinary English words, so a level alone is not evidence: it has to sit next
// to something that makes it a *reasoning effort* request.
const EFFORT_CONTEXT_PATTERN = /\b(effort|reasoning|thinking|think|thoroughness|thorough)\b/
// "xhigh" is jargon that only ever means this setting, so it stands alone.
const SELF_EVIDENT_EFFORTS = ['xhigh']

function textFromMessageContent(content) {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') return part
                if (part && typeof part.text === 'string') return part.text
                return ''
            })
            .join(' ')
    }
    if (content && typeof content.text === 'string') return content.text
    return ''
}

/**
 * Collect the user-authored text a VM override can be corroborated against.
 *
 * Accepts raw strings, `[role, content]` conversation entries (the shape `contextMessages` /
 * `conversationHistory` use) and `{ role, content }` objects. Assistant/system turns are dropped:
 * the assistant announcing "I'll run this with Codex" must not corroborate its own choice.
 */
function collectUserRequestText(...sources) {
    const parts = []

    const pushEntry = entry => {
        if (!entry) return
        if (typeof entry === 'string') {
            parts.push(entry)
            return
        }
        if (Array.isArray(entry)) {
            // [role, content] — anything that is not an explicit user turn is ignored.
            if (typeof entry[0] === 'string') {
                if (entry[0].toLowerCase() !== 'user') return
                parts.push(textFromMessageContent(entry[1]))
                return
            }
            entry.forEach(pushEntry)
            return
        }
        if (typeof entry === 'object') {
            if (typeof entry.role === 'string' && entry.role.toLowerCase() !== 'user') return
            parts.push(textFromMessageContent(entry.content !== undefined ? entry.content : entry.text))
        }
    }

    sources.forEach(source => {
        if (Array.isArray(source) && source.length && Array.isArray(source[0])) {
            // A conversation transcript: keep only the most recent user turns.
            source.slice(-MAX_EVIDENCE_MESSAGES * 4).forEach(pushEntry)
            return
        }
        pushEntry(source)
    })

    return parts
        .filter(part => typeof part === 'string' && part.trim())
        .slice(-MAX_EVIDENCE_MESSAGES)
        .join('\n')
        .slice(-MAX_EVIDENCE_CHARS)
}

function normalizeEvidence(requestText) {
    return typeof requestText === 'string' ? requestText.toLowerCase() : ''
}

function isAgentRequested(evidence, agent) {
    const patterns = AGENT_EVIDENCE_PATTERNS[agent]
    return !!patterns && patterns.some(pattern => pattern.test(evidence))
}

/**
 * Nobody types "openrouter:deepseek/deepseek-v3.2" — they type "use deepseek". So an OpenRouter
 * selection is corroborated by any of the tokens its id is built from (vendor, model name parts),
 * with the noise words that carry no choice in them ('chat', 'instruct', 'free', version numbers)
 * excluded, since matching those would let almost any sentence corroborate almost any model.
 */
const OPENROUTER_GENERIC_TOKENS = new Set([
    'chat',
    'instruct',
    'free',
    'preview',
    'exp',
    'experimental',
    'latest',
    'beta',
    'thinking',
    'reasoner',
    'coder',
    'max',
    'mini',
    'pro',
    'plus',
    'lite',
    'base',
    'it',
    'ai',
])

function openRouterEvidenceTokens(modelId) {
    return modelId
        .split(/[/:\-_.]/)
        .map(token => token.trim().toLowerCase())
        .filter(token => token.length >= 3 && !/^\d/.test(token) && !OPENROUTER_GENERIC_TOKENS.has(token))
}

function isModelRequested(evidence, agentModel) {
    const model = String(agentModel || '')
        .trim()
        .toLowerCase()
    if (!model) return false
    if (model.startsWith('openrouter:')) {
        if (/\bopen\s?router\b/.test(evidence)) return true
        const tokens = openRouterEvidenceTokens(model.slice('openrouter:'.length))
        return tokens.some(token => new RegExp(`\\b${token}\\b`).test(evidence))
    }
    if (BARE_MODEL_ALIASES.includes(model)) return new RegExp(`\\b${model}\\b`).test(evidence)
    return evidence.includes(model)
}

function isReasoningEffortRequested(evidence, effort) {
    const level = String(effort || '')
        .trim()
        .toLowerCase()
    if (!level) return false
    if (!new RegExp(`\\b${level}\\b`).test(evidence)) return false
    if (SELF_EVIDENT_EFFORTS.includes(level)) return true
    return EFFORT_CONTEXT_PATTERN.test(evidence)
}

function isApprovalPolicyRequested(evidence, policy) {
    const level = String(policy || '')
        .trim()
        .toLowerCase()
    if (!level) return false
    return new RegExp(`\\b${level}\\b`).test(evidence)
}

function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== ''
}

/**
 * Drop every per-run override the user's own words do not support.
 *
 * Returns the sanitized values (an ignored override becomes `undefined`, i.e. "not specified", so
 * the caller's existing default resolution applies unchanged) plus an `ignored` list for logging.
 *
 * An invalid value is passed through untouched so the caller's validation still produces its normal
 * error instead of the argument silently disappearing.
 */
function resolveVmRunOverrides({
    requestText = '',
    agent,
    agentModel,
    agentReasoningEffort,
    approvalPolicy,
    validAgents = VALID_VM_AGENTS,
    validReasoningEfforts = VALID_VM_REASONING_EFFORTS,
    validApprovalPolicies = VALID_VM_APPROVAL_POLICIES,
} = {}) {
    const evidence = normalizeEvidence(requestText)
    const ignored = []

    const keepIfCorroborated = (field, value, validValues, isRequested) => {
        if (!hasValue(value)) return undefined
        // Not a value we own the semantics of — let the caller validate and reject it.
        if (!validValues.includes(value)) return value
        if (isRequested(evidence, value)) return value
        ignored.push({ field, requested: value })
        return undefined
    }

    const resolvedAgent = keepIfCorroborated('agent', agent, validAgents, isAgentRequested)

    // A model is chosen *for* an agent. If the agent choice was invented and dropped, the model that
    // came with it cannot be applied to whatever the user's default turns out to be (a Codex model
    // id is not a valid Claude model), so it goes with it.
    const agentOverrideDropped = hasValue(agent) && resolvedAgent === undefined
    let resolvedAgentModel
    if (agentOverrideDropped && hasValue(agentModel)) {
        resolvedAgentModel = undefined
        ignored.push({ field: 'agentModel', requested: agentModel })
    } else if (hasValue(agentModel)) {
        if (isModelRequested(evidence, agentModel)) {
            resolvedAgentModel = agentModel
        } else {
            resolvedAgentModel = undefined
            ignored.push({ field: 'agentModel', requested: agentModel })
        }
    }

    const resolvedReasoningEffort = keepIfCorroborated(
        'agentReasoningEffort',
        agentReasoningEffort,
        validReasoningEfforts,
        isReasoningEffortRequested
    )
    const resolvedApprovalPolicy = keepIfCorroborated(
        'approvalPolicy',
        approvalPolicy,
        validApprovalPolicies,
        isApprovalPolicyRequested
    )

    return {
        agent: resolvedAgent,
        agentModel: resolvedAgentModel,
        agentReasoningEffort: resolvedReasoningEffort,
        approvalPolicy: resolvedApprovalPolicy,
        ignored,
    }
}

module.exports = {
    MAX_EVIDENCE_MESSAGES,
    VALID_VM_AGENTS,
    VALID_VM_REASONING_EFFORTS,
    VALID_VM_APPROVAL_POLICIES,
    collectUserRequestText,
    resolveVmRunOverrides,
    isAgentRequested,
    isModelRequested,
    isReasoningEffortRequested,
    isApprovalPolicyRequested,
}
