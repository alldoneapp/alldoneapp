'use strict'

const { DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_GMAIL_LABELING_MODEL } = require('../Gmail/gmailLabelingConfig')
const { getCachedEnvFunctions, getOpenAIClient, normalizeModelKey } = require('../Assistant/assistantHelper')

const CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT =
    'You route Google Calendar events to exactly one configured Alldone project or no match. Return strict JSON only with keys matched, projectId, confidence, reasoning. Never invent project IDs. Confidence must be a number between 0 and 1.'

const GPT5_REASONING_MODEL_KEYS = new Set([
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_5',
    'MODEL_GPT5_4_MINI',
    'MODEL_GPT5_4_NANO',
])

function mapAssistantModelToOpenAIModel(modelKey) {
    const normalizedKey = normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL)
    if (normalizedKey === 'MODEL_GPT3_5') return 'gpt-3.5-turbo'
    if (normalizedKey === 'MODEL_GPT4') return 'gpt-4'
    if (normalizedKey === 'MODEL_GPT4O') return 'gpt-4o'
    if (normalizedKey === 'MODEL_GPT5_1') return 'gpt-5.1'
    if (normalizedKey === 'MODEL_GPT5_5') return 'gpt-5.5'
    if (normalizedKey === 'MODEL_GPT5_4_MINI') return 'gpt-5.4-mini'
    if (normalizedKey === 'MODEL_GPT5_4_NANO') return 'gpt-5.4-nano'
    return 'gpt-5.2'
}

function isGpt5ReasoningModel(modelKey) {
    return GPT5_REASONING_MODEL_KEYS.has(normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL))
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

function normalizeCalendarEventForClassifier(event = {}, calendarEmail = '') {
    return {
        id: event.id || '',
        summary: event.summary || '',
        description: event.description || '',
        location: event.location || '',
        start: event.start || null,
        end: event.end || null,
        organizer: event.organizer || null,
        creator: event.creator || null,
        attendees: Array.isArray(event.attendees)
            ? event.attendees.map(attendee => ({
                  email: attendee.email || '',
                  displayName: attendee.displayName || '',
                  responseStatus: attendee.responseStatus || '',
                  organizer: !!attendee.organizer,
                  self: !!attendee.self,
              }))
            : [],
        htmlLink: event.htmlLink || '',
        calendarEmail,
    }
}

function coerceCalendarProjectResult(result, validProjectIds = [], confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    const projectId = typeof result?.projectId === 'string' ? result.projectId.trim() : null
    const confidence = Number.isFinite(result?.confidence) ? Number(result.confidence) : 0
    const reasoning = typeof result?.reasoning === 'string' ? result.reasoning.trim() : ''
    const matched = !!result?.matched && !!projectId && validProjectIds.includes(projectId)
    const usage = result?.usage || null

    if (!matched || confidence < confidenceThreshold) {
        return {
            matched: false,
            projectId: null,
            confidence,
            reasoning: reasoning || 'No active project clearly matched.',
            usage,
        }
    }

    return {
        matched: true,
        projectId,
        confidence,
        reasoning,
        usage,
    }
}

async function classifyCalendarEventProject({ config, event, projectDefinitions, calendarEmail = '' }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    const definitions = Array.isArray(projectDefinitions) ? projectDefinitions : []
    const validProjectIds = definitions.map(project => project.projectId)
    const confidenceThreshold = Number.isFinite(config?.confidenceThreshold)
        ? Number(config.confidenceThreshold)
        : DEFAULT_CONFIDENCE_THRESHOLD

    if (!openAiKey) {
        throw new Error('Calendar project routing classifier unavailable.')
    }

    if (definitions.length === 0) {
        return {
            matched: false,
            projectId: null,
            confidence: 0,
            reasoning: 'Classifier unavailable or no active projects configured.',
        }
    }

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(config?.model)
    const isReasoningModel = isGpt5ReasoningModel(config?.model)
    const normalizedEvent = normalizeCalendarEventForClassifier(event, calendarEmail)

    const requestParams = {
        model: selectedModel,
        messages: [
            {
                role: 'system',
                content: CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT,
            },
            {
                role: 'user',
                content:
                    `Prompt:\n${config.prompt}\n\n` +
                    `Active projects:\n${JSON.stringify(definitions, null, 2)}\n\n` +
                    `Calendar event:\n${JSON.stringify(normalizedEvent, null, 2)}\n\n` +
                    'Return JSON exactly like {"matched":true,"projectId":"project-123","confidence":0.92,"reasoning":"..."}. If no project matches clearly, return {"matched":false,"projectId":null,"confidence":0.2,"reasoning":"..."}',
            },
        ],
    }

    if (!isReasoningModel) {
        requestParams.temperature = 0.1
    }

    const completion = await openai.chat.completions.create(requestParams)
    const content = completion?.choices?.[0]?.message?.content || ''
    const parsed = extractJsonFromText(content)

    return coerceCalendarProjectResult(
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
        validProjectIds,
        confidenceThreshold
    )
}

module.exports = {
    CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT,
    classifyCalendarEventProject,
    coerceCalendarProjectResult,
    extractJsonFromText,
    mapAssistantModelToOpenAIModel,
    normalizeCalendarEventForClassifier,
}
