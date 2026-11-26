// Official Standard USD/1M prices, verified 2026-09-30 for gpt-6.1-sol and again on 2026-11-26
// for gpt-6.2-sol, which lists the same input, cached input, cache write, output and >272K
// long-context rates (AT-3163):
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/pricing
// Cache reads/writes are subsets of input_tokens, not additional tokens.
const SOL_MODEL = 'gpt-6.2-sol'
// Every Sol release these prices are verified for. A VM job started on 6.1 Sol before the 6.2
// rollout keeps its per-request pricing when it resumes or finishes after the deploy.
const SOL_PRICED_MODELS = Object.freeze(['gpt-6.1-sol', SOL_MODEL])
const isSolPricedModel = model => SOL_PRICED_MODELS.includes(model)
const SOL_LONG_CONTEXT_THRESHOLD = 272000
const SOL_STANDARD_PRICES = Object.freeze({ input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 })
const SOL_LONG_CONTEXT_PRICES = Object.freeze({ input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 })

function tokenCount(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : 0
}

function getSolRequestCost(usage = {}, serviceTier = 'default') {
    const input = tokenCount(usage.input_tokens ?? usage.prompt_tokens)
    const output = tokenCount(usage.output_tokens ?? usage.completion_tokens)
    const details = usage.input_tokens_details || usage.prompt_tokens_details || {}
    const cached = Math.min(input, tokenCount(details.cached_tokens))
    const written = Math.min(input - cached, tokenCount(details.cache_write_tokens))
    const ordinary = input - cached - written
    const longContext = input > SOL_LONG_CONTEXT_THRESHOLD
    const price = longContext ? SOL_LONG_CONTEXT_PRICES : SOL_STANDARD_PRICES
    // The returned tier is authoritative (auto may resolve to Standard or Fast).
    const multiplier = ['flex', 'batch'].includes(serviceTier)
        ? 0.5
        : ['fast', 'priority'].includes(serviceTier)
          ? 2
          : 1
    return {
        inputTokens: input,
        outputTokens: output, // Includes reasoning tokens; never add them a second time.
        cacheReadTokens: cached,
        cacheWriteTokens: written,
        ordinaryInputTokens: ordinary,
        totalTokens: input + output,
        longContext,
        serviceTier,
        costUsd:
            ((ordinary * price.input +
                cached * price.cachedInput +
                written * price.cacheWrite +
                output * price.output) *
                multiplier) /
            1000000,
    }
}

module.exports = {
    SOL_MODEL,
    SOL_PRICED_MODELS,
    isSolPricedModel,
    SOL_LONG_CONTEXT_THRESHOLD,
    SOL_STANDARD_PRICES,
    SOL_LONG_CONTEXT_PRICES,
    getSolRequestCost,
}
