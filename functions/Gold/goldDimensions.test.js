'use strict'

const {
    KEY_SEPARATOR,
    MAX_KEY_SEGMENT_LENGTH,
    sanitizeStatsKeySegment,
    buildStatsDimensionKey,
    computeStatsDimensions,
} = require('./goldDimensions')

describe('goldDimensions.sanitizeStatsKeySegment', () => {
    test('leaves an already-safe slug untouched', () => {
        expect(sanitizeStatsKeySegment('vm_execution')).toBe('vm_execution')
        expect(sanitizeStatsKeySegment('opus')).toBe('opus')
    })

    // The two shapes that forced slugging: a Codex tier carries a dot, and an OpenRouter
    // selection carries a colon AND a solidus. Both would need backtick-quoted field paths
    // to read back out of the rollup map.
    test('slugs the characters real model ids actually contain', () => {
        expect(sanitizeStatsKeySegment('gpt-5.6-sol')).toBe('gpt-5-6-sol')
        expect(sanitizeStatsKeySegment('openrouter:deepseek/deepseek-v4-flash-0731')).toBe(
            'openrouter-deepseek-deepseek-v4-flash-0731'
        )
        expect(sanitizeStatsKeySegment('claude-opus-4-5-20260115')).toBe('claude-opus-4-5-20260115')
    })

    test('normalizes case, collapses separator runs and trims the edges', () => {
        expect(sanitizeStatsKeySegment('  GPT-5.6  ')).toBe('gpt-5-6')
        expect(sanitizeStatsKeySegment('a///b')).toBe('a-b')
        expect(sanitizeStatsKeySegment('--weird--')).toBe('weird')
    })

    test('bounds the segment so one absurd model id cannot blow the field-name limit', () => {
        expect(sanitizeStatsKeySegment('m'.repeat(500))).toHaveLength(MAX_KEY_SEGMENT_LENGTH)
    })

    test('returns empty for anything that cannot become a key', () => {
        expect(sanitizeStatsKeySegment('')).toBe('')
        expect(sanitizeStatsKeySegment('   ')).toBe('')
        expect(sanitizeStatsKeySegment('///')).toBe('')
        expect(sanitizeStatsKeySegment(null)).toBe('')
        expect(sanitizeStatsKeySegment(42)).toBe('')
    })
})

describe('goldDimensions.buildStatsDimensionKey', () => {
    test('scopes the value under its source', () => {
        expect(buildStatsDimensionKey('vm_execution', 'opus')).toBe(`vm_execution${KEY_SEPARATOR}opus`)
        expect(buildStatsDimensionKey('assistant_usage', 'gpt-5.2')).toBe('assistant_usage__gpt-5-2')
    })

    // Mirrors what computeStatsDeltas already does for spendBySource: a malformed source is
    // still counted, under `unknown`, rather than silently dropping the amount.
    test('falls back to an unknown source rather than dropping the dimension', () => {
        expect(buildStatsDimensionKey('', 'opus')).toBe('unknown__opus')
        expect(buildStatsDimensionKey(null, 'opus')).toBe('unknown__opus')
    })

    test('returns empty when the VALUE is unusable, because that is what makes it undeclared', () => {
        expect(buildStatsDimensionKey('vm_execution', '')).toBe('')
        expect(buildStatsDimensionKey('vm_execution', null)).toBe('')
    })
})

describe('goldDimensions.computeStatsDimensions', () => {
    test('emits both dimensions for a Gold-billed VM spend', () => {
        expect(
            computeStatsDimensions({ source: 'vm_execution', model: 'gpt-5.6-sol', billingExempt: false }, 'spend', 30)
        ).toEqual([
            { field: 'spendByBilling', key: 'vm_execution__billed', amount: 30 },
            { field: 'spendByModel', key: 'vm_execution__gpt-5-6-sol', amount: 30 },
        ])
    })

    // The case the whole task exists for: the run still spends Gold (base reserve + compute),
    // but its model tokens were paid for by the user's own subscription. Without this bucket a
    // drop in `spendBySource.vm_execution` is indistinguishable from a drop in usage.
    test('marks a subscription/BYOK VM run exempt while still counting its Gold', () => {
        expect(
            computeStatsDimensions({ source: 'vm_execution', model: 'opus', billingExempt: true }, 'spend', 20)
        ).toEqual([
            { field: 'spendByBilling', key: 'vm_execution__exempt', amount: 20 },
            { field: 'spendByModel', key: 'vm_execution__opus', amount: 20 },
        ])
    })

    test('uses the direction it is given, so refunds stay decomposable too', () => {
        expect(
            computeStatsDimensions({ source: 'vm_execution_refund', model: 'opus', billingExempt: true }, 'refund', 20)
        ).toEqual([
            { field: 'refundByBilling', key: 'vm_execution_refund__exempt', amount: 20 },
            { field: 'refundByModel', key: 'vm_execution_refund__opus', amount: 20 },
        ])
    })

    // billingExempt is a TRISTATE. A Gmail classification is always Gold-billed; there is no
    // exempt variant of it, so writing `billed` there would add a constant to every rollup doc
    // and imply a comparison that does not exist.
    test('omits an undeclared billing dimension instead of defaulting it to billed', () => {
        expect(computeStatsDimensions({ source: 'gmail_labeling', model: 'gpt-5.2' }, 'spend', 4)).toEqual([
            { field: 'spendByModel', key: 'gmail_labeling__gpt-5-2', amount: 4 },
        ])
        expect(
            computeStatsDimensions({ source: 'gmail_labeling', model: 'gpt-5.2', billingExempt: 'yes' }, 'spend', 4)
        ).toEqual([{ field: 'spendByModel', key: 'gmail_labeling__gpt-5-2', amount: 4 }])
    })

    test('a source with no model at all contributes nothing', () => {
        expect(computeStatsDimensions({ source: 'monthly_gold' }, 'earn', 100)).toEqual([])
        expect(computeStatsDimensions({ source: 'mcp_tool_call', model: '' }, 'spend', 1)).toEqual([])
    })

    test('refuses to emit without a usable direction or amount', () => {
        expect(computeStatsDimensions({ source: 'vm_execution', model: 'opus' }, '', 20)).toEqual([])
        expect(computeStatsDimensions({ source: 'vm_execution', model: 'opus' }, 'spend', NaN)).toEqual([])
    })
})
