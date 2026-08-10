const {
    BASE_VM_TOKENS_PER_GOLD,
    OBSERVED_TOKEN_MIX,
    CODEX_REFERENCE_PRICES,
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
} = require('./vmTokenPricing')

const SOL = 'gpt-5.6-sol'
const TERRA = 'gpt-5.6-terra'
const LUNA = 'gpt-5.6-luna'
const DEEPSEEK_PRO = 'openrouter:deepseek/deepseek-v4-pro'
const DEEPSEEK_FLASH = 'openrouter:deepseek/deepseek-v4-flash'
const DEEPSEEK_R1 = 'openrouter:deepseek/deepseek-r1'

describe('Sol is the baseline the whole table hangs off', () => {
    test('Sol keeps the historical rate, unchanged', () => {
        expect(BASE_VM_TOKENS_PER_GOLD).toBe(100)
        expect(resolveTokensPerGold(SOL)).toBe(BASE_VM_TOKENS_PER_GOLD)
        expect(resolveSolRelativeGoldFactor(SOL)).toBe(1)
    })

    // Claude is the default agent and is currently under-billed against Sol (Opus blends to ~3x Sol).
    // Correcting that is a price increase on the default path and needs its own product decision, so
    // this test exists to make any future change to it deliberate and visible rather than incidental.
    test('Claude models are deliberately left at the Sol rate', () => {
        for (const model of ['opus', 'sonnet', 'haiku', 'claude-opus-5', 'claude-haiku-4-5']) {
            expect(resolveTokensPerGold(model)).toBe(BASE_VM_TOKENS_PER_GOLD)
        }
    })
})

describe('the OpenAI tier multiples are exact, not estimated', () => {
    // Every Terra rate is 0.4x the matching Sol rate and every Luna rate 0.04x — input, cached input
    // and output alike. So these two multiples fall out of the price list itself and hold for ANY
    // token mix. Asserted as ratios so they survive a reprice of the base rate.
    test('Terra costs exactly 1/2.5 of Sol and Luna exactly 1/25', () => {
        expect(resolveSolRelativeGoldFactor(TERRA)).toBe(2.5)
        expect(resolveSolRelativeGoldFactor(LUNA)).toBe(25)
        expect(resolveTokensPerGold(TERRA)).toBe(250)
        expect(resolveTokensPerGold(LUNA)).toBe(2500)
    })

    test.each([
        ['a short run', 50_000],
        ['a typical run', 2_500_000],
        ['a long run', 100_000_000],
    ])('%s bills Sol : Terra : Luna as 25 : 10 : 1', (_label, tokens) => {
        const sol = calculateTokenGoldForModel(tokens, SOL)
        const terra = calculateTokenGoldForModel(tokens, TERRA)
        const luna = calculateTokenGoldForModel(tokens, LUNA)

        expect(luna).toBeGreaterThan(0)
        expect(sol / terra).toBeCloseTo(2.5, 5)
        expect(sol / luna).toBeCloseTo(25, 5)
    })

    // The multiple must follow the durable tier, not the generation number, or the next OpenAI release
    // silently reverts everyone to the Sol rate.
    test('the tier multiple survives a generation bump', () => {
        expect(resolveTokensPerGold('gpt-6.0-luna')).toBe(resolveTokensPerGold(LUNA))
        expect(resolveTokensPerGold('gpt-7-terra')).toBe(resolveTokensPerGold(TERRA))
    })

    // Exactly 0.04x in decimal is 24.999999999999996 in binary; a bare floor() to two significant
    // figures would publish 2400 tokens/Gold and quietly overcharge every Luna run by 4%.
    test('an exact decimal multiple is not lost to floating-point dust', () => {
        expect(quantizeTokensPerGold(2500 * (1 - Number.EPSILON))).toBe(2500)
        expect(quantizeTokensPerGold(250 * (1 - Number.EPSILON))).toBe(250)
    })
})

describe('blending uses the measured mix, and cache pricing dominates it', () => {
    test('the observed mix is read-heavy and cache-heavy, which is what makes the table correct', () => {
        const { inputTokens, cacheReadTokens, outputTokens } = OBSERVED_TOKEN_MIX
        const total = inputTokens + cacheReadTokens + outputTokens

        // Output is a rounding error in an agentic coding run; cache reads are the whole ballgame.
        expect(outputTokens / total).toBeLessThan(0.01)
        expect(cacheReadTokens / total).toBeGreaterThan(0.8)
    })

    test('Sol blends to its published mix-weighted cost', () => {
        expect(SOL_BLENDED_USD_PER_MILLION).toBeCloseTo(1.278, 3)
        expect(blendedUsdPerMillionTokens(CODEX_REFERENCE_PRICES.sol)).toBe(SOL_BLENDED_USD_PER_MILLION)
    })

    // The single most dangerous line in the module: `Number(null)` is 0, so treating a missing
    // cache-read price as a number would price 85% of a run's tokens at FREE and make a model with no
    // caching the cheapest in the table. It must fall back to the full input price instead.
    test('a model with no cache pricing bills cache reads at full input price', () => {
        const withoutCache = blendedUsdPerMillionTokens({ input: 1, cachedInput: null, output: 2 })
        const cachedAtFree = blendedUsdPerMillionTokens({ input: 1, cachedInput: 0, output: 2 })
        const allInput = blendedUsdPerMillionTokens({ input: 1, cachedInput: 1, output: 2 })

        expect(withoutCache).toBe(allInput)
        expect(withoutCache).toBeGreaterThan(cachedAtFree * 5)
        for (const missing of [undefined, null]) {
            expect(blendedUsdPerMillionTokens({ input: 1, cachedInput: missing, output: 2 })).toBe(allInput)
        }
    })

    // The finding that overturned "DeepSeek is uniformly cheap": R1 publishes no cache-read price, so
    // at this workload's mix it is barely cheaper than Sol, while V4 Pro — dearer per output token —
    // is ~18x cheaper because its cache reads cost $0.003625/1M. One vendor-wide rate cannot be
    // honest across that spread, which is why rates are per model line.
    test('DeepSeek is not one price: R1 is an order of magnitude dearer than V4 Pro', () => {
        expect(resolveTokensPerGold(DEEPSEEK_PRO)).toBe(1800)
        expect(resolveTokensPerGold(DEEPSEEK_FLASH)).toBe(2800)
        expect(resolveTokensPerGold(DEEPSEEK_R1)).toBe(180)

        expect(resolveTokensPerGold(DEEPSEEK_PRO) / resolveTokensPerGold(DEEPSEEK_R1)).toBeGreaterThan(9)
        // And R1 is dearer than Luna, so it must NOT be priced as a discount off Luna.
        expect(resolveTokensPerGold(DEEPSEEK_R1)).toBeLessThan(resolveTokensPerGold(LUNA))
    })

    test('the researched rates match the published table', () => {
        expect(resolveTokensPerGold('openrouter:deepseek/deepseek-v4-flash-0731')).toBe(4900)
        expect(resolveTokensPerGold('openrouter:deepseek/deepseek-v3.2')).toBe(820)
        expect(resolveTokensPerGold('openrouter:deepseek/deepseek-chat')).toBe(490)
        expect(resolveTokensPerGold('openrouter:qwen/qwen3-coder')).toBe(960)
        expect(resolveTokensPerGold('openrouter:z-ai/glm-4.6')).toBe(770)
        expect(resolveTokensPerGold('openrouter:moonshotai/kimi-k2-thinking')).toBe(560)
    })

    test('every rate is a faithful inversion of the blended cost ratio', () => {
        for (const [modelId, price] of Object.entries(OPENROUTER_REFERENCE_PRICES)) {
            const expected = SOL_BLENDED_USD_PER_MILLION / blendedUsdPerMillionTokens(price)
            const actual = resolveSolRelativeGoldFactor(`openrouter:${modelId}`)
            // Quantization only ever rounds down, and never by more than one significant step.
            expect(actual).toBeLessThanOrEqual(expected + 1e-9)
            expect(actual).toBeGreaterThan(expected * 0.9)
        }
    })
})

describe('a model dearer than Sol costs more Gold, not less', () => {
    // "Park everything else at Luna level" would have billed this at ~1/150 of upstream cost.
    test('an expensive model priced live resolves below the base rate', () => {
        const opusViaOpenRouter = {
            upstreamPrice: { input: 30, cachedInput: 3, output: 150 },
        }
        const rate = resolveTokensPerGold('openrouter:anthropic/claude-opus-4.7-fast', undefined, opusViaOpenRouter)

        expect(rate).toBeLessThan(BASE_VM_TOKENS_PER_GOLD)
        expect(rate).toBeGreaterThan(0)
        expect(
            resolveSolRelativeGoldFactor('openrouter:anthropic/claude-opus-4.7-fast', opusViaOpenRouter)
        ).toBeLessThan(1)
    })

    test('a free model is capped rather than dividing by zero', () => {
        const rate = resolveTokensPerGold('openrouter:someone/free-model', undefined, {
            upstreamPrice: { input: 0, cachedInput: 0, output: 0 },
        })
        expect(Number.isFinite(rate)).toBe(true)
        expect(rate).toBeGreaterThan(0)
    })
})

describe('price source preference: live wins, then researched, then the Sol base rate', () => {
    test('a live catalog price overrides the researched static entry', () => {
        const liveHalfPrice = { upstreamPrice: { input: 0.2175, cachedInput: 0.0018125, output: 0.435 } }
        const live = resolveTokensPerGold(DEEPSEEK_PRO, undefined, liveHalfPrice)

        expect(live).toBeGreaterThan(resolveTokensPerGold(DEEPSEEK_PRO))
        expect(resolveUpstreamPrice(DEEPSEEK_PRO, liveHalfPrice)).toBe(liveHalfPrice.upstreamPrice)
    })

    test('an unusable live price falls through to the researched entry instead of mispricing', () => {
        for (const upstreamPrice of [null, undefined, {}, { input: 'abc', output: 1 }, { input: -1, output: 1 }]) {
            expect(resolveTokensPerGold(DEEPSEEK_PRO, undefined, { upstreamPrice })).toBe(1800)
        }
    })

    // A new dated release must inherit its line's price on day one, not fall back to the Sol rate.
    test('an unknown release inherits its model line by longest-prefix match', () => {
        expect(resolveTokensPerGold('openrouter:deepseek/deepseek-v4-pro-0901')).toBe(
            resolveTokensPerGold(DEEPSEEK_PRO)
        )
        // The dated Flash entry must win over the shorter `deepseek-v4-flash` prefix.
        expect(resolveTokensPerGold('openrouter:deepseek/deepseek-v4-flash-0731')).not.toBe(
            resolveTokensPerGold(DEEPSEEK_FLASH)
        )
    })

    // Fail-safe direction: an unpriced model must never be cheap by accident. Under-billing is a
    // silent revenue hole; over-billing is visible and correctable.
    test('a model we have no price for at all charges the Sol base rate, never free', () => {
        for (const model of [
            'openrouter:brandnew/unheard-of-model',
            'openrouter:tngtech/deepseek-r1t-chimera', // a DeepSeek derivative is not DeepSeek's hosting
            undefined,
            null,
            '',
            '   ',
            42,
            {},
            'not-a-model',
            'openrouter:',
            'openrouter:deepseek',
            'openrouter:deepseek/',
            'openrouter:/deepseek-chat',
        ]) {
            expect(resolveTokensPerGold(model)).toBe(BASE_VM_TOKENS_PER_GOLD)
        }
    })
})

describe('both charge sites resolve one rate from one persisted state', () => {
    // The invariant the whole module exists for. The proxy charges incrementally mid-run and the
    // runner settles the remainder; if they resolved different rates, a higher settlement rate would
    // silently overcharge and a lower one would clamp the subtraction to zero and hide it entirely.
    test('the persisted rate is preferred over re-deriving from the model id', () => {
        const jobState = { tokensPerGold: 1800, agentModel: DEEPSEEK_PRO }
        expect(resolveEffectiveTokensPerGold(jobState)).toBe(1800)

        // Even if the catalog moves underneath the run, the frozen rate is what both sites use.
        expect(resolveEffectiveTokensPerGold({ tokensPerGold: 4321, agentModel: DEEPSEEK_PRO })).toBe(4321)
    })

    test('a job written before the field existed still bills exactly as it did', () => {
        for (const tokensPerGold of [undefined, null, 0, -5, NaN, 'abc']) {
            expect(resolveEffectiveTokensPerGold({ tokensPerGold, agentModel: LUNA })).toBe(resolveTokensPerGold(LUNA))
        }
        expect(resolveEffectiveTokensPerGold({})).toBe(BASE_VM_TOKENS_PER_GOLD)
        expect(resolveEffectiveTokensPerGold()).toBe(BASE_VM_TOKENS_PER_GOLD)
    })

    test('the incremental and settlement paths agree to the Gold on the same run', () => {
        const rate = resolveEffectiveTokensPerGold({ tokensPerGold: 2500, agentModel: LUNA })

        // Proxy: charge incrementally against the cumulative total.
        let cumulative = 0
        let proxyCharged = 0
        for (const chunk of [120_000, 45_000, 900_000, 12_345, 3_000_000]) {
            cumulative += chunk
            proxyCharged += Math.max(0, calculateTokenGold(cumulative, rate) - proxyCharged)
        }

        // Runner: settle the remainder from the same rate and the same total.
        const settlementTotal = calculateTokenGold(cumulative, rate)
        expect(proxyCharged).toBe(settlementTotal)
        expect(Math.max(0, settlementTotal - proxyCharged)).toBe(0)
    })
})

describe('the rate can never produce a zero, negative or non-finite charge', () => {
    test('resolveTokensPerGold always returns a positive finite divisor', () => {
        for (const base of [0, -100, NaN, Infinity, -Infinity, undefined, null, 'abc']) {
            for (const model of [SOL, LUNA, DEEPSEEK_PRO, DEEPSEEK_R1, 'openrouter:unknown/model']) {
                const rate = resolveTokensPerGold(model, base)
                expect(Number.isFinite(rate)).toBe(true)
                expect(rate).toBeGreaterThan(0)
            }
        }
    })

    // Scaling the divisor rather than baking in absolute prices is what makes every researched
    // multiple survive a reprice of the base. The ratio is preserved up to quantization only: at a
    // base of 250 Luna derives 6250, which rounding to two significant figures publishes as 6200
    // (24.8x). That is the intended trade — a readable, jitter-proof rate — and it always errs
    // downward, i.e. never in the user's favour by accident.
    test('an injected base rate scales the whole table, preserving its ratios up to quantization', () => {
        const repricedBase = 250
        const sol = resolveTokensPerGold(SOL, repricedBase)
        const luna = resolveTokensPerGold(LUNA, repricedBase)

        expect(sol).toBe(repricedBase)
        expect(luna / sol).toBeCloseTo(25, 0)
        expect(luna / sol).toBeLessThanOrEqual(25)
        expect(luna / sol).toBeGreaterThan(25 * 0.99)
    })

    test('a bad divisor falls back to the base rate rather than charging Infinity', () => {
        expect(calculateTokenGold(1000, 0)).toBe(calculateTokenGold(1000, BASE_VM_TOKENS_PER_GOLD))
        expect(calculateTokenGold(1000, NaN)).toBe(10)
        expect(calculateTokenGold(1000, -5)).toBe(10)
        expect(Number.isFinite(calculateTokenGold(1000, Infinity))).toBe(true)
    })

    test('non-positive or non-finite token counts charge nothing', () => {
        for (const tokens of [0, -1, NaN, Infinity, undefined, null, 'abc']) {
            expect(calculateTokenGold(tokens, resolveTokensPerGold(LUNA))).toBe(0)
        }
    })

    test('deriveTokensPerGold reports an unusable price instead of guessing at one', () => {
        for (const price of [null, undefined, 'free', {}, { input: 1 }, { output: 1 }, { input: NaN, output: 1 }]) {
            expect(deriveTokensPerGold(price)).toBeNull()
        }
        expect(quantizeTokensPerGold(0)).toBeNull()
        expect(quantizeTokensPerGold(-5)).toBeNull()
        expect(quantizeTokensPerGold(NaN)).toBeNull()
    })

    // The hazard the cheap end of the table introduces: at 4900 tokens/Gold the rounding threshold is
    // 49x higher than at the Sol rate, so a small request rounds to zero far more often. Safe only
    // because both charge sites round against the run's CUMULATIVE total — dust is banked, not lost.
    test('token dust below the rounding threshold is deferred, not discarded', () => {
        const rate = resolveTokensPerGold('openrouter:deepseek/deepseek-v4-flash-0731')
        expect(rate).toBe(4900)
        expect(calculateTokenGold(2000, rate)).toBe(0)

        let cumulative = 0
        let charged = 0
        for (let i = 0; i < 50; i++) {
            cumulative += 2000
            charged += Math.max(0, calculateTokenGold(cumulative, rate) - charged)
        }
        expect(cumulative).toBe(100_000)
        expect(charged).toBe(calculateTokenGold(cumulative, rate))
        expect(charged).toBe(20) // round(100000 / 4900) — nothing lost to per-request rounding
    })

    test('a realistic run always bills something on every tier', () => {
        for (const model of [SOL, TERRA, LUNA, DEEPSEEK_PRO, DEEPSEEK_FLASH, DEEPSEEK_R1]) {
            expect(calculateTokenGoldForModel(5_000_000, model)).toBeGreaterThan(0)
        }
        expect(calculateTokenGoldForModel(1_000_000, SOL)).toBe(10_000)
        expect(calculateTokenGoldForModel(1_000_000, LUNA)).toBe(400)
    })
})

describe('the rate is disclosed to the user', () => {
    test('a model away from the Sol baseline names its multiple; Sol itself adds nothing', () => {
        expect(formatTokenDiscountNote(SOL)).toBe('')
        expect(formatTokenDiscountNote('opus')).toBe('')
        expect(formatTokenDiscountNote(undefined)).toBe('')

        expect(formatTokenDiscountNote(LUNA)).toContain('1/25')
        expect(formatTokenDiscountNote(TERRA)).toContain('1/2.5')
        expect(formatTokenDiscountNote(DEEPSEEK_PRO)).toContain('1/18')
        expect(formatTokenDiscountNote(DEEPSEEK_R1)).toContain('1/1.8')
    })

    test('a model dearer than Sol says so rather than implying a discount', () => {
        const note = formatTokenDiscountNote('openrouter:anthropic/claude-opus-4.7-fast', {
            upstreamPrice: { input: 30, cachedInput: 3, output: 150 },
        })
        expect(note).toContain('x the Sol rate')
        expect(note).not.toContain('1/')
    })

    // The quoted number must be the billed number, so the note prefers the rate frozen on the job
    // rather than independently re-deriving one that could differ.
    test('the note quotes the persisted rate, not a second derivation of it', () => {
        expect(formatTokenDiscountNote(SOL, { tokensPerGold: 2500 })).toContain('1/25')
        expect(formatTokenDiscountNote(DEEPSEEK_PRO, { tokensPerGold: BASE_VM_TOKENS_PER_GOLD })).toBe('')
    })
})
