'use strict'

const { getCachedEnvFunctions, getOpenAIClient } = require('../../Assistant/assistantHelper')

// Model used to summarize an email into a task title. The MODEL_ key is what the Gold
// metering (calculateGoldCostFromTokens) expects; the OpenAI id is what the API needs.
const TASK_SUMMARY_MODEL_KEY = 'MODEL_GPT5_4_NANO'
const TASK_SUMMARY_OPENAI_MODEL = 'gpt-5.4-nano'

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

// Returns { name, totalTokens }. Throws when the OpenAI key is unavailable.
async function summarizeEmailAsTaskName({ context, language } = {}) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('OpenAI key unavailable for email task summarization')

    const openai = getOpenAIClient(openAiKey)
    const completion = await openai.chat.completions.create({
        model: TASK_SUMMARY_OPENAI_MODEL,
        messages: [
            { role: 'system', content: TASK_SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: buildUserContent({ context, language }) },
        ],
    })

    const name = completion?.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || ''
    const totalTokens = Number.isFinite(completion?.usage?.total_tokens) ? completion.usage.total_tokens : 0
    return { name, totalTokens }
}

module.exports = {
    summarizeEmailAsTaskName,
    TASK_SUMMARY_MODEL_KEY,
    TASK_SUMMARY_OPENAI_MODEL,
}
