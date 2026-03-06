'use strict'

const { getCachedEnvFunctions, getOpenAIClient, normalizeModelKey } = require('../Assistant/assistantHelper')
const { DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_GMAIL_LABELING_MODEL } = require('./gmailLabelingConfig')

function mapAssistantModelToOpenAIModel(modelKey) {
    const normalizedKey = normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL)
    if (normalizedKey === 'MODEL_GPT3_5') return 'gpt-3.5-turbo'
    if (normalizedKey === 'MODEL_GPT4') return 'gpt-4'
    if (normalizedKey === 'MODEL_GPT4O') return 'gpt-4o'
    if (normalizedKey === 'MODEL_GPT5_1') return 'gpt-5.1'
    if (normalizedKey === 'MODEL_GPT5_4') return 'gpt-5.4'
    return 'gpt-5.2'
}

function extractJsonFromText(text = '') {
    if (!text || typeof text !== 'string') return null

    const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i)
    if (fencedMatch) {
        try {
            return JSON.parse(fencedMatch[1])
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

function coerceClassifierResult(result, validLabelKeys = [], confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    const labelKey = typeof result?.labelKey === 'string' ? result.labelKey.trim() : null
    const confidence = Number.isFinite(result?.confidence) ? Number(result.confidence) : 0
    const reasoning = typeof result?.reasoning === 'string' ? result.reasoning.trim() : ''
    const matched = !!result?.matched && !!labelKey && validLabelKeys.includes(labelKey)
    const usage = result?.usage || null

    if (!matched || confidence < confidenceThreshold) {
        return {
            matched: false,
            labelKey: null,
            confidence,
            reasoning: reasoning || 'No configured label clearly matched.',
            usage,
        }
    }

    return {
        matched: true,
        labelKey,
        confidence,
        reasoning,
        usage,
    }
}

async function classifyGmailMessage({ config, message }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    const labelDefinitions = Array.isArray(config?.labelDefinitions) ? config.labelDefinitions : []
    const validLabelKeys = labelDefinitions.map(label => label.key)
    const confidenceThreshold = Number.isFinite(config?.confidenceThreshold)
        ? Number(config.confidenceThreshold)
        : DEFAULT_CONFIDENCE_THRESHOLD

    if (!openAiKey || labelDefinitions.length === 0) {
        return {
            matched: false,
            labelKey: null,
            confidence: 0,
            reasoning: 'Classifier unavailable or no labels configured.',
        }
    }

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(config?.model)

    const completion = await openai.chat.completions.create({
        model: selectedModel,
        temperature: 0.1,
        messages: [
            {
                role: 'system',
                content:
                    'You classify incoming emails into exactly one configured label or no match. Return strict JSON only with keys matched, labelKey, confidence, reasoning. Never invent labels. Confidence must be a number between 0 and 1.',
            },
            {
                role: 'user',
                content:
                    `Prompt:\n${config.prompt}\n\n` +
                    `Configured labels:\n${JSON.stringify(labelDefinitions, null, 2)}\n\n` +
                    `Email:\n${JSON.stringify(message, null, 2)}\n\n` +
                    'Return JSON exactly like {"matched":true,"labelKey":"newsletter","confidence":0.92,"reasoning":"..."}. If no label matches clearly, return {"matched":false,"labelKey":null,"confidence":0.2,"reasoning":"..."}',
            },
        ],
    })

    const content = completion?.choices?.[0]?.message?.content || ''
    const parsed = extractJsonFromText(content)
    return coerceClassifierResult(
        {
            ...parsed,
            usage: completion?.usage
                ? {
                      totalTokens: Number.isFinite(completion.usage.total_tokens) ? completion.usage.total_tokens : 0,
                      promptTokens: Number.isFinite(completion.usage.prompt_tokens)
                          ? completion.usage.prompt_tokens
                          : 0,
                      completionTokens: Number.isFinite(completion.usage.completion_tokens)
                          ? completion.usage.completion_tokens
                          : 0,
                  }
                : null,
        },
        validLabelKeys,
        confidenceThreshold
    )
}

module.exports = {
    classifyGmailMessage,
}
