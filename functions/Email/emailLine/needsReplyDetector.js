'use strict'

const { getCachedEnvFunctions, getOpenAIClient } = require('../../Assistant/assistantHelper')

// Cheap model — this is a coarse binary classification over short snippets.
const NEEDS_REPLY_MODEL_KEY = 'MODEL_GPT5_4_NANO'
const NEEDS_REPLY_OPENAI_MODEL = 'gpt-5.4-nano'

const NEEDS_REPLY_SYSTEM_PROMPT =
    'You decide which emails likely need a personal reply from the recipient. An email needs a reply when it asks a question, requests an action or decision, or clearly expects a personal response. Emails that do NOT need a reply: newsletters, marketing/promotions, notifications, automated receipts, confirmations, no-reply senders, and purely informational updates. Return STRICT JSON only, of the form {"needsReply":["id1","id2"]}, listing only the ids that need a reply. Never invent ids.'

function extractJson(text = '') {
    if (!text || typeof text !== 'string') return null
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)
    if (fenced) {
        try {
            return JSON.parse(fenced[1])
        } catch (error) {}
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
        try {
            return JSON.parse(text.slice(start, end + 1))
        } catch (error) {}
    }
    return null
}

// messages: [{ messageId, from, subject, snippet }]
// Returns { flagsByMessageId: { id: true }, totalTokens }. Never throws on
// malformed model output (flags nothing instead).
async function detectNeedsReply(messages = []) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { flagsByMessageId: {}, totalTokens: 0 }
    }

    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) return { flagsByMessageId: {}, totalTokens: 0 }

    const validIds = new Set(messages.map(message => message.messageId))
    const payload = messages.map(message => ({
        id: message.messageId,
        from: message.from || '',
        subject: message.subject || '',
        snippet: String(message.snippet || '').slice(0, 300),
    }))

    const openai = getOpenAIClient(openAiKey)
    let completion
    try {
        completion = await openai.chat.completions.create({
            model: NEEDS_REPLY_OPENAI_MODEL,
            messages: [
                { role: 'system', content: NEEDS_REPLY_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Emails:\n${JSON.stringify(payload, null, 2)}\n\nReturn {"needsReply":[...]}.`,
                },
            ],
        })
    } catch (error) {
        return { flagsByMessageId: {}, totalTokens: 0 }
    }

    const content = completion?.choices?.[0]?.message?.content || ''
    const totalTokens = Number.isFinite(completion?.usage?.total_tokens) ? completion.usage.total_tokens : 0
    const parsed = extractJson(content)
    const flagsByMessageId = {}
    if (parsed && Array.isArray(parsed.needsReply)) {
        parsed.needsReply.forEach(id => {
            if (validIds.has(id)) flagsByMessageId[id] = true
        })
    }
    return { flagsByMessageId, totalTokens }
}

module.exports = {
    detectNeedsReply,
    extractJson,
    NEEDS_REPLY_MODEL_KEY,
    NEEDS_REPLY_OPENAI_MODEL,
}
