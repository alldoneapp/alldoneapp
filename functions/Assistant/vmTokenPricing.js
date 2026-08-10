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
 * Both call `resolveEffectiveTokensPerGold` with the same persisted job state, so they cannot drift.
 * If they ever did, a higher settlement rate would silently overcharge while a lower one would clamp
 * the subtraction to zero and hide the discrepancy entirely.
 *
 * ## Sol is the baseline, and every other rate is a researched multiple of it
 *
 * `BASE_VM_TOKENS_PER_GOLD` (100 tokens = 1 Gold) is the rate for **`gpt-5.6-sol`**, and it is left
 * exactly where it has always been. Every other model's rate is derived from how its real upstream
 * price compares to Sol's, so the Gold price of a model tracks what it actually costs us to run:
 *
 *     tokensPerGold(model) = BASE * ( blendedUsdPerMillion(Sol) / blendedUsdPerMillion(model) )
 *
 * A model that costs a tenth of Sol upstream therefore buys ten times as many tokens per Gold. This
 * is deliberately expressed as a *scaled divisor* rather than a discounted price, so every
 * relationship in the table survives any future reprice of `BASE_VM_TOKENS_PER_GOLD`.
 *
 * ## Blending: the mix is measured, not assumed
 *
 * The proxy meters one undifferentiated `totalTokens` number (`vmLlmProxy.summarizeUsage` sums fresh
 * input + cache reads + output), so a model needs exactly one rate — which means collapsing a
 * three-part upstream price list into one blended $/1M figure, which in turn needs an input/output
 * mix. Assuming one would have been the weak link in the whole calculation, so `OBSERVED_TOKEN_MIX`
 * is taken from real production runs instead (see the constant for provenance).
 *
 * The measured shape is emphatically not the intuitive one, and it changes the answer:
 *
 *   - **output is ~0.4% of metered tokens.** A coding agent reads far more than it writes, so the
 *     headline output price barely moves the blend. Anything priced on "output is expensive" is
 *     mispriced here.
 *   - **~85% of metered tokens are cache reads.** Prompt caching, not list price, is what decides
 *     the real cost of an agentic run.
 *
 * The second point has a sharp consequence: a model with **no cache pricing at all** is charged full
 * fresh-input price for those 85%, which makes it far more expensive in practice than its list price
 * suggests. `deepseek/deepseek-r1` looks like a bargain at $0.70/$2.50 and blends out to only ~1.8x
 * cheaper than Sol, where `deepseek/deepseek-v4-pro` — nominally *dearer* per output token — blends
 * to ~18x cheaper because its cache reads cost $0.003625/1M. Pricing DeepSeek as one vendor-wide
 * "cheap" bucket would have under-billed R1 by an order of magnitude. Hence per-model rates.
 *
 * ## Where the price comes from
 *
 * Preference order, resolved once at launch by `vmJob.startVmJob` and persisted on the job:
 *
 *   1. **Live** — for OpenRouter selections, the upstream price discovered from OpenRouter's own
 *      `/api/v1/models` and cached with the model catalog. This is what makes the long tail correct
 *      and self-updating: a model released today is priced from its real numbers, and a vendor's
 *      price cut reaches Gold within the catalog TTL with nobody editing this file.
 *   2. **Researched static table** — `CODEX_REFERENCE_PRICES` / `OPENROUTER_REFERENCE_PRICES`, from
 *      the providers' official pricing pages. Covers the OpenAI tiers (which have no price
 *      discovery endpoint) and keeps the realistic OpenRouter picks correct through a discovery
 *      outage.
 *   3. **The Sol base rate** — the fail-safe for a model we have no price for at all. Deliberately
 *      *not* "assume it is cheap": an unpriced model must never be cheaper by accident, because
 *      under-billing is a silent revenue hole while over-billing is visible and correctable.
 *
 * The resolved rate is persisted on the job docs and preferred by both charge sites, so a run's
 * price is fixed at launch. A mid-run upstream price change cannot move what the user is charged,
 * and — because the rate is read from job state rather than from the sandbox's request body — a
 * prompt-injected agent cannot talk its own tokens down to a cheaper rate.
 *
 * ## What is deliberately NOT repriced
 *
 * - **Claude models** stay at the Sol base rate. Claude is the default agent and its blended cost is
 *   roughly 3x Sol (Opus) — i.e. it is currently *under*-billed — so correcting it is a price
 *   increase on the default path and needs its own product decision, not a silent change smuggled in
 *   here. `CLAUDE_REFERENCE_PRICES` documents the real numbers so that decision is a one-line change
 *   when it is taken.
 * - **The base reserve and the per-minute compute charge.** Those pay for the E2B sandbox, whose
 *   cost is identical whichever model the agent talks to.
 * - **Subscription / BYOK runs**, which are already token-exempt upstream of this module.
 *
 * ## Known modelling caveats
 *
 * - Cache *writes* cost more than fresh input (1.25x on both OpenAI and Anthropic) and are metered
 *   as plain input tokens. The blend ignores that, so a cache-write-heavy run is slightly
 *   under-priced. It is a small term at the measured mix and it errs consistently across models.
 * - `OBSERVED_TOKEN_MIX` is one workload shape (Claude/OpenAI coding runs). A model used for a very
 *   different mix is priced against that shape, not its own. Re-measure it if VM usage changes
 *   character; the constant is the only thing that needs touching.
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
 * The Sol rate: 100 tokens buy 1 Gold. Unchanged, and the anchor the whole table hangs off — it also
 * matches in-app assistant usage (`assistantHelper.getTokensPerGold`) and WhatsApp call metering.
 */
const BASE_VM_TOKENS_PER_GOLD = 100

/** Never let a derived rate collapse to zero or below; `tokens / 0` would charge Infinity Gold. */
const MIN_TOKENS_PER_GOLD = 1

/**
 * The metered token mix, measured from production rather than assumed.
 *
 * Provenance: the `proxyTokenUsage` totals of every platform-billed VM run present in
 * `pendingWebhooks` on alldonealeph as of 2026-08-10 — 27 runs, 111.9M component tokens. Kept as raw
 * counts rather than pre-computed percentages so the sample size stays visible and the derivation is
 * auditable and re-runnable.
 *
 * The shares: 14.4% fresh input, 85.2% cache reads, 0.4% output. See the module header for why those
 * two surprises (output is negligible, cache reads dominate) are what makes this table correct.
 */
const OBSERVED_TOKEN_MIX = Object.freeze({
    inputTokens: 16090557,
    cacheReadTokens: 95350274,
    outputTokens: 498870,
})

/**
 * Official OpenAI list prices in USD per 1M tokens (developers.openai.com/api/docs/pricing,
 * retrieved 2026-08-10), after the 2026-07-30 cut that dropped Luna 80% and Terra 20%.
 *
 * The convenient part: every Terra rate is exactly 0.4x the matching Sol rate and every Luna rate
 * exactly 0.04x — input, cached input and output alike. So the Terra (2.5x) and Luna (25x) multiples
 * are independent of the token mix *and* of how cache reads are treated. Those two numbers are
 * exact, not estimates, and `vmTokenPricing.test.js` pins them as ratios for that reason.
 */
const CODEX_REFERENCE_PRICES = Object.freeze({
    sol: Object.freeze({ input: 5, cachedInput: 0.5, output: 30 }),
    terra: Object.freeze({ input: 2, cachedInput: 0.2, output: 12 }),
    luna: Object.freeze({ input: 0.2, cachedInput: 0.02, output: 1.2 }),
})

/**
 * Anthropic list prices, USD per 1M tokens. Reference only — Claude is intentionally charged the Sol
 * base rate (see the module header). Present so the numbers behind that decision are visible, and so
 * pricing Claude properly later is a one-line change rather than fresh research.
 */
const CLAUDE_REFERENCE_PRICES = Object.freeze({
    opus: Object.freeze({ input: 15, cachedInput: 1.5, output: 75 }),
    sonnet: Object.freeze({ input: 3, cachedInput: 0.3, output: 15 }),
    haiku: Object.freeze({ input: 1, cachedInput: 0.1, output: 5 }),
})

/**
 * Researched OpenRouter prices, USD per 1M tokens (openrouter.ai/api/v1/models, retrieved
 * 2026-08-10). Only the fallback: a live price from the catalog wins whenever one is available.
 *
 * `cachedInput: null` means the model publishes **no** cache-read price, so cache reads bill at full
 * fresh-input price. That is not a gap in our data — it is the model's real economics, and it is
 * exactly why R1 is not in the same league as V4 Pro despite the friendlier list price.
 *
 * Entries are per model line rather than per vendor because a single DeepSeek rate cannot be honest
 * across an order-of-magnitude spread. Keys are matched longest-prefix-first, so a new dated release
 * (`deepseek-v4-flash-0731`) inherits its line's price instead of falling through to the base rate
 * the day it ships.
 */
const OPENROUTER_REFERENCE_PRICES = Object.freeze({
    'deepseek/deepseek-v4-pro': Object.freeze({ input: 0.435, cachedInput: 0.003625, output: 0.87 }),
    'deepseek/deepseek-v4-flash-0731': Object.freeze({ input: 0.08, cachedInput: 0.016, output: 0.18 }),
    'deepseek/deepseek-v4-flash': Object.freeze({ input: 0.14, cachedInput: 0.028, output: 0.28 }),
    'deepseek/deepseek-v3.2': Object.freeze({ input: 0.269, cachedInput: 0.1345, output: 0.4 }),
    'deepseek/deepseek-chat': Object.freeze({ input: 0.2574, cachedInput: null, output: 1.0287 }),
    'deepseek/deepseek-r1': Object.freeze({ input: 0.7, cachedInput: null, output: 2.5 }),
    'qwen/qwen3-coder': Object.freeze({ input: 0.3, cachedInput: 0.1, output: 1 }),
    'moonshotai/kimi-k2-thinking': Object.freeze({ input: 0.6, cachedInput: 0.15, output: 2.5 }),
    'z-ai/glm-4.6': Object.freeze({ input: 0.5, cachedInput: 0.1, output: 2 }),
})

// ---------------------------------------------------------------------------
// Blending and rate derivation
// ---------------------------------------------------------------------------

/**
 * Collapse a three-part upstream price into one blended USD-per-1M-metered-tokens figure, weighted
 * by the measured mix.
 *
 * A missing/null `cachedInput` falls back to `input`, which is the correct modelling of a model
 * without prompt caching: with no cache to read from, the agent re-sends its context as fresh input
 * every turn, so those tokens genuinely cost full price.
 */
function blendedUsdPerMillionTokens(price) {
    if (!price || typeof price !== 'object') return null

    const input = Number(price.input)
    const output = Number(price.output)
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null

    // `== null` deliberately, and BEFORE the Number() conversion: `Number(null)` is 0, which would
    // read as "cache reads are free" and price a model with no caching at all as the cheapest in the
    // table — a silent order-of-magnitude under-bill on exactly the models that need the full rate.
    const cachedCandidate = price.cachedInput == null ? NaN : Number(price.cachedInput)
    const cachedInput = Number.isFinite(cachedCandidate) && cachedCandidate >= 0 ? cachedCandidate : input

    const { inputTokens, cacheReadTokens, outputTokens } = OBSERVED_TOKEN_MIX
    const total = inputTokens + cacheReadTokens + outputTokens
    const blended = (input * inputTokens + cachedInput * cacheReadTokens + output * outputTokens) / total

    return Number.isFinite(blended) && blended > 0 ? blended : null
}

/** Sol's blended cost — the denominator every multiple in the table is measured against. */
const SOL_BLENDED_USD_PER_MILLION = blendedUsdPerMillionTokens(CODEX_REFERENCE_PRICES.sol)

/**
 * Round a derived rate DOWN to two significant figures.
 *
 * Two reasons, both practical. It keeps the published table readable (2500, 1800, 490) instead of
 * pseudo-precise (2499.7, 1839.4), and rounding *down* means the user is never charged less Gold
 * than the researched cost ratio implies — the conservative direction, since the error that hurts is
 * the invisible one. It also makes the rate stable against upstream price jitter: a sub-1% provider
 * change no longer moves anyone's bill.
 */
function quantizeTokensPerGold(rate) {
    if (!Number.isFinite(rate) || rate <= 0) return null
    const magnitude = Math.pow(10, Math.floor(Math.log10(rate)) - 1)
    // The epsilon is not cosmetic. Luna's price is exactly 0.04x Sol's on every line, so the ratio is
    // exactly 25 in decimal — but 0.2/5, 0.02/0.5 and 1.2/30 are not exact in binary, so it arrives
    // as 24.999999999999996 and a bare floor() would publish 2400 tokens/Gold instead of 2500.
    // Nudging by a relative epsilon before flooring keeps an exact multiple exact.
    const snapped = Math.floor(rate / magnitude + 1e-9) * magnitude
    return Math.max(MIN_TOKENS_PER_GOLD, Math.round(snapped))
}

function normalizeBase(baseTokensPerGold) {
    return Number.isFinite(baseTokensPerGold) && baseTokensPerGold > 0 ? baseTokensPerGold : BASE_VM_TOKENS_PER_GOLD
}

/**
 * Upstream price → tokens per Gold, relative to Sol. `null` when the price is unusable, so callers
 * can fall through to the next source rather than silently pricing off a bad number.
 *
 * Note this can legitimately return a rate *below* the base: a model dearer than Sol upstream costs
 * more Gold per token, which is the whole point of pricing per model.
 */
function deriveTokensPerGold(price, baseTokensPerGold = BASE_VM_TOKENS_PER_GOLD) {
    const blended = blendedUsdPerMillionTokens(price)
    if (blended === null) return null

    const base = normalizeBase(baseTokensPerGold)
    return quantizeTokensPerGold(base * (SOL_BLENDED_USD_PER_MILLION / blended))
}

// ---------------------------------------------------------------------------
// Model selection → price
// ---------------------------------------------------------------------------

// gpt-<major>[.<minor>]-<family>; the family is the durable tier (sol/terra/luna), the number is the
// generation, so the rate follows the tier across generations without an edit here.
const CODEX_MODEL_PATTERN = /^gpt-\d+(?:\.\d+)?-([a-z][a-z0-9]*)$/

/** The researched price for an OpenRouter model id, matching the longest configured prefix. */
function lookupOpenRouterReferencePrice(modelId) {
    if (typeof modelId !== 'string') return null
    const normalized = modelId.toLowerCase()

    const exact = OPENROUTER_REFERENCE_PRICES[normalized]
    if (exact) return exact

    // Longest prefix wins, so `deepseek-v4-flash-0731` prefers the dated Flash entry over the
    // shorter `deepseek-v4-flash` one, and an unknown `…-v4-pro-0901` still lands on the Pro line.
    let bestKey = null
    for (const key of Object.keys(OPENROUTER_REFERENCE_PRICES)) {
        if (normalized.startsWith(key) && (!bestKey || key.length > bestKey.length)) bestKey = key
    }
    return bestKey ? OPENROUTER_REFERENCE_PRICES[bestKey] : null
}

/**
 * The upstream price for a model selection, or `null` when we have none.
 *
 * `options.upstreamPrice` is the live catalog price and always wins — it is the current truth for
 * the model actually being run, where the static table is a snapshot of research day.
 */
function resolveUpstreamPrice(agentModel, options = {}) {
    const live = options.upstreamPrice
    if (blendedUsdPerMillionTokens(live) !== null) return live

    const openRouterModel = parseOpenRouterSelection(agentModel)
    if (openRouterModel) return lookupOpenRouterReferencePrice(openRouterModel)

    if (typeof agentModel !== 'string') return null
    const codexFamily = CODEX_MODEL_PATTERN.exec(agentModel.trim().toLowerCase())
    if (codexFamily) return CODEX_REFERENCE_PRICES[codexFamily[1]] || null

    // Claude (and anything else) intentionally has no entry here: no price → the Sol base rate.
    return null
}

/**
 * How many tokens buy one Gold for this model selection.
 *
 * `baseTokensPerGold` is injectable only so a caller can price against a non-standard base; it is
 * validated the same way as everything else, so a bad value can never produce a zero or negative
 * divisor. An unpriced model resolves to the base rate — never to free.
 */
function resolveTokensPerGold(agentModel, baseTokensPerGold = BASE_VM_TOKENS_PER_GOLD, options = {}) {
    const base = normalizeBase(baseTokensPerGold)
    const price = resolveUpstreamPrice(agentModel, options)
    const derived = deriveTokensPerGold(price, base)
    return derived === null ? base : derived
}

/**
 * THE resolver both charge sites call — the one function that guarantees the incremental proxy
 * charge and the final settlement bill at the same rate.
 *
 * Prefers `tokensPerGold` as persisted on the job at launch, so a run's price is fixed for its whole
 * lifetime even if the upstream catalog moves underneath it. Falls back to resolving from
 * `agentModel`, which keeps jobs created before this field existed billing exactly as they did.
 */
function resolveEffectiveTokensPerGold(jobState = {}) {
    const persisted = Number(jobState.tokensPerGold)
    if (Number.isFinite(persisted) && persisted > 0) return persisted
    return resolveTokensPerGold(jobState.agentModel)
}

/**
 * This model's Gold cost expressed against Sol's: 25 means the same token count costs 1/25 of the
 * Gold it would cost on Sol. Below 1 means the model is dearer than Sol. Used for the status text,
 * and by tests that want to assert a researched ratio rather than a hardcoded rate.
 */
function resolveSolRelativeGoldFactor(agentModel, options = {}) {
    // An already-resolved rate wins, so the number quoted in the status comment is by construction
    // the number the user is billed at — not a second, independently-derived guess at it.
    const persisted = Number(options.tokensPerGold)
    const rate =
        Number.isFinite(persisted) && persisted > 0
            ? persisted
            : resolveTokensPerGold(agentModel, BASE_VM_TOKENS_PER_GOLD, options)
    return rate / BASE_VM_TOKENS_PER_GOLD
}

// ---------------------------------------------------------------------------
// Charging
// ---------------------------------------------------------------------------

/**
 * Tokens → Gold, rounded to the nearest whole Gold. The shared implementation for both charge sites,
 * so the incremental proxy charge and the final settlement round identically.
 *
 * Returns 0 for a non-positive or non-finite token count. Note this rounds *down* to zero below half
 * a Gold's worth of tokens — that is the pre-existing behaviour and it is safe here because both
 * call sites round against the run's *cumulative* total, never a single request: token dust
 * accumulates until it crosses the threshold rather than being discarded per chunk. That property
 * matters more now than it used to, because the cheapest rates in the table put the threshold tens
 * of times higher than the old flat 100.
 */
function calculateTokenGold(totalTokens, tokensPerGold) {
    const tokens = Number(totalTokens)
    if (!Number.isFinite(tokens) || tokens <= 0) return 0
    const rate = Number.isFinite(tokensPerGold) && tokensPerGold > 0 ? tokensPerGold : BASE_VM_TOKENS_PER_GOLD
    return Math.round(tokens / rate)
}

/** Tokens → Gold for a model selection, resolving the rate in one step. */
function calculateTokenGoldForModel(totalTokens, agentModel, options = {}) {
    return calculateTokenGold(totalTokens, resolveTokensPerGold(agentModel, BASE_VM_TOKENS_PER_GOLD, options))
}

/**
 * Short human note for the status comment whenever a run is priced away from the Sol baseline — so a
 * user can see the rate they are getting rather than having to infer it from their Gold history.
 * Empty string at exactly the Sol rate, which keeps the caller's string concatenation unchanged.
 */
function formatTokenDiscountNote(agentModel, options = {}) {
    const factor = resolveSolRelativeGoldFactor(agentModel, options)
    if (!Number.isFinite(factor) || factor === 1) return ''

    if (factor > 1) {
        return ` Token Gold for this model is charged at 1/${formatFactor(factor)} of the Sol rate.`
    }
    return ` Token Gold for this model is charged at ${formatFactor(1 / factor)}x the Sol rate.`
}

/** One decimal place only when it is not a whole number, so the common cases read as "25" / "2.5". */
function formatFactor(value) {
    const rounded = Math.round(value * 10) / 10
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

module.exports = {
    BASE_VM_TOKENS_PER_GOLD,
    MIN_TOKENS_PER_GOLD,
    OBSERVED_TOKEN_MIX,
    CODEX_REFERENCE_PRICES,
    CLAUDE_REFERENCE_PRICES,
    OPENROUTER_REFERENCE_PRICES,
    SOL_BLENDED_USD_PER_MILLION,
    blendedUsdPerMillionTokens,
    quantizeTokensPerGold,
    deriveTokensPerGold,
    resolveUpstreamPrice,
    resolveTokensPerGold,
    resolveEffectiveTokensPerGold,
    resolveSolRelativeGoldFactor,
    calculateTokenGold,
    calculateTokenGoldForModel,
    formatTokenDiscountNote,
}
