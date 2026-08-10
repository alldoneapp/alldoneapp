/**
 * Provider-aware client resolution for the labeling classifiers (AT-2238).
 *
 * Gmail labeling and calendar project routing both drive their model through
 * `openai.chat.completions.create`. That is a lucky accident of history and it is what makes adding
 * an OpenRouter model to them cheap: OpenRouter *is* an OpenAI-compatible Chat Completions endpoint,
 * so the request body needs no translation at all — only the client (base URL + key) and a couple of
 * OpenAI-proprietary request fields differ.
 *
 * This module is that difference, in one place, so the two classifiers cannot drift. They already
 * carry byte-identical hand-copied `mapAssistantModelToOpenAIModel` functions; adding a second
 * hand-copied provider decision on top of that is precisely how a model ends up working in email
 * labeling and silently falling back to `gpt-5.2` in calendar labeling.
 *
 * `getOpenAIClient` is required lazily from `assistantHelper` because that module is ~13k lines and
 * pulls firebase-admin in behind it; the OpenRouter path must not pay for that.
 */

const { resolveAssistantModelProvider, PROVIDER_OPENROUTER } = require('./assistantModelRouting')
const { getOpenRouterClient } = require('./openRouterChatClient')

/**
 * The client and upstream model id for a classifier model key.
 *
 * `model` is `null` for OpenAI, deliberately: each classifier keeps its own key→OpenAI-id mapper and
 * this module does not duplicate it (see `assistantModelRouting`'s header). `isOpenRouter` is what
 * callers gate OpenAI-proprietary request fields on — `prompt_cache_key` and `prompt_cache_options`
 * are OpenAI extensions, and sending them to another provider is at best ignored and at worst a 400.
 */
function resolveClassifierClient(modelKey, { openAiKey, openRouterKey } = {}) {
    const route = resolveAssistantModelProvider(modelKey)

    if (route.provider === PROVIDER_OPENROUTER) {
        if (!openRouterKey) {
            throw new Error(
                `OPENROUTER_API_KEY is not configured, but the labeling model "${route.modelKey}" requires it.`
            )
        }
        return { client: getOpenRouterClient(openRouterKey), model: route.model, isOpenRouter: true }
    }

    const { getOpenAIClient } = require('./assistantHelper')
    return { client: getOpenAIClient(openAiKey), model: null, isOpenRouter: false }
}

module.exports = { resolveClassifierClient }
