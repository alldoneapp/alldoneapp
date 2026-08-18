'use strict'

const {
    buildOpenAiPromptCacheKey,
    getCachedEnvFunctions,
    getModel,
    logOpenAiCacheUsage,
} = require('../../Assistant/assistantHelper')
const { resolveClassifierClient } = require('../../Assistant/classifierModelClient')

// Default model for composing email replies; users can override it per account in Settings →
// Customizations (featureModelPreferences.emailDraftReply). The MODEL_ key is what the Gold
// metering (calculateGoldCostFromTokens) expects; the upstream id is derived per provider.
const REPLY_MODEL_KEY = 'MODEL_GPT5_4_MINI'

const REPLY_SYSTEM_PROMPT =
    'You draft concise, professional email replies on behalf of the user. Return ONLY the reply body text — no subject line, no quoted original message, no "Dear"/signature placeholders unless clearly warranted. Match the tone and language of the original message, keep it natural and human, and do not invent facts or commitments the user did not ask for.'

function hasText(value) {
    return typeof value === 'string' && value.trim()
}

function buildUserContent({ context = {}, guidance, language, groundingContext = {} }) {
    const parts = [
        'Original email to reply to:',
        `From: ${context.from || 'unknown'}`,
        `Subject: ${context.subject || '(no subject)'}`,
        `Body:\n${context.body || context.snippet || '(no body available)'}`,
    ]
    if (
        hasText(groundingContext.globalUserDescription) ||
        hasText(groundingContext.projectUserDescription) ||
        hasText(groundingContext.projectDescription)
    ) {
        parts.push(
            '\nUser and project context for tone, preferences, and business background. Use this context only when it helps the reply; do not invent facts, promises, dates, or commitments from it.'
        )
        if (hasText(groundingContext.userName)) parts.push(`User: ${groundingContext.userName.trim()}`)
        if (hasText(groundingContext.globalUserDescription)) {
            parts.push(`Global user description:\n${groundingContext.globalUserDescription.trim()}`)
        }
        if (hasText(groundingContext.projectName)) parts.push(`Project: ${groundingContext.projectName.trim()}`)
        if (hasText(groundingContext.projectUserDescription)) {
            parts.push(`Project-specific user description:\n${groundingContext.projectUserDescription.trim()}`)
        }
        if (hasText(groundingContext.projectDescription)) {
            parts.push(`Project description:\n${groundingContext.projectDescription.trim()}`)
        }
    }
    if (guidance && guidance.trim()) {
        parts.push(`\nThe user's guidance for the reply (follow it):\n${guidance.trim()}`)
    } else {
        parts.push('\nWrite an appropriate, helpful reply.')
    }
    parts.push(
        '\nDetect the language of the original email and write the reply in that same language. If the email mixes languages, use the main language of the sender message being answered. Do not default to the user app language.'
    )
    if (language) parts.push(`User app language for background context only: ${language}.`)
    parts.push('\nReturn only the reply body text.')
    return parts.join('\n')
}

// Returns { body, totalTokens, modelKey }. The caller must bill against the returned modelKey —
// it is the model that actually ran. Throws when the required provider key is unavailable.
async function composeReply({
    context,
    guidance,
    language,
    groundingContext,
    cacheScope = '',
    modelKey = REPLY_MODEL_KEY,
} = {}) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('OpenAI key unavailable for reply composition')
    const { client, model, isOpenRouter } = resolveClassifierClient(modelKey, {
        openAiKey,
        openRouterKey: envFunctions?.OPENROUTER_API_KEY,
    })
    const upstreamModel = isOpenRouter ? model : getModel(modelKey)

    const request = {
        model: upstreamModel,
        messages: [
            { role: 'system', content: REPLY_SYSTEM_PROMPT },
            { role: 'user', content: buildUserContent({ context, guidance, language, groundingContext }) },
        ],
    }
    // prompt_cache_key is an OpenAI extension; other providers reject or ignore it.
    const promptCacheKey = isOpenRouter
        ? null
        : buildOpenAiPromptCacheKey('email-reply', upstreamModel, cacheScope, REPLY_SYSTEM_PROMPT)
    if (promptCacheKey) request.prompt_cache_key = promptCacheKey

    const completion = await client.chat.completions.create(request)
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: 'email-reply-composer',
        model: upstreamModel,
        cacheKey: promptCacheKey || undefined,
    })

    const body = completion?.choices?.[0]?.message?.content?.trim() || ''
    const totalTokens = Number.isFinite(completion?.usage?.total_tokens) ? completion.usage.total_tokens : 0
    return { body, totalTokens, modelKey }
}

module.exports = {
    composeReply,
    buildUserContent,
    REPLY_MODEL_KEY,
}
