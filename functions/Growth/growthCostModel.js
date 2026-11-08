'use strict'

// ESTIMATED upstream cost of spent Gold, in US dollars.
//
// Gold is priced so that one Gold buys roughly the same upstream spend whatever the model (the VM
// token rates are Sol-relative by construction, see vmTokenPricing.js), but not every Gold is a
// token: a VM minute pays for a sandbox, a game item for nothing. This module answers "what did
// this Gold cost us" from what a ledger entry records (source, model, billingExempt) using the
// existing rate authorities, and says on what basis it answered:
//
//   model_tokens   — tokens of a known model: Gold x tokens-per-Gold x blended upstream price
//   vm_infra       — a VM run on the user's own subscription/key: sandbox + runner minutes only
//   vm_conservative— a VM run Alldone paid tokens for: the higher of the minute and token cost,
//                    because a ledger entry does not say which of the two it paid for
//   source_default — anything else: the in-app assistant's Sol rate, the dearest common case
//   none           — no upstream cost (game items, goal unlocks)
//
// Pure: no Firestore, no network. Pinned by growthCostModel.test.js.

const {
    BASE_VM_TOKENS_PER_GOLD,
    SOL_BLENDED_USD_PER_MILLION,
    blendedUsdPerMillionTokens,
    resolveTokensPerGold,
    resolveUpstreamPrice,
} = require('../Assistant/vmTokenPricing')
const {
    SELECTABLE_ASSISTANT_MODELS,
    getAssistantModelTokensPerGold,
    normalizeSelectableAssistantModelKey,
} = require('../Assistant/selectableAssistantModels')
const { sanitizeStatsKeySegment } = require('../Gold/goldDimensions')
const {
    ASSISTANT_TOKEN_MIX,
    E2B_SANDBOX_USD_PER_MINUTE,
    VM_GOLD_PER_MINUTE,
    VM_GOLD_SOURCES,
    VM_RUNNER_USD_PER_MINUTE,
    ZERO_COST_GOLD_SOURCES,
} = require('./growthConfig')

// The in-app assistant's product keys and the upstream model each one runs on
// (assistantHelper.getModel / assistantModelRouting.js).
const ASSISTANT_MODEL_UPSTREAM = Object.freeze({
    MODEL_GPT6_SOL: 'gpt-6.1-sol',
    MODEL_GPT5_6_TERRA: 'gpt-5.6-terra',
    MODEL_GPT6_LUNA: 'gpt-6-luna',
    MODEL_DEEPSEEK_V4_FLASH: 'openrouter:deepseek/deepseek-v4-flash-0731',
})

const VM_INFRA_USD_PER_GOLD = (E2B_SANDBOX_USD_PER_MINUTE + VM_RUNNER_USD_PER_MINUTE) / VM_GOLD_PER_MINUTE
// What one VM token-Gold costs upstream by design: every VM token rate is derived from this anchor.
const VM_TOKEN_BASE_USD_PER_GOLD = (BASE_VM_TOKENS_PER_GOLD * SOL_BLENDED_USD_PER_MILLION) / 1e6

const blendWithMix = (price, mix) => {
    if (!price) return null
    const input = Number(price.input)
    const output = Number(price.output)
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null
    const cached = price.cachedInput == null ? input : Number(price.cachedInput)
    const total = mix.input + mix.cachedInput + mix.output
    return (
        (input * mix.input + (Number.isFinite(cached) ? cached : input) * mix.cachedInput + output * mix.output) / total
    )
}

function assistantTokenUsdPerGold(model) {
    if (typeof model !== 'string' || !model.trim()) return null
    const key = normalizeSelectableAssistantModelKey(model.trim())
    const upstream = ASSISTANT_MODEL_UPSTREAM[key]
    const tokensPerGold = getAssistantModelTokensPerGold(key)
    if (!upstream || !tokensPerGold) return null
    const blended = blendWithMix(resolveUpstreamPrice(upstream), ASSISTANT_TOKEN_MIX)
    return blended === null ? null : (tokensPerGold * blended) / 1e6
}

const SOL_ASSISTANT_USD_PER_GOLD = assistantTokenUsdPerGold('MODEL_GPT6_SOL')
const DEFAULT_USD_PER_GOLD = SOL_ASSISTANT_USD_PER_GOLD

function vmTokenUsdPerGold(model) {
    if (typeof model !== 'string' || !model.trim()) return VM_TOKEN_BASE_USD_PER_GOLD
    const blended = blendedUsdPerMillionTokens(resolveUpstreamPrice(model))
    if (blended === null) return VM_TOKEN_BASE_USD_PER_GOLD
    return (resolveTokensPerGold(model) * blended) / 1e6
}

// A refund carries its charge's source with a `_refund` suffix (vm_execution_refund).
const baseSource = source => {
    const value = typeof source === 'string' ? source.trim() : ''
    return value.endsWith('_refund') ? value.slice(0, -'_refund'.length) : value
}

function estimateUsdPerGold({ source, model, billingExempt } = {}) {
    const base = baseSource(source)
    if (ZERO_COST_GOLD_SOURCES.includes(base)) return { usdPerGold: 0, basis: 'none' }
    if (VM_GOLD_SOURCES.includes(base)) {
        if (billingExempt === true) return { usdPerGold: VM_INFRA_USD_PER_GOLD, basis: 'vm_infra' }
        return {
            usdPerGold: Math.max(VM_INFRA_USD_PER_GOLD, vmTokenUsdPerGold(model)),
            basis: 'vm_conservative',
        }
    }
    const tokenRate = assistantTokenUsdPerGold(model)
    if (tokenRate !== null) return { usdPerGold: tokenRate, basis: 'model_tokens' }
    return { usdPerGold: DEFAULT_USD_PER_GOLD, basis: 'source_default' }
}

// The cost of one ledger entry: a spend costs, a refund gives the cost back, everything else
// (earn, adjustment) is not consumption.
function estimateTransactionCostUsd(transaction = {}) {
    const amount = Number(transaction.amount)
    if (!Number.isFinite(amount) || amount <= 0) return 0
    const sign = transaction.direction === 'spend' ? 1 : transaction.direction === 'refund' ? -1 : 0
    if (sign === 0) return 0
    return sign * amount * estimateUsdPerGold(transaction).usdPerGold
}

// goldStats stores models slugged (goldDimensions.sanitizeStatsKeySegment); map the known keys back.
const MODEL_BY_SLUG = new Map(
    [...SELECTABLE_ASSISTANT_MODELS.map(option => option.model), 'MODEL_GPT5_6_SOL', 'MODEL_GPT5_6_LUNA'].map(model => [
        sanitizeStatsKeySegment(model),
        model,
    ])
)

// The same estimate for one day's rollup (goldStats/daily/days/{day}): per source, spent Gold minus
// refunded Gold, priced by model where the rollup records one and by billing route for VM runs.
function estimateRollupCostUsdBySource(rollup = {}) {
    const result = {}
    const add = (source, usd) => {
        if (!usd) return
        result[source] = (result[source] || 0) + usd
    }
    const priceDirection = (bySource, byModel, byBilling, sign) => {
        Object.entries(bySource || {}).forEach(([source, rawAmount]) => {
            const amount = Number(rawAmount) || 0
            if (amount <= 0) return
            const base = baseSource(source)
            if (VM_GOLD_SOURCES.includes(base)) {
                const exempt = Number((byBilling || {})[`${sanitizeStatsKeySegment(source)}__exempt`]) || 0
                const billed = Math.max(0, amount - exempt)
                add(base, sign * exempt * estimateUsdPerGold({ source, billingExempt: true }).usdPerGold)
                add(base, sign * billed * estimateUsdPerGold({ source, billingExempt: false }).usdPerGold)
                return
            }
            const prefix = `${sanitizeStatsKeySegment(source)}__`
            let priced = 0
            Object.entries(byModel || {}).forEach(([key, rawModelAmount]) => {
                if (!key.startsWith(prefix)) return
                const modelAmount = Number(rawModelAmount) || 0
                const model = MODEL_BY_SLUG.get(key.slice(prefix.length)) || ''
                add(base, sign * modelAmount * estimateUsdPerGold({ source, model }).usdPerGold)
                priced += modelAmount
            })
            const rest = Math.max(0, amount - priced)
            add(base, sign * rest * estimateUsdPerGold({ source }).usdPerGold)
        })
    }
    priceDirection(rollup.spendBySource, rollup.spendByModel, rollup.spendByBilling, 1)
    priceDirection(rollup.refundBySource, rollup.refundByModel, rollup.refundByBilling, -1)
    return result
}

// The figures the scoreboard prints under "What is estimated".
function describeCostRates() {
    return {
        vmInfraUsdPerGold: VM_INFRA_USD_PER_GOLD,
        vmTokenBaseUsdPerGold: VM_TOKEN_BASE_USD_PER_GOLD,
        assistantUsdPerGold: Object.fromEntries(
            Object.keys(ASSISTANT_MODEL_UPSTREAM).map(model => [model, assistantTokenUsdPerGold(model)])
        ),
        defaultUsdPerGold: DEFAULT_USD_PER_GOLD,
    }
}

module.exports = {
    ASSISTANT_MODEL_UPSTREAM,
    VM_INFRA_USD_PER_GOLD,
    VM_TOKEN_BASE_USD_PER_GOLD,
    DEFAULT_USD_PER_GOLD,
    estimateUsdPerGold,
    estimateTransactionCostUsd,
    estimateRollupCostUsdBySource,
    describeCostRates,
}
