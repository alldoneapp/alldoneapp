/**
 * Provider routing for in-app assistant models (AT-2238).
 *
 * ## The problem this solves
 *
 * Until now every assistant model was an OpenAI model, so "which provider" was never a question
 * anyone had to ask — the one exception, Perplexity, was handled by an inline
 * `modelKey.startsWith('MODEL_SONAR')` check at the single call site that cared. Adding a DeepSeek
 * model served through OpenRouter makes provider selection a real, repeated question, asked from at
 * least four places that must all answer it identically:
 *
 *   - `assistantHelper.interactWithChatStream`      (normal chat, heartbeats, background runs)
 *   - `Gmail/gmailPromptClassifier`                 (email labeling)
 *   - `GoogleCalendar/calendarProjectClassifier`    (calendar project routing)
 *   - `Assistant/delegationToolDescriptionHelper`   (delegation descriptions)
 *
 * Those last three already carry hand-copied `mapAssistantModelToOpenAIModel` functions that drifted
 * apart (two are byte-identical, one silently lacks Terra/Luna). Adding a fifth copy of a
 * *provider* decision on top of that drift is how a model ends up working in chat and silently
 * falling back to `gpt-5.2` in labeling. So the provider question gets exactly one answer, here.
 *
 * ## Why the model key stays opaque and the id lives in a table
 *
 * The VM harness solved its equivalent problem by encoding the source into the model string
 * (`openrouter:deepseek/...`, see `vmModelRouting.js`), because there the user picks from a live
 * catalog of hundreds of models and no table could keep up. The in-app assistant is the opposite
 * case: it offers a short, curated, product-named list (`MODEL_GPT5_6_SOL`, `MODEL_DEEPSEEK_V4_FLASH`)
 * whose keys are already persisted on assistant docs, Gmail configs and calendar configs. Those keys
 * must keep meaning what they mean, so the mapping stays a table and the key stays opaque.
 *
 * That difference is also what lets the upstream id be swapped without a migration: when DeepSeek
 * ships the next Flash release, `OPENROUTER_ASSISTANT_MODEL_IDS` changes on one line and every
 * stored `MODEL_DEEPSEEK_V4_FLASH` follows it.
 *
 * ## Why the OpenAI branch returns no model id
 *
 * `resolveAssistantModelProvider` deliberately answers only "which provider", never "which OpenAI
 * id". The OpenAI id mapping lives in `assistantHelper.getModel`, and having this module reach for
 * it would make `assistantHelper` → this module → `assistantHelper` a require cycle. Callers already
 * have their own OpenAI mapper; they only need to be told when *not* to use it.
 *
 * Dependency-free on purpose, so the Gmail and Calendar classifiers can require it without pulling
 * the 13k-line `assistantHelper` (and firebase-admin behind it) into their module graph.
 */

/** Product key for DeepSeek V4 Flash, served through OpenRouter. */
const MODEL_DEEPSEEK_V4_FLASH = 'MODEL_DEEPSEEK_V4_FLASH'

/**
 * Product key → OpenRouter model id.
 *
 * `deepseek/deepseek-v4-flash-0731` is the pinned dated release (canonical slug
 * `deepseek/deepseek-v4-flash-20260731`), verified against `GET https://openrouter.ai/api/v1/models`
 * on 2026-08-10: 1M context, `tools` + `structured_outputs` in `supported_parameters`.
 *
 * Pinned rather than floating on purpose. OpenRouter does publish an auto-following alias
 * (`~deepseek/deepseek-v4-flash-latest`), but it would swap the model under live assistants,
 * heartbeats and labeling configs with no review of the quality or pricing change — and its `~`
 * prefix is not a legal `vendor/model` id anywhere else in this codebase. A new Flash release is a
 * one-line bump here instead.
 */
const OPENROUTER_ASSISTANT_MODEL_IDS = Object.freeze({
    [MODEL_DEEPSEEK_V4_FLASH]: 'deepseek/deepseek-v4-flash-0731',
})

/**
 * Product key → whether the upstream model accepts image input.
 *
 * Modality lives next to the pinned id because it is a fact about that exact upstream release, not
 * about the product name: `deepseek/deepseek-v4-flash-0731` reports `input_modalities: ['text']`,
 * and a future Flash release could report otherwise. An unlisted OpenRouter model is treated as
 * text-only, which is the safe direction — a stripped image degrades to a placeholder the model can
 * explain, while sending an image to a text-only model fails the entire request.
 */
const OPENROUTER_ASSISTANT_MODEL_IMAGE_SUPPORT = Object.freeze({
    [MODEL_DEEPSEEK_V4_FLASH]: false,
})

const PROVIDER_OPENAI = 'openai'
const PROVIDER_OPENROUTER = 'openrouter'
const PROVIDER_PERPLEXITY = 'perplexity'

/** Perplexity keys are a family rather than a fixed list, matching the existing runtime check. */
const PERPLEXITY_MODEL_KEY_PREFIX = 'MODEL_SONAR'

function normalizeKey(modelKey) {
    return typeof modelKey === 'string' ? modelKey.trim() : ''
}

/** True when the key names a model this app serves through OpenRouter. */
function isOpenRouterAssistantModel(modelKey) {
    return Object.prototype.hasOwnProperty.call(OPENROUTER_ASSISTANT_MODEL_IDS, normalizeKey(modelKey))
}

/**
 * The upstream OpenRouter id for a key, or `null` when the key is not an OpenRouter model.
 *
 * Returning `null` rather than a fallback id is deliberate: a caller that mistakenly asks for a
 * non-OpenRouter key must get an obvious nothing, not a plausible wrong model.
 */
function getOpenRouterAssistantModelId(modelKey) {
    return OPENROUTER_ASSISTANT_MODEL_IDS[normalizeKey(modelKey)] || null
}

function isPerplexityAssistantModel(modelKey) {
    return normalizeKey(modelKey).startsWith(PERPLEXITY_MODEL_KEY_PREFIX)
}

/**
 * The single question every call site asks: which upstream serves this model key?
 *
 * `model` is the ready-to-send upstream id for OpenRouter, and `null` for OpenAI and Perplexity —
 * those two have their own key→id mappers (`assistantHelper.getModel`), and duplicating them here
 * is exactly the drift this module exists to stop.
 *
 * An unknown key resolves to OpenAI, which is the pre-AT-2238 behaviour: it then flows into the
 * existing `getModel` fallback (`gpt-5.6-sol`) rather than failing the run.
 */
/**
 * Whether a model key can be sent image parts.
 *
 * Consulted by the OpenRouter transport, which must otherwise choose between failing the request
 * and silently dropping the image. The OpenAI answer is `true` because every model reachable
 * through the selectable list and the Responses path is multimodal; Perplexity's Sonar family is
 * text-only.
 */
function assistantModelSupportsImageInput(modelKey) {
    const key = normalizeKey(modelKey)

    if (isOpenRouterAssistantModel(key)) return OPENROUTER_ASSISTANT_MODEL_IMAGE_SUPPORT[key] === true
    if (isPerplexityAssistantModel(key)) return false

    return true
}

function resolveAssistantModelProvider(modelKey) {
    const key = normalizeKey(modelKey)

    const openRouterModel = getOpenRouterAssistantModelId(key)
    if (openRouterModel) return { provider: PROVIDER_OPENROUTER, model: openRouterModel, modelKey: key }

    if (isPerplexityAssistantModel(key)) return { provider: PROVIDER_PERPLEXITY, model: null, modelKey: key }

    return { provider: PROVIDER_OPENAI, model: null, modelKey: key }
}

module.exports = {
    MODEL_DEEPSEEK_V4_FLASH,
    OPENROUTER_ASSISTANT_MODEL_IDS,
    OPENROUTER_ASSISTANT_MODEL_IMAGE_SUPPORT,
    PROVIDER_OPENAI,
    PROVIDER_OPENROUTER,
    PROVIDER_PERPLEXITY,
    isOpenRouterAssistantModel,
    isPerplexityAssistantModel,
    getOpenRouterAssistantModelId,
    assistantModelSupportsImageInput,
    resolveAssistantModelProvider,
}
