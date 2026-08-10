/**
 * Model routing for the Codex VM harness (AT-2230).
 *
 * Codex speaks a plain OpenAI-compatible wire protocol, so it can drive any OpenRouter model that
 * supports tool calling — the latest DeepSeek releases among them. The user therefore picks a
 * *source* (OpenAI or OpenRouter) alongside the model, and everything downstream has to know which
 * upstream a run belongs to: the sandbox provider config, the proxy route, and the status text.
 *
 * Rather than adding a parallel `modelSource` field to every layer (tool argument, Firestore job
 * doc, settings map, run details, bridge input — each an independent chance to drift out of sync
 * with `agentModel`), the source is encoded *into* the model string with an `openrouter:` prefix:
 *
 *     'gpt-5.6-sol'                    → OpenAI, model id 'gpt-5.6-sol'
 *     'openrouter:deepseek/deepseek-v3.2' → OpenRouter, model id 'deepseek/deepseek-v3.2'
 *
 * One value travels end to end, an old job doc without a prefix keeps meaning exactly what it meant
 * before, and there is no state in which the source and the model can disagree.
 *
 * Kept dependency-free so both the Cloud Functions runtime and the Cloud Run runner image can
 * require it without pulling firebase-admin in behind it.
 */

const OPENROUTER_PREFIX = 'openrouter:'

/**
 * OpenRouter ids are `vendor/model` with an optional `:variant` suffix ('deepseek/deepseek-r1:free').
 * Deliberately strict: this string is interpolated into a shell command and into a TOML config
 * value, so it may only ever contain characters that are inert in both. Call sites additionally
 * shell-quote it — this pattern is the guarantee, the quoting is the belt.
 */
const OPENROUTER_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/i

const OPENROUTER_LABEL = 'OpenRouter'

function isValidOpenRouterModelId(modelId) {
    return typeof modelId === 'string' && modelId.length <= 128 && OPENROUTER_MODEL_PATTERN.test(modelId)
}

/** True for a stored/selected value that names an OpenRouter model. */
function isOpenRouterSelection(value) {
    return typeof value === 'string' && value.startsWith(OPENROUTER_PREFIX)
}

/** `deepseek/deepseek-v3.2` → `openrouter:deepseek/deepseek-v3.2`. Returns null for a bad id. */
function toOpenRouterSelection(modelId) {
    const trimmed = typeof modelId === 'string' ? modelId.trim() : ''
    if (!isValidOpenRouterModelId(trimmed)) return null
    return `${OPENROUTER_PREFIX}${trimmed}`
}

/**
 * The bare provider model id inside a selection, or null when the value is not a *valid* OpenRouter
 * selection. A malformed suffix returns null rather than the raw text, so a caller can never hand
 * an unvalidated string to the CLI.
 */
function parseOpenRouterSelection(value) {
    if (!isOpenRouterSelection(value)) return null
    const modelId = value.slice(OPENROUTER_PREFIX.length).trim()
    return isValidOpenRouterModelId(modelId) ? modelId : null
}

/**
 * The single question every runtime call site actually asks: which upstream, and what exact string
 * goes on the command line?
 *
 * `model` is always the id the CLI expects (prefix stripped for OpenRouter), so no caller has to
 * remember to strip it. `source` is 'openrouter' only for a valid OpenRouter selection — an
 * unparseable one falls back to 'openai', which is the pre-AT-2230 behaviour and simply routes to
 * the platform's OpenAI upstream instead of failing the run.
 */
function resolveModelRoute(agent, agentModel) {
    const raw = typeof agentModel === 'string' ? agentModel.trim() : ''
    if (agent === 'codex') {
        const openRouterModel = parseOpenRouterSelection(raw)
        if (openRouterModel) return { source: 'openrouter', model: openRouterModel, selection: raw }
        return { source: 'openai', model: raw, selection: raw }
    }
    return { source: 'anthropic', model: raw, selection: raw }
}

function isOpenRouterRun(agent, agentModel) {
    return resolveModelRoute(agent, agentModel).source === 'openrouter'
}

/**
 * Which *credential* slot a run authenticates with (AT-2230 BYOK).
 *
 * Deliberately NOT the same thing as the agent. BYOK/subscription credentials are stored per
 * upstream provider, and an OpenRouter run drives the Codex harness against a completely different
 * upstream: the user's OpenAI key or ChatGPT subscription cannot authenticate against OpenRouter,
 * and their OpenRouter key cannot authenticate against OpenAI. Keying credentials on the agent
 * would therefore spend the wrong key — a Codex-BYOK job would reach for the OpenAI key on the
 * OpenRouter route and vice versa.
 *
 * Derived from `agent` + `agentModel`, both of which are already validated and persisted on the
 * job, so the answer is reproducible from job state alone and cannot drift from the model actually
 * being run. `resolveJobCredentialProvider` prefers the explicitly persisted value and falls back
 * to this derivation for a job doc written before the field existed.
 */
const CREDENTIAL_PROVIDERS = ['claude', 'codex', 'openrouter']

function resolveCredentialProvider(agent, agentModel) {
    const source = resolveModelRoute(agent, agentModel).source
    if (source === 'openrouter') return 'openrouter'
    return agent === 'codex' ? 'codex' : 'claude'
}

function resolveJobCredentialProvider(jobData = {}) {
    const persisted = jobData && jobData.credentialProvider
    if (CREDENTIAL_PROVIDERS.includes(persisted)) return persisted
    return resolveCredentialProvider(jobData.agent || 'claude', jobData.agentModel || '')
}

/** Only OpenAI/Anthropic sell the consumer plans the subscription route consumes. */
function providerSupportsSubscription(provider) {
    return provider === 'claude' || provider === 'codex'
}

/**
 * Human label for an OpenRouter id: 'deepseek/deepseek-v3.2' → 'DeepSeek V3.2 (OpenRouter)'.
 * Used for status text, where the discovered catalog label is not available synchronously.
 */
const VENDOR_DISPLAY_NAMES = {
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    moonshotai: 'Moonshot',
    'z-ai': 'Z.AI',
    mistralai: 'Mistral',
    meta: 'Meta',
    'meta-llama': 'Meta Llama',
    xai: 'xAI',
    google: 'Google',
    minimax: 'MiniMax',
    nvidia: 'NVIDIA',
    microsoft: 'Microsoft',
    cohere: 'Cohere',
    amazon: 'Amazon',
    inception: 'Inception',
}

// Capitalising the first character is right for both words ('chat' → 'Chat') and version tokens
// ('r1' → 'R1', 'v3.2' → 'V3.2'), and is a no-op on a numeric one ('4.6', '2507').
function titleCaseSegment(segment) {
    if (!segment) return ''
    return segment.charAt(0).toUpperCase() + segment.slice(1)
}

function formatOpenRouterModelLabel(modelId) {
    if (typeof modelId !== 'string' || !modelId) return ''
    const [vendorPart, ...rest] = modelId.split('/')
    const namePart = rest.join('/') || vendorPart
    const [name, variant] = namePart.split(':')
    const vendor = VENDOR_DISPLAY_NAMES[vendorPart.toLowerCase()] || titleCaseSegment(vendorPart)

    let readableName = name.split('-').map(titleCaseSegment).join(' ').trim()
    // 'deepseek/deepseek-v3.2' reads as "DeepSeek V3.2", not "DeepSeek Deepseek V3.2".
    const vendorToken = vendor.toLowerCase().replace(/[^a-z0-9]/g, '')
    const firstToken = readableName
        .split(' ')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    if (vendorToken && firstToken === vendorToken) {
        readableName = readableName.split(' ').slice(1).join(' ').trim()
    }

    const parts = [vendor, readableName].filter(Boolean).join(' ').trim()
    return `${parts}${variant ? ` (${variant})` : ''}`
}

module.exports = {
    OPENROUTER_PREFIX,
    OPENROUTER_LABEL,
    OPENROUTER_MODEL_PATTERN,
    isValidOpenRouterModelId,
    isOpenRouterSelection,
    toOpenRouterSelection,
    parseOpenRouterSelection,
    resolveModelRoute,
    isOpenRouterRun,
    formatOpenRouterModelLabel,
    CREDENTIAL_PROVIDERS,
    resolveCredentialProvider,
    resolveJobCredentialProvider,
    providerSupportsSubscription,
}
