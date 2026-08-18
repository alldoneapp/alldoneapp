'use strict'

const {
    buildOpenAiPromptCacheKey,
    getCachedEnvFunctions,
    getModel,
    logOpenAiCacheUsage,
} = require('../../Assistant/assistantHelper')
const { resolveClassifierClient } = require('../../Assistant/classifierModelClient')
const { resolveFeatureModelKey } = require('../../Assistant/featureModelPreferences')

// The model comes from the caller (the user's Settings → Customizations preference); with none
// given, the feature default from featureModelPreferences applies — no model is named here. The
// MODEL_ key is what the Gold metering expects; the upstream id is derived per provider.

const TASK_SUMMARY_SYSTEM_PROMPT =
    'You turn one email into a single actionable task title. Return ONLY one short sentence (at most 15 words) ' +
    'summarizing what the email is about, written so it works as a task name. No quotes, no trailing period, ' +
    'no "Email:" or "Task:" prefix. Mention the sender only when it matters for acting on the task.'

function buildUserContent({ context = {}, language }) {
    const parts = [
        'Email to summarize:',
        `From: ${context.from || 'unknown'}`,
        `Subject: ${context.subject || '(no subject)'}`,
        `Body:\n${context.body || context.snippet || '(no body available)'}`,
    ]
    if (language) parts.push(`\nWrite the task title in this language: ${language}.`)
    parts.push('\nReturn only the one-sentence task title.')
    return parts.join('\n')
}

// Returns { name, totalTokens, modelKey }. The caller must bill against the returned modelKey —
// it is the model that actually ran. Throws when the required provider key is unavailable.
async function summarizeEmailAsTaskName({ context, language, cacheScope = '', modelKey = null } = {}) {
    if (!modelKey) modelKey = resolveFeatureModelKey('emailTaskSummary', null)
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('OpenAI key unavailable for email task summarization')
    const { client, model, isOpenRouter } = resolveClassifierClient(modelKey, {
        openAiKey,
        openRouterKey: envFunctions?.OPENROUTER_API_KEY,
    })
    const upstreamModel = isOpenRouter ? model : getModel(modelKey)

    const request = {
        model: upstreamModel,
        messages: [
            { role: 'system', content: TASK_SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: buildUserContent({ context, language }) },
        ],
    }
    // prompt_cache_key is an OpenAI extension; other providers reject or ignore it.
    const promptCacheKey = isOpenRouter
        ? null
        : buildOpenAiPromptCacheKey('email-summary', upstreamModel, cacheScope, TASK_SUMMARY_SYSTEM_PROMPT)
    if (promptCacheKey) request.prompt_cache_key = promptCacheKey

    const completion = await client.chat.completions.create(request)
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: 'email-task-summarizer',
        model: upstreamModel,
        cacheKey: promptCacheKey || undefined,
    })

    const name = completion?.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || ''
    const totalTokens = Number.isFinite(completion?.usage?.total_tokens) ? completion.usage.total_tokens : 0
    return { name, totalTokens, modelKey }
}

module.exports = {
    summarizeEmailAsTaskName,
}
