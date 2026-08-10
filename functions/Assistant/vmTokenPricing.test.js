const {
    BASE_VM_TOKENS_PER_GOLD,
    DEEPSEEK_GOLD_DISCOUNT_FACTOR,
    resolveTokenGoldDiscountFactor,
    resolveTokensPerGold,
    calculateTokenGold,
    calculateTokenGoldForModel,
    formatTokenDiscountNote,
} = require('./vmTokenPricing')

// Luna is the cheapest OpenAI Codex tier and, like every non-discounted model, is priced at the
// standard rate — so it is the concrete yardstick the product decision was expressed against
// ("make DeepSeek 5x cheaper than Luna in Alldone Gold").
const LUNA = 'gpt-5.6-luna'
const DEEPSEEK = 'openrouter:deepseek/deepseek-v3.2'

describe('the DeepSeek discount is exactly 5x cheaper than Luna', () => {
    // The headline invariant. Asserted as a *ratio of Gold cost* rather than against hardcoded
    // numbers, so it keeps holding if the base rate is ever repriced.
    test.each([
        ['a short run', 50_000],
        ['a typical run', 250_000],
        ['a long run', 4_000_000],
    ])('%s costs a fifth of the Luna price on DeepSeek', (_label, tokens) => {
        const lunaGold = calculateTokenGoldForModel(tokens, LUNA)
        const deepSeekGold = calculateTokenGoldForModel(tokens, DEEPSEEK)

        expect(lunaGold).toBeGreaterThan(0)
        expect(deepSeekGold).toBeGreaterThan(0)
        expect(deepSeekGold).toBe(lunaGold / 5)
        expect(lunaGold / deepSeekGold).toBe(DEEPSEEK_GOLD_DISCOUNT_FACTOR)
    })

    test('"5x cheaper" is implemented as 5x the tokens per Gold, not a discounted base rate', () => {
        expect(resolveTokensPerGold(LUNA)).toBe(BASE_VM_TOKENS_PER_GOLD)
        expect(resolveTokensPerGold(DEEPSEEK)).toBe(BASE_VM_TOKENS_PER_GOLD * 5)
    })

    // Scaling the divisor rather than the price is what makes the relationship survive a reprice.
    test('the 5x relationship survives a change to the base rate', () => {
        const repricedBase = 250
        const luna = resolveTokensPerGold(LUNA, repricedBase)
        const deepSeek = resolveTokensPerGold(DEEPSEEK, repricedBase)

        expect(luna).toBe(repricedBase)
        expect(deepSeek / luna).toBe(DEEPSEEK_GOLD_DISCOUNT_FACTOR)
    })

    test('the discount applies to every DeepSeek id, including new releases and variants', () => {
        for (const id of [
            'openrouter:deepseek/deepseek-chat',
            'openrouter:deepseek/deepseek-v3.2',
            'openrouter:deepseek/deepseek-r1:free',
            'openrouter:deepseek/deepseek-r1-0528',
            'openrouter:DeepSeek/DeepSeek-Chat', // OpenRouter ids are case-insensitive
        ]) {
            expect(resolveTokenGoldDiscountFactor(id)).toBe(DEEPSEEK_GOLD_DISCOUNT_FACTOR)
        }
    })
})

describe('nothing else is repriced', () => {
    // The task scoped the discount to DeepSeek. A blanket "OpenRouter is cheap" rule would silently
    // under-bill every other vendor, so each of these must still resolve to the standard rate.
    test.each([
        ['every OpenAI Codex tier', ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']],
        ['every Claude family', ['opus', 'sonnet', 'haiku', 'claude-opus-5', 'claude-haiku-4-5']],
        [
            'every non-DeepSeek OpenRouter vendor',
            [
                'openrouter:qwen/qwen3-coder',
                'openrouter:moonshotai/kimi-k2',
                'openrouter:mistralai/mistral-large',
                'openrouter:z-ai/glm-4.6',
            ],
        ],
        // A DeepSeek *derivative* rehosted by another vendor is not DeepSeek's own hosting, so its
        // upstream economics are unknown to us and it stays at full price.
        ['a third-party DeepSeek derivative', ['openrouter:tngtech/deepseek-r1t-chimera']],
    ])('%s stays at the standard rate', (_label, models) => {
        for (const model of models) {
            expect(resolveTokenGoldDiscountFactor(model)).toBe(1)
            expect(resolveTokensPerGold(model)).toBe(BASE_VM_TOKENS_PER_GOLD)
        }
    })

    test('an unset or unrecognised selection falls back to the standard rate, never to free', () => {
        for (const value of [undefined, null, '', '   ', 42, {}, 'not-a-model', 'openrouter:', 'openrouter:deepseek']) {
            expect(resolveTokensPerGold(value)).toBe(BASE_VM_TOKENS_PER_GOLD)
        }
    })

    // A malformed OpenRouter id can never be cheap by accident: parsing fails, so it prices as
    // standard rather than inheriting the vendor's discount from a lookalike string.
    test('a malformed DeepSeek-looking id is charged the standard rate', () => {
        for (const value of ['openrouter:deepseek/', 'openrouter:/deepseek-chat', 'openrouter:deepseek deepseek']) {
            expect(resolveTokenGoldDiscountFactor(value)).toBe(1)
        }
    })
})

describe('the rate can never produce a zero, negative or non-finite charge', () => {
    // A zero divisor would make every run cost Infinity Gold; a NaN one would write NaN into the
    // ledger. Both are billing incidents, so the resolver clamps instead of trusting its inputs.
    test('resolveTokensPerGold always returns a positive finite divisor', () => {
        for (const base of [0, -100, NaN, Infinity, -Infinity, undefined, null, 'abc']) {
            for (const model of [LUNA, DEEPSEEK]) {
                const rate = resolveTokensPerGold(model, base)
                expect(Number.isFinite(rate)).toBe(true)
                expect(rate).toBeGreaterThan(0)
            }
        }
    })

    test('a bad divisor falls back to the base rate rather than charging Infinity', () => {
        expect(calculateTokenGold(1000, 0)).toBe(calculateTokenGold(1000, BASE_VM_TOKENS_PER_GOLD))
        expect(calculateTokenGold(1000, NaN)).toBe(10)
        expect(calculateTokenGold(1000, -5)).toBe(10)
        expect(Number.isFinite(calculateTokenGold(1000, Infinity))).toBe(true)
    })

    test('non-positive or non-finite token counts charge nothing', () => {
        for (const tokens of [0, -1, NaN, Infinity, undefined, null, 'abc']) {
            expect(calculateTokenGold(tokens, resolveTokensPerGold(DEEPSEEK))).toBe(0)
        }
    })

    // The one real hazard a 5x divisor introduces: below half a Gold's worth of tokens the rounding
    // goes to zero, and at 500 tokens/Gold that threshold is five times higher than before. Both
    // charge sites round against the run's *cumulative* total, so this only ever defers a charge —
    // the tokens stay banked and are billed once the total crosses the line.
    test('token dust below the rounding threshold is deferred, not discarded', () => {
        const rate = resolveTokensPerGold(DEEPSEEK)
        expect(calculateTokenGold(200, rate)).toBe(0)

        // Simulate the proxy's cumulative accounting over many small requests.
        let cumulative = 0
        let charged = 0
        for (let i = 0; i < 20; i++) {
            cumulative += 200
            const due = Math.max(0, calculateTokenGold(cumulative, rate) - charged)
            charged += due
        }
        expect(cumulative).toBe(4000)
        expect(charged).toBe(8) // round(4000 / 500) — nothing lost to the per-request rounding
        expect(charged).toBe(calculateTokenGold(cumulative, rate))
    })

    test('a realistic DeepSeek run always bills something', () => {
        expect(calculateTokenGoldForModel(100_000, DEEPSEEK)).toBe(200)
        expect(calculateTokenGoldForModel(100_000, LUNA)).toBe(1000)
    })
})

describe('the discount is disclosed to the user', () => {
    test('a discounted model says so; a full-price one adds nothing', () => {
        expect(formatTokenDiscountNote(DEEPSEEK)).toContain('1/5')
        expect(formatTokenDiscountNote(LUNA)).toBe('')
        expect(formatTokenDiscountNote('openrouter:qwen/qwen3-coder')).toBe('')
        expect(formatTokenDiscountNote(undefined)).toBe('')
    })
})
