/**
 * What every caller of a model needs, and nothing else: the cached environment, the OpenAI client,
 * the model keys with their ids and Gold rates, and the prompt-cache key and usage log.
 *
 * These lived in `assistantHelper.js`, which is why 15 modules that only wanted one of them
 * (a classifier asking for the client, a router pricing its tokens) imported that file, and with it
 * the whole assistant: tools, prompts, the menubar app, the Gmail sync. `assistantHelper.js` sits in
 * an import cycle of 30 modules, so whoever imports it loads all of them, and the deploy selection
 * (`ci/selectFunctionsDeployment.js`) redeploys every function that does on any change to any of
 * them. In 2026-11 that was 89 functions, among them Firestore triggers for notes, tasks, goals and
 * contacts and the WhatsApp webhooks, which have no part in an assistant run.
 *
 * So this module must stay free of `assistantHelper` and of anything that leads back to it. It
 * requires only modules that require nothing local themselves; `assistantModelRuntime.test.js`
 * holds that. `assistantHelper.js` imports everything here and exports it again under the old
 * names, so its other importers and its own code are unchanged. New code that needs only what is
 * in here should import this file.
 */
const crypto = require('crypto')
const OpenAI = require('openai')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { MODEL_DEEPSEEK_V4_FLASH, getOpenRouterAssistantModelId } = require('./assistantModelRouting')
const { getAssistantModelTokensPerGold } = require('./selectableAssistantModels')

const MODEL_GPT3_5 = 'MODEL_GPT3_5'
const MODEL_GPT4 = 'MODEL_GPT4'
const MODEL_GPT4O = 'MODEL_GPT4O'
const MODEL_GPT5 = 'MODEL_GPT5' // Deprecated, maps to MODEL_GPT5_1
const MODEL_GPT5_1 = 'MODEL_GPT5_1'
const MODEL_GPT5_5 = 'MODEL_GPT5_5'
const MODEL_GPT6_SOL = 'MODEL_GPT6_SOL'
const MODEL_GPT5_6_TERRA = 'MODEL_GPT5_6_TERRA'
const MODEL_GPT6_LUNA = 'MODEL_GPT6_LUNA'
const MODEL_GPT5_4_MINI = 'MODEL_GPT5_4_MINI'
const MODEL_GPT5_4_NANO = 'MODEL_GPT5_4_NANO'
const MODEL_GPT5_2 = 'MODEL_GPT5_2'
const MODEL_SONAR = 'MODEL_SONAR'
const MODEL_SONAR_PRO = 'MODEL_SONAR_PRO'
const MODEL_SONAR_REASONING = 'MODEL_SONAR_REASONING'
const MODEL_SONAR_REASONING_PRO = 'MODEL_SONAR_REASONING_PRO'
const MODEL_SONAR_DEEP_RESEARCH = 'MODEL_SONAR_DEEP_RESEARCH'
const OPENAI_INPUT_TOKEN_ALERT_THRESHOLD = 180000
const OPENAI_INPUT_TOKEN_TARGET_CEILING = 200000

// Cache environment variables at module level (performance optimization)
let cachedEnvFunctions = null
let envLoadTime = 0

function getCachedEnvFunctions() {
    const now = Date.now()
    // Cache for 5 minutes
    if (!cachedEnvFunctions || now - envLoadTime > 300000) {
        cachedEnvFunctions = getEnvFunctions()
        envLoadTime = now
    }
    return cachedEnvFunctions
}

// Cache OpenAI clients (performance optimization)
const openAIClients = new Map()

function getOpenAIClient(apiKey) {
    if (!openAIClients.has(apiKey)) {
        openAIClients.set(apiKey, new OpenAI({ apiKey }))
    }
    return openAIClients.get(apiKey)
}

// Normalize model key for backward compatibility
const normalizeModelKey = modelKey => {
    // Map deprecated MODEL_GPT5 to MODEL_GPT5_1
    if (modelKey === MODEL_GPT5 || modelKey === 'MODEL_GPT5') return MODEL_GPT5_1
    // Map deprecated MODEL_GPT5_4 to MODEL_GPT5_5
    if (modelKey === 'MODEL_GPT5_4') return MODEL_GPT5_5
    // Existing assistant settings follow the replacement models without a Firestore migration.
    if (modelKey === 'MODEL_GPT5_6_SOL') return MODEL_GPT6_SOL
    if (modelKey === 'MODEL_GPT5_6_LUNA') return MODEL_GPT6_LUNA
    // Default to GPT-6 Sol if no model is specified.
    if (!modelKey) return MODEL_GPT6_SOL
    return modelKey
}

const getModel = modelKey => {
    // Normalize the model key first
    const normalizedKey = normalizeModelKey(modelKey)

    if (normalizedKey === MODEL_GPT3_5) return 'gpt-3.5-turbo'
    if (normalizedKey === MODEL_GPT4) return 'gpt-4'
    if (normalizedKey === MODEL_GPT4O) return 'gpt-4o'
    if (normalizedKey === MODEL_GPT5_1) return 'gpt-5.1'
    if (normalizedKey === MODEL_GPT5_5) return 'gpt-5.5'
    if (normalizedKey === MODEL_GPT6_SOL) return 'gpt-6.1-sol'
    if (normalizedKey === MODEL_GPT5_6_TERRA) return 'gpt-5.6-terra'
    if (normalizedKey === MODEL_GPT6_LUNA) return 'gpt-6-luna'
    if (normalizedKey === MODEL_GPT5_4_MINI) return 'gpt-5.4-mini'
    if (normalizedKey === MODEL_GPT5_4_NANO) return 'gpt-5.4-nano'
    if (normalizedKey === MODEL_GPT5_2) return 'gpt-5.2'
    // Served through OpenRouter, so the id comes from the shared routing table rather than being
    // spelled out again here — one place to bump when DeepSeek ships the next Flash release.
    if (normalizedKey === MODEL_DEEPSEEK_V4_FLASH) return getOpenRouterAssistantModelId(normalizedKey)
    if (normalizedKey === MODEL_SONAR) return 'sonar'
    if (normalizedKey === MODEL_SONAR_PRO) return 'sonar-pro'
    if (normalizedKey === MODEL_SONAR_REASONING) return 'sonar-reasoning'
    if (normalizedKey === MODEL_SONAR_REASONING_PRO) return 'sonar-reasoning-pro'
    if (normalizedKey === MODEL_SONAR_DEEP_RESEARCH) return 'sonar-deep-research'

    // Default fallback to the explicit GPT-6 Sol tier.
    return 'gpt-6.1-sol'
}

const getTokensPerGold = modelKey => {
    modelKey = normalizeModelKey(modelKey)
    // The shared selectable-model list is also the pricing authority for every model exposed in the
    // UI. That keeps assistant, heartbeat, scheduled-task, Gmail and calendar pickers identical to
    // what this billing path actually charges.
    const selectableRate = getAssistantModelTokensPerGold(modelKey)
    if (selectableRate) return selectableRate

    if (modelKey === MODEL_GPT3_5) return 100
    if (modelKey === MODEL_GPT4) return 100
    if (modelKey === MODEL_GPT4O) return 100
    if (modelKey === MODEL_GPT5_1) return 100
    if (modelKey === MODEL_GPT5_5) return 100
    // GPT-5.4 mini is 30% of GPT-5.4 pricing for both input and output tokens,
    // so preserve the existing gold baseline and scale mini proportionally.
    if (modelKey === MODEL_GPT5_4_MINI) return 333
    // GPT-5.4 nano is ~8.0% of GPT-5.4 input pricing and ~8.33% of output pricing.
    // Our Gold accounting only sees totalTokens, so use a conservative blended rate.
    if (modelKey === MODEL_GPT5_4_NANO) return 1200
    if (modelKey === MODEL_GPT5_2) return 100
    if (modelKey === MODEL_SONAR) return 100
    if (modelKey === MODEL_SONAR_PRO) return 50
    if (modelKey === MODEL_SONAR_REASONING) return 20
    if (modelKey === MODEL_SONAR_REASONING_PRO) return 15
    if (modelKey === MODEL_SONAR_DEEP_RESEARCH) return 10
}

const calculateGoldCostFromTokens = (totalTokens, model) => {
    const tokensPerGold = getTokensPerGold(model)
    if (!tokensPerGold || !Number.isFinite(totalTokens)) return 0
    return Math.round(totalTokens / tokensPerGold)
}

function buildOpenAiPromptCacheKey(scope, ...parts) {
    const normalizedScope = String(scope || 'openai')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .slice(0, 20)
    const digest = crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40)
    return `${normalizedScope}-${digest}`
}

function getOpenAiCacheUsage(usage = {}) {
    const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {}
    const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens) || 0
    const cachedTokens = Number(inputDetails.cached_tokens) || 0
    const cacheWriteTokens = Number(inputDetails.cache_write_tokens ?? inputDetails.cache_creation_input_tokens) || 0
    return {
        inputTokens,
        cachedTokens,
        cacheWriteTokens,
        uncachedInputTokens: Math.max(0, inputTokens - cachedTokens),
        cacheReadRate: inputTokens > 0 ? Number((cachedTokens / inputTokens).toFixed(4)) : 0,
    }
}

function logOpenAiCacheUsage({
    usage,
    route = 'unknown',
    model = '',
    cacheKey = '',
    cacheMode = '',
    serviceTier = 'default',
} = {}) {
    if (!usage) return null
    const cacheUsage = getOpenAiCacheUsage(usage)
    const cacheKeyFingerprint = cacheKey
        ? crypto.createHash('sha256').update(String(cacheKey)).digest('hex').slice(0, 12)
        : ''
    console.log('📊 OPENAI CACHE: Request usage', {
        route,
        model,
        hasCacheKey: !!cacheKey,
        cacheKeyFingerprint,
        cacheMode: cacheMode || 'automatic',
        ...cacheUsage,
        ...(model === 'gpt-6.1-sol'
            ? { pricing: require('./solModelPricing').getSolRequestCost(usage, serviceTier) }
            : {}),
    })
    if (cacheUsage.inputTokens >= OPENAI_INPUT_TOKEN_ALERT_THRESHOLD) {
        console.warn('🚨 OPENAI INPUT TOKEN ALERT: Request approaching 200K input tokens', {
            route,
            model,
            inputTokens: cacheUsage.inputTokens,
            cachedTokens: cacheUsage.cachedTokens,
            uncachedInputTokens: cacheUsage.uncachedInputTokens,
            alertThreshold: OPENAI_INPUT_TOKEN_ALERT_THRESHOLD,
            targetCeiling: OPENAI_INPUT_TOKEN_TARGET_CEILING,
        })
    }
    return cacheUsage
}

module.exports = {
    MODEL_GPT3_5,
    MODEL_GPT4,
    MODEL_GPT4O,
    MODEL_GPT5,
    MODEL_GPT5_1,
    MODEL_GPT5_5,
    MODEL_GPT6_SOL,
    MODEL_GPT5_6_TERRA,
    MODEL_GPT6_LUNA,
    MODEL_GPT5_4_MINI,
    MODEL_GPT5_4_NANO,
    MODEL_GPT5_2,
    MODEL_SONAR,
    MODEL_SONAR_PRO,
    MODEL_SONAR_REASONING,
    MODEL_SONAR_REASONING_PRO,
    MODEL_SONAR_DEEP_RESEARCH,
    OPENAI_INPUT_TOKEN_ALERT_THRESHOLD,
    OPENAI_INPUT_TOKEN_TARGET_CEILING,
    getCachedEnvFunctions,
    getOpenAIClient,
    normalizeModelKey,
    getModel,
    getTokensPerGold,
    calculateGoldCostFromTokens,
    buildOpenAiPromptCacheKey,
    getOpenAiCacheUsage,
    logOpenAiCacheUsage,
}
