'use strict'

const { getCachedEnvFunctions, getOpenAIClient } = require('../../Assistant/assistantHelper')

// Model used to compose email replies. The MODEL_ key is what the Gold metering
// (calculateGoldCostFromTokens) expects; the OpenAI id is what the API needs.
const REPLY_MODEL_KEY = 'MODEL_GPT5_4_MINI'
const REPLY_OPENAI_MODEL = 'gpt-5.4-mini'

const REPLY_SYSTEM_PROMPT =
    'You draft concise, professional email replies on behalf of the user. Return ONLY the reply body text — no subject line, no quoted original message, no "Dear"/signature placeholders unless clearly warranted. Match the tone and language of the original message, keep it natural and human, and do not invent facts or commitments the user did not ask for.'

function buildUserContent({ context = {}, guidance, language }) {
    const parts = [
        'Original email to reply to:',
        `From: ${context.from || 'unknown'}`,
        `Subject: ${context.subject || '(no subject)'}`,
        `Body:\n${context.body || context.snippet || '(no body available)'}`,
    ]
    if (guidance && guidance.trim()) {
        parts.push(`\nThe user's guidance for the reply (follow it):\n${guidance.trim()}`)
    } else {
        parts.push('\nWrite an appropriate, helpful reply.')
    }
    if (language) parts.push(`\nWrite the reply in this language: ${language}.`)
    parts.push('\nReturn only the reply body text.')
    return parts.join('\n')
}

// Returns { body, totalTokens }. Throws when the OpenAI key is unavailable.
async function composeReply({ context, guidance, language } = {}) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('OpenAI key unavailable for reply composition')

    const openai = getOpenAIClient(openAiKey)
    const completion = await openai.chat.completions.create({
        model: REPLY_OPENAI_MODEL,
        messages: [
            { role: 'system', content: REPLY_SYSTEM_PROMPT },
            { role: 'user', content: buildUserContent({ context, guidance, language }) },
        ],
    })

    const body = completion?.choices?.[0]?.message?.content?.trim() || ''
    const totalTokens = Number.isFinite(completion?.usage?.total_tokens) ? completion.usage.total_tokens : 0
    return { body, totalTokens }
}

module.exports = {
    composeReply,
    buildUserContent,
    REPLY_MODEL_KEY,
    REPLY_OPENAI_MODEL,
}
