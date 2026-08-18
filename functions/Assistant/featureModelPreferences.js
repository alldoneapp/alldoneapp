'use strict'

/**
 * Per-user model preferences for one-shot AI features (AT-2238 family).
 *
 * Several product features run a single LLM completion outside any assistant conversation —
 * rambler dictation cleanup, email draft replies, email→task summaries, automatic task→goal
 * routing. Their models used to be hardcoded per call site; they are now user preferences stored
 * as a map on the user doc (`users/{uid}.featureModelPreferences = { rambler: 'MODEL_…', … }`),
 * with a per-feature default. The picker offers the same selectable product menu as every other
 * model choice in the app (`selectableAssistantModels.js`), so billing rates are always defined.
 *
 * Resolution fails safe: any stored value that is not a currently-valid choice for that feature —
 * unknown key, retired model, or an OpenRouter model for a Responses-API-only feature — resolves
 * to the feature default rather than erroring or falling through to a surprise model (the
 * calendar-routing lesson: never trust a stored model string).
 *
 * Dependency-light on purpose (only the two dependency-free model modules), so classifiers and
 * email helpers can require it without pulling the 13k-line assistantHelper into their graph.
 */

const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')
const { isOpenRouterAssistantModel } = require('./assistantModelRouting')

const FEATURE_MODEL_PREFERENCES_FIELD = 'featureModelPreferences'

const FEATURE_MODEL_FEATURES = {
    rambler: { defaultModelKey: 'MODEL_GPT5_6_LUNA' },
    emailDraftReply: { defaultModelKey: 'MODEL_GPT5_4_MINI' },
    emailTaskSummary: { defaultModelKey: 'MODEL_GPT5_4_NANO' },
    // Runs on the OpenAI Responses API (strict JSON schema + reasoning effort), which OpenRouter
    // does not serve — Chat Completions only. OpenRouter models are therefore not valid here.
    taskGoalRouting: { defaultModelKey: 'MODEL_GPT5_6_LUNA', openAiOnly: true },
}

// Display info for feature DEFAULT models that are not part of the selectable product menu (the
// email defaults are deliberately cheaper than any menu entry). tokensPerGold mirrors
// assistantHelper.getTokensPerGold for these keys — display only, billing reads the real table.
const NON_SELECTABLE_MODEL_INFO = {
    MODEL_GPT5_4_MINI: { name: 'GPT-5.4 Mini', tokensPerGold: 333 },
    MODEL_GPT5_4_NANO: { name: 'GPT-5.4 Nano', tokensPerGold: 1200 },
}

// { name, tokensPerGold } for any key a feature default or picker can reference; null when unknown.
function getFeatureModelOptionInfo(modelKey) {
    const selectable = SELECTABLE_ASSISTANT_MODELS.find(option => option.model === modelKey)
    if (selectable) return { name: selectable.name, tokensPerGold: selectable.tokensPerGold }
    return NON_SELECTABLE_MODEL_INFO[modelKey] || null
}

function isSelectableAssistantModelKey(modelKey) {
    return SELECTABLE_ASSISTANT_MODELS.some(option => option.model === modelKey)
}

function isValidFeatureModelChoice(featureKey, modelKey) {
    const feature = FEATURE_MODEL_FEATURES[featureKey]
    if (!feature) return false
    if (!isSelectableAssistantModelKey(modelKey)) return false
    if (feature.openAiOnly && isOpenRouterAssistantModel(modelKey)) return false
    return true
}

// The model key a one-shot feature runs on for this user: their stored preference when it is a
// valid choice for the feature, else the feature default. An unknown featureKey throws — that is
// a programmer error, not a data state.
function resolveFeatureModelKey(featureKey, userData) {
    const feature = FEATURE_MODEL_FEATURES[featureKey]
    if (!feature) throw new Error(`Unknown feature model key: ${featureKey}`)
    const stored = userData?.[FEATURE_MODEL_PREFERENCES_FIELD]?.[featureKey]
    return isValidFeatureModelChoice(featureKey, stored) ? stored : feature.defaultModelKey
}

module.exports = {
    FEATURE_MODEL_PREFERENCES_FIELD,
    FEATURE_MODEL_FEATURES,
    getFeatureModelOptionInfo,
    isSelectableAssistantModelKey,
    isValidFeatureModelChoice,
    resolveFeatureModelKey,
}
