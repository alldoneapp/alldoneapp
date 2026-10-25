const { getSolRequestCost, SOL_LONG_CONTEXT_THRESHOLD } = require('./solModelPricing')

describe('GPT-6.1 Sol official request pricing', () => {
    test('Standard cache reads are $0.10/M, cache writes $2.50/M, and neither is added to input', () => {
        const result = getSolRequestCost({
            input_tokens: 100000,
            input_tokens_details: { cached_tokens: 80000, cache_write_tokens: 10000 },
            output_tokens: 10000,
            output_tokens_details: { reasoning_tokens: 9000 },
        })
        expect(result.totalTokens).toBe(110000)
        expect(result.ordinaryInputTokens).toBe(10000)
        expect(result.costUsd).toBeCloseTo(0.02 + 0.008 + 0.025 + 0.1)
    })

    test('272K is short context; one token over prices the entire input and output at long-context rates', () => {
        const short = getSolRequestCost({ input_tokens: SOL_LONG_CONTEXT_THRESHOLD, output_tokens: 1000 })
        const long = getSolRequestCost({ input_tokens: SOL_LONG_CONTEXT_THRESHOLD + 1, output_tokens: 1000 })
        expect(short.longContext).toBe(false)
        expect(short.costUsd).toBeCloseTo(0.554)
        expect(long.longContext).toBe(true)
        expect(long.costUsd).toBeCloseTo(1.103004)
    })

    test.each([
        ['default', 1],
        ['auto', 1],
        ['flex', 0.5],
        ['batch', 0.5],
        ['fast', 2],
        ['priority', 2],
    ])('%s processing uses its own price multiplier', (tier, multiplier) => {
        const usage = { input_tokens: 100000, input_tokens_details: { cached_tokens: 100000 } }
        expect(getSolRequestCost(usage, tier).costUsd).toBeCloseTo(0.01 * multiplier)
    })

    test('long-context caching applies to the full request, including writes and reads', () => {
        expect(
            getSolRequestCost({
                input_tokens: 400000,
                input_tokens_details: { cached_tokens: 300000, cache_write_tokens: 100000 },
                output_tokens: 10000,
            }).costUsd
        ).toBeCloseTo(0.06 + 0.5 + 0.15)
    })

    test('Chat Completions usage has the same cache semantics', () => {
        expect(
            getSolRequestCost({
                prompt_tokens: 100000,
                prompt_tokens_details: { cached_tokens: 80000 },
                completion_tokens: 10000,
            }).costUsd
        ).toBeCloseTo(0.04 + 0.008 + 0.1)
    })
})
