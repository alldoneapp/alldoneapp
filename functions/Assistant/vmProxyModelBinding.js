// Binds a platform-billed VM proxy request to what the job was priced for.
//
// security audit 2026-11 (vmLlmProxy:token-not-bound-to-job-priced-model): the per-job proxy token
// sits in the sandbox environment, where anything the user has the agent run can read it. The proxy
// used to forward whatever model and endpoint the sandbox named, on the PLATFORM key, and bill the
// returned usage at the rate frozen for the job's launch model. A job launched on a cheap model
// could therefore buy Opus/o-series tokens at the cheap rate, or reach upstream endpoints that
// report no token usage at all (batches, files, images, fine-tuning) for free.
//
// Two invariants, applied to platform-billed (credentialMode 'api') requests only — a BYOK request
// spends the user's own key and is not billed in tokens:
//   1. Only the agent's inference endpoints are forwarded (PROXY_ALLOWED_ENDPOINTS).
//   2. Every request is billed at the job's rate OR the requested model's rate, whichever is more
//      expensive. A request for the job's own model is billed exactly as before. A model we cannot
//      price at all is refused, never forwarded at a guessed rate.
// The extra cost is carried as `premiumTokens`: job-rate-equivalent tokens on top of the real
// count, so the cumulative charge `round((tokens + premium) / jobRate)` stays one formula.

const { parseOpenRouterSelection } = require('./vmModelRouting')
const {
    BASE_VM_TOKENS_PER_GOLD,
    CLAUDE_REFERENCE_PRICES,
    CODEX_REFERENCE_PRICES,
    resolveUpstreamPrice,
    resolveConservativeNativeRate,
    deriveTokensPerGold,
    resolveEffectiveTokensPerGold,
} = require('./vmTokenPricing')

const MODELS_LIST = /^\/v1\/models(?:\/[A-Za-z0-9._:/-]+)?$/

// The upstream paths the Claude Code and Codex CLIs use for inference (forwardPath, query excluded).
const PROXY_ALLOWED_ENDPOINTS = Object.freeze({
    anthropic: Object.freeze({
        POST: [/^\/v1\/messages$/, /^\/v1\/messages\/count_tokens$/],
        GET: [MODELS_LIST],
    }),
    openai: Object.freeze({
        POST: [/^\/v1\/responses$/, /^\/v1\/responses\/compact$/, /^\/v1\/chat\/completions$/],
        GET: [MODELS_LIST],
    }),
    openrouter: Object.freeze({
        POST: [/^\/v1\/responses$/, /^\/v1\/chat\/completions$/],
        GET: [MODELS_LIST],
    }),
})

function isAllowedProxyEndpoint(provider, method, forwardPath) {
    const rules = PROXY_ALLOWED_ENDPOINTS[provider]
    if (!rules) return false
    const patterns = rules[String(method || '').toUpperCase()] || []
    return patterns.some(pattern => pattern.test(String(forwardPath || '')))
}

/** The `model` a JSON request body names, or '' when there is none (GET, non-JSON body). */
function readRequestedModel(rawBody) {
    if (!rawBody) return ''
    try {
        const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)
        const payload = JSON.parse(text)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
        return typeof payload.model === 'string' ? payload.model.trim() : ''
    } catch (_) {
        return ''
    }
}

const CLAUDE_ALIASES = Object.keys(CLAUDE_REFERENCE_PRICES)
const CODEX_FAMILY_PATTERN = /^gpt-\d+(?:\.\d+)?-([a-z][a-z0-9]*)$/
const CODEX_AUXILIARY_PATTERN = /^codex-[a-z0-9.-]+$/

// The most expensive known Codex rate (lowest tokens per Gold).
function conservativeCodexRate() {
    const rates = Object.values(CODEX_REFERENCE_PRICES)
        .map(price => deriveTokensPerGold(price, BASE_VM_TOKENS_PER_GOLD))
        .filter(rate => rate !== null)
    return rates.length ? Math.min(...rates) : null
}

// The model id the CLI sends for this job, lower-cased: the bare OpenRouter id for an OpenRouter
// selection, the stored value otherwise.
function jobRequestModel(agentModel) {
    if (typeof agentModel !== 'string') return ''
    const openRouterModel = parseOpenRouterSelection(agentModel)
    return (openRouterModel || agentModel).trim().toLowerCase()
}

/**
 * Tokens-per-Gold for one proxied request, or { allowed: false } for a model we cannot price.
 *
 * `getOpenRouterPrice(modelId)` is the live catalog lookup (async, may return null); injected so
 * the rule is testable without Firestore.
 */
async function resolveProxyRequestRate({ jobState = {}, provider, requestedModel, getOpenRouterPrice = null }) {
    const jobRate = resolveEffectiveTokensPerGold(jobState)
    const model = typeof requestedModel === 'string' ? requestedModel.trim().toLowerCase() : ''
    // No model in the body (GET /v1/models, an empty or non-JSON body): nothing to price differently;
    // an inference request without a model is rejected by the upstream itself.
    if (!model) return { allowed: true, jobRate, requestRate: jobRate, reason: 'no_model' }

    const jobModel = jobRequestModel(jobState.agentModel)
    if (jobModel && model === jobModel) return { allowed: true, jobRate, requestRate: jobRate, reason: 'job_model' }

    // A Claude alias job ('opus') sends the concrete release ('claude-opus-5-5'); the job rate was
    // priced from the release behind the alias at launch.
    const aliasJob = CLAUDE_ALIASES.includes(jobModel)

    const selection = provider === 'openrouter' ? `openrouter:${model}` : model
    let upstreamPrice = null
    if (provider === 'openrouter' && typeof getOpenRouterPrice === 'function') {
        try {
            upstreamPrice = await getOpenRouterPrice(model)
        } catch (_) {
            upstreamPrice = null
        }
    }
    const price = resolveUpstreamPrice(selection, { upstreamPrice })
    let requestRate = deriveTokensPerGold(price, BASE_VM_TOKENS_PER_GOLD)
    let reason = 'priced_model'

    if (requestRate === null && provider === 'anthropic' && aliasJob && model.startsWith(`claude-${jobModel}-`)) {
        return { allowed: true, jobRate, requestRate: jobRate, reason: 'job_alias_release' }
    }
    if (requestRate === null && provider === 'anthropic' && model.startsWith('claude-')) {
        requestRate = resolveConservativeNativeRate(model, BASE_VM_TOKENS_PER_GOLD)
        reason = 'conservative_claude'
    }
    if (requestRate === null && provider === 'openai') {
        const family = CODEX_FAMILY_PATTERN.exec(model)
        // Unpriced GPT tiers (and Codex's own auxiliary models, e.g. its approval reviewer) bill at
        // the most expensive known Codex rate. `pro` tiers cost several times that, so they are
        // refused rather than under-billed.
        if ((family && family[1] !== 'pro') || CODEX_AUXILIARY_PATTERN.test(model)) {
            requestRate = conservativeCodexRate()
            reason = 'conservative_codex'
        }
    }
    if (!Number.isFinite(requestRate) || requestRate <= 0) {
        return { allowed: false, jobRate, requestRate: null, reason: 'unpriced_model' }
    }
    // Never cheaper than the job: an auxiliary request for a cheaper model keeps the job's rate,
    // exactly as every request was billed before.
    return { allowed: true, jobRate, requestRate: Math.min(jobRate, requestRate), reason }
}

/** Job-rate-equivalent tokens to add on top of `totalTokens` billed at `requestRate`. */
function calculatePremiumTokens(totalTokens, jobRate, requestRate) {
    const tokens = Number(totalTokens)
    const job = Number(jobRate)
    const request = Number(requestRate)
    if (!Number.isFinite(tokens) || tokens <= 0) return 0
    if (!Number.isFinite(job) || job <= 0 || !Number.isFinite(request) || request <= 0) return 0
    if (request >= job) return 0
    return tokens * (job / request - 1)
}

module.exports = {
    PROXY_ALLOWED_ENDPOINTS,
    isAllowedProxyEndpoint,
    readRequestedModel,
    resolveProxyRequestRate,
    calculatePremiumTokens,
}
