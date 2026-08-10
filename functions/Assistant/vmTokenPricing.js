/**
 * Token → Gold pricing for VM runs (AT-2230).
 *
 * A VM run's Gold cost is hybrid: a fixed base reserve, a per-started-minute compute charge, and a
 * per-token LLM charge. This module owns the *last* of those three — the token rate — and is the
 * single place that decides how many tokens buy one Gold for a given model selection.
 *
 * Why it exists as its own module: the token charge is applied in TWO places that must agree
 * exactly, or the user is billed twice (or not at all) for the same tokens:
 *
 *   1. `vmLlmProxy.chargeProxyTokenGold` — charges *incrementally* while the run streams, against
 *      the run's cumulative token total.
 *   2. `vmJobRunner.calculateCompletionGoldCharges` — settles the remainder at completion as
 *      `round(totalTokens / rate) - alreadyChargedByProxy`.
 *
 * Before this module the rate was a `const VM_TOKENS_PER_GOLD = 100` duplicated in vmJob.js and
 * vmLlmProxy.js. Two copies of a number that must never differ is exactly the shape of bug that
 * silently mis-bills: if the settlement rate were larger than the proxy rate, the subtraction
 * clamps at zero and the overcharge is invisible; if smaller, the user is charged twice. Both
 * call sites now import the rate from here and resolve it from the same input, so they cannot drift.
 *
 * ## The DeepSeek discount
 *
 * DeepSeek through OpenRouter is dramatically cheaper upstream than the OpenAI Codex tiers, and the
 * product decision is to pass that through: a DeepSeek run costs **1/5 of what the same token count
 * costs on Luna** (Luna being the cheapest OpenAI Codex tier and, like every other model, priced at
 * the standard rate). "Five times cheaper in Gold" is implemented as "five times as many tokens per
 * Gold" — the divisor is scaled, not the base rate — so the relationship survives any future change
 * to `BASE_VM_TOKENS_PER_GOLD`. That invariant is what `vmTokenPricing.test.js` pins.
 *
 * ## What is deliberately NOT discounted
 *
 * - Every other OpenRouter vendor (Qwen, Moonshot, Mistral, …) stays at the standard rate. They are
 *   cheap upstream too, but each needs its own pricing decision; a blanket "OpenRouter is cheaper"
 *   rule would quietly under-bill a model that is not.
 * - The base reserve and the per-minute compute charge. Those pay for the E2B sandbox, whose cost
 *   is identical whichever model the agent talks to.
 * - Subscription / BYOK runs, which are already token-exempt upstream of this module.
 *
 * Keyed purely on the model *selection string*, with no `agent` argument, because this branch's
 * core design decision is that the source is encoded into that string (`openrouter:vendor/model`).
 * A selection is self-identifying, so pricing needs no second field that could disagree with it.
 *
 * Dependency-free apart from `vmModelRouting`, so the Cloud Functions runtime, the Cloud Run runner
 * image and the proxy can all require it without pulling firebase-admin in behind it.
 */

const { parseOpenRouterSelection } = require('./vmModelRouting')

/**
 * The standard rate: 100 tokens buy 1 Gold. Matches in-app assistant usage
 * (`assistantHelper.getTokensPerGold`) and the WhatsApp call metering, and applies to every Claude
 * model, every OpenAI Codex tier (Sol, Terra, Luna) and every non-discounted OpenRouter model.
 */
const BASE_VM_TOKENS_PER_GOLD = 100

/**
 * How much cheaper a discounted vendor is, expressed as a Gold-cost divisor. 5 means "a DeepSeek run
 * costs a fifth of what the identical token count costs on Luna".
 */
const DEEPSEEK_GOLD_DISCOUNT_FACTOR = 5

/**
 * Per-vendor Gold discounts for OpenRouter models, keyed by the vendor segment of the model id
 * (`deepseek/deepseek-v3.2` → `deepseek`). Anything absent from this map is charged the standard
 * rate — the safe default, since an unpriced model must never be cheaper by accident.
 *
 * Deliberately vendor-scoped rather than a per-model list: DeepSeek ships new ids continuously
 * (`deepseek-chat`, `deepseek-v3.2`, `deepseek-r1:free`, …) and a model list would silently drop a
 * new release back to full price the day it appears. It also means a DeepSeek *derivative*
 * published by another vendor (`tngtech/deepseek-r1t-chimera`) is NOT discounted, which is correct:
 * we only know the upstream economics of the vendor's own hosting.
 */
const OPENROUTER_VENDOR_GOLD_DISCOUNTS = Object.freeze({
    deepseek: DEEPSEEK_GOLD_DISCOUNT_FACTOR,
})

/** The vendor segment of an OpenRouter model id, lowercased. `null` when the id is not parseable. */
function getOpenRouterVendor(modelId) {
    if (typeof modelId !== 'string') return null
    const vendor = modelId.split('/')[0]
    return vendor ? vendor.toLowerCase() : null
}

/**
 * The Gold discount factor for a model selection: 1 for full price, 5 for DeepSeek via OpenRouter.
 *
 * Always returns a finite number >= 1. A factor below 1 would *raise* the price and a
 * zero/NaN/Infinite one would make the divisor unusable (`tokens / 0` → Infinity Gold charged,
 * `tokens / NaN` → NaN, which Firestore would reject or, worse, coerce). The clamp means a
 * mis-configured entry in the map degrades to full price rather than to a billing incident.
 */
function resolveTokenGoldDiscountFactor(agentModel) {
    const openRouterModel = parseOpenRouterSelection(agentModel)
    if (!openRouterModel) return 1

    const vendor = getOpenRouterVendor(openRouterModel)
    const factor = vendor ? OPENROUTER_VENDOR_GOLD_DISCOUNTS[vendor] : undefined
    if (!Number.isFinite(factor) || factor < 1) return 1
    return factor
}

/**
 * How many tokens buy one Gold for this model selection.
 *
 * `baseTokensPerGold` is injectable only so a caller can price against a non-standard base; it is
 * validated the same way as the factor, so a bad value can never produce a zero or negative divisor.
 */
function resolveTokensPerGold(agentModel, baseTokensPerGold = BASE_VM_TOKENS_PER_GOLD) {
    const base =
        Number.isFinite(baseTokensPerGold) && baseTokensPerGold > 0 ? baseTokensPerGold : BASE_VM_TOKENS_PER_GOLD
    return base * resolveTokenGoldDiscountFactor(agentModel)
}

/**
 * Tokens → Gold, rounded to the nearest whole Gold. The shared implementation for both charge sites,
 * so the incremental proxy charge and the final settlement round identically.
 *
 * Returns 0 for a non-positive or non-finite token count. Note this rounds *down* to zero below half
 * a Gold's worth of tokens — that is the pre-existing behaviour and it is safe here because both
 * call sites round against the run's *cumulative* total, never a single request: token dust
 * accumulates until it crosses the threshold rather than being discarded per chunk.
 */
function calculateTokenGold(totalTokens, tokensPerGold) {
    const tokens = Number(totalTokens)
    if (!Number.isFinite(tokens) || tokens <= 0) return 0
    const rate = Number.isFinite(tokensPerGold) && tokensPerGold > 0 ? tokensPerGold : BASE_VM_TOKENS_PER_GOLD
    return Math.round(tokens / rate)
}

/** Tokens → Gold for a model selection, resolving the rate in one step. */
function calculateTokenGoldForModel(totalTokens, agentModel) {
    return calculateTokenGold(totalTokens, resolveTokensPerGold(agentModel))
}

/**
 * Short human note for the status comment when a run is priced below the standard rate — so a user
 * can see the discount they are getting rather than having to infer it from their Gold history.
 * Empty string at full price, which keeps the caller's string concatenation unchanged.
 */
function formatTokenDiscountNote(agentModel) {
    const factor = resolveTokenGoldDiscountFactor(agentModel)
    if (factor <= 1) return ''
    return ` Token Gold for this model is charged at 1/${factor} of the standard rate.`
}

module.exports = {
    BASE_VM_TOKENS_PER_GOLD,
    DEEPSEEK_GOLD_DISCOUNT_FACTOR,
    OPENROUTER_VENDOR_GOLD_DISCOUNTS,
    resolveTokenGoldDiscountFactor,
    resolveTokensPerGold,
    calculateTokenGold,
    calculateTokenGoldForModel,
    formatTokenDiscountNote,
}
