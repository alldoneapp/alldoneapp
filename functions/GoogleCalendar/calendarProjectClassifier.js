'use strict'

const {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_GMAIL_LABELING_MODEL,
    DEFAULT_GMAIL_CONSISTENCY_MODEL,
} = require('../Gmail/gmailLabelingConfig')
const {
    buildOpenAiPromptCacheKey,
    getCachedEnvFunctions,
    getOpenAiCacheUsage,
    getOpenAIClient,
    logOpenAiCacheUsage,
    normalizeModelKey,
} = require('../Assistant/assistantHelper')
const { reasoningReferencesDifferentOption } = require('../shared/reasoningConsistency')

const CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT =
    "You route Google Calendar events to exactly one configured Alldone project or no match. Weigh every available signal in the event. Treat the attendees' and organizer's email addresses, and especially their domains, as a strong hint about which client or project an event belongs to: when attendees share a company or client domain, match that domain against the project descriptions, client names, and stakeholders. Return strict JSON only with keys matched, projectId, projectName, confidence, reasoning. projectName must exactly match the selected project name. Never invent project IDs or project names. Confidence must be a number between 0 and 1."
const INCONSISTENT_ROUTING_REASON = 'Classifier returned inconsistent project routing details.'

const GPT5_REASONING_MODEL_KEYS = new Set([
    'MODEL_GPT5_6_SOL',
    'MODEL_GPT5_6_TERRA',
    'MODEL_GPT5_6_LUNA',
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
    if (normalizedKey === 'MODEL_GPT5_6_SOL') return 'gpt-5.6-sol'
    if (normalizedKey === 'MODEL_GPT5_6_TERRA') return 'gpt-5.6-terra'
    if (normalizedKey === 'MODEL_GPT5_6_LUNA') return 'gpt-5.6-luna'
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

function normalizeForProjectComparison(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function normalizeProjectDefinitions(projectDefinitionsOrIds = []) {
    return (Array.isArray(projectDefinitionsOrIds) ? projectDefinitionsOrIds : [])
        .map(project => {
            if (typeof project === 'string') {
                return { projectId: project, name: '' }
            }

            return {
                projectId: typeof project?.projectId === 'string' ? project.projectId.trim() : '',
                name: typeof project?.name === 'string' ? project.name.trim() : '',
            }
        })
        .filter(project => project.projectId)
}

// Detect whether the reasoning names a DIFFERENT configured project than the selected one.
// Uses the shared token-based detector so partial mentions (e.g. "JTL" when the project is
// "JTL Software – Project Juno") are caught, not just full project-name substrings.
function reasoningMentionsDifferentProject(reasoning = '', selectedProjectId = '', projectDefinitions = []) {
    const options = normalizeProjectDefinitions(projectDefinitions).map(project => ({
        key: project.projectId,
        names: [project.name],
    }))
    return !!reasoningReferencesDifferentOption(reasoning, selectedProjectId, options)
}

function coerceCalendarProjectResult(
    result,
    projectDefinitionsOrIds = [],
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    { enforceConsistency = true } = {}
) {
    const projectDefinitions = normalizeProjectDefinitions(projectDefinitionsOrIds)
    const projectDefinitionById = new Map(projectDefinitions.map(project => [project.projectId, project]))
    const projectId = typeof result?.projectId === 'string' ? result.projectId.trim() : null
    const projectName = typeof result?.projectName === 'string' ? result.projectName.trim() : ''
    const confidence = Number.isFinite(result?.confidence) ? Number(result.confidence) : 0
    const reasoning = typeof result?.reasoning === 'string' ? result.reasoning.trim() : ''
    const matched = !!result?.matched && !!projectId && projectDefinitionById.has(projectId)
    const usage = result?.usage || null
    const expectedProjectName = projectDefinitionById.get(projectId)?.name || ''
    const projectNameMismatch =
        matched &&
        projectName &&
        expectedProjectName &&
        normalizeForProjectComparison(projectName) !== normalizeForProjectComparison(expectedProjectName)
    const reasoningMismatch = matched && reasoningMentionsDifferentProject(reasoning, projectId, projectDefinitions)

    const inconsistent = projectNameMismatch || reasoningMismatch

    if (!matched || confidence < confidenceThreshold || (enforceConsistency && inconsistent)) {
        return {
            matched: false,
            projectId: null,
            confidence,
            reasoning:
                enforceConsistency && inconsistent
                    ? INCONSISTENT_ROUTING_REASON
                    : reasoning || 'No active project clearly matched.',
            usage,
        }
    }

    return {
        matched: true,
        projectId,
        projectName: expectedProjectName || projectName,
        confidence,
        reasoning,
        usage,
    }
}

function buildCalendarClassifierRequestParams({
    selectedModel,
    isReasoningModel,
    config,
    definitions,
    normalizedEvent,
}) {
    const supportsExplicitCaching = selectedModel.startsWith('gpt-5.6')
    const staticUserContent =
        `Prompt:\n${config.prompt}\n\n` +
        `Active projects:\n${JSON.stringify(definitions)}\n\n` +
        `Configured confidence threshold: ${config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD}.`
    const dynamicUserContent =
        `Calendar event:\n${JSON.stringify(normalizedEvent)}\n\n` +
        'Return JSON exactly like {"matched":true,"projectId":"project-123","projectName":"Project name exactly as provided","confidence":0.92,"reasoning":"..."}. If no project matches clearly, return {"matched":false,"projectId":null,"projectName":null,"confidence":0.2,"reasoning":"..."}'
    const promptCacheKey = buildOpenAiPromptCacheKey(
        'calendar-route',
        selectedModel,
        config?.projectId || '',
        config?.calendarEmail || '',
        staticUserContent
    )
    const requestParams = {
        model: selectedModel,
        messages: [
            {
                role: 'system',
                content: CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT,
            },
            {
                role: 'user',
                content: supportsExplicitCaching
                    ? [
                          {
                              type: 'text',
                              text: staticUserContent,
                              prompt_cache_breakpoint: { mode: 'explicit' },
                          },
                      ]
                    : staticUserContent,
            },
            { role: 'user', content: dynamicUserContent },
        ],
        prompt_cache_key: promptCacheKey,
    }

    if (supportsExplicitCaching) {
        requestParams.prompt_cache_options = { mode: 'explicit', ttl: '30m' }
    }

    if (!isReasoningModel) {
        requestParams.temperature = 0.1
    }

    return requestParams
}

function buildCalendarClassifierRepairRequestParams({
    selectedModel,
    isReasoningModel,
    config,
    definitions,
    normalizedEvent,
    previousResult,
    retryReason,
}) {
    const requestParams = buildCalendarClassifierRequestParams({
        selectedModel,
        isReasoningModel,
        config,
        definitions,
        normalizedEvent,
    })

    requestParams.messages.push({
        role: 'user',
        content:
            (retryReason === 'zero_confidence'
                ? 'The previous JSON had zero confidence. Re-evaluate once with independent judgment and return corrected strict JSON only. '
                : 'The previous JSON was inconsistent: the selected project ID/name did not match the reasoning, or the reasoning named a different configured project. Re-evaluate once and return corrected strict JSON only. ') +
            'If you cannot make a confident, consistent selection, return no match.\n\n' +
            `Previous JSON:\n${JSON.stringify(previousResult || {}, null, 2)}`,
    })

    return requestParams
}

function buildUsage(completion) {
    if (!completion?.usage) return null
    const cacheUsage = getOpenAiCacheUsage(completion.usage)
    return {
        totalTokens: Number.isFinite(completion.usage.total_tokens) ? completion.usage.total_tokens : 0,
        promptTokens: Number.isFinite(completion.usage.prompt_tokens) ? completion.usage.prompt_tokens : 0,
        completionTokens: Number.isFinite(completion.usage.completion_tokens) ? completion.usage.completion_tokens : 0,
        cachedTokens: cacheUsage.cachedTokens,
        cacheWriteTokens: cacheUsage.cacheWriteTokens,
    }
}

async function runCalendarClassifierCompletion(openai, requestParams) {
    const completion = await openai.chat.completions.create(requestParams)
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: 'calendar-project-classifier',
        model: requestParams.model,
        cacheKey: requestParams.prompt_cache_key,
        cacheMode: requestParams.prompt_cache_options?.mode || 'automatic',
    })
    const content = completion?.choices?.[0]?.message?.content || ''
    const parsed = extractJsonFromText(content)
    return {
        parsed,
        usage: buildUsage(completion),
    }
}

function getCalendarClassificationRetryReason(result) {
    if (result?.matched) return null
    if (result?.reasoning === INCONSISTENT_ROUTING_REASON) return 'inconsistent_result'
    if (result?.confidence === 0) return 'zero_confidence'
    return null
}

async function classifyCalendarEventProject({ config, event, projectDefinitions, calendarEmail = '' }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    const definitions = (Array.isArray(projectDefinitions) ? projectDefinitions : [])
        .slice()
        .sort((a, b) => String(a?.projectId || a?.id || '').localeCompare(String(b?.projectId || b?.id || '')))
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

    // The inconsistency-repair pass (second pass) runs on a stronger, independent model than the
    // first pass. Re-judging with the same (small) model just reproduces the first pass's error;
    // a different high-capability model gives genuinely uncorrelated judgement. Mirrors the Gmail
    // label auditor. Overridable per-config via `consistencyModel`; otherwise the strong default.
    const auditModelKey = config?.consistencyModel || DEFAULT_GMAIL_CONSISTENCY_MODEL
    const auditModel = mapAssistantModelToOpenAIModel(auditModelKey)
    const auditIsReasoningModel = isGpt5ReasoningModel(auditModelKey)

    const normalizedEvent = normalizeCalendarEventForClassifier(event, calendarEmail)
    const cacheConfig = {
        ...config,
        calendarEmail,
    }

    const firstCompletion = await runCalendarClassifierCompletion(
        openai,
        buildCalendarClassifierRequestParams({
            selectedModel,
            isReasoningModel,
            config: cacheConfig,
            definitions,
            normalizedEvent,
        })
    )
    const firstResult = coerceCalendarProjectResult(
        {
            ...firstCompletion.parsed,
            usage: firstCompletion.usage,
        },
        definitions,
        confidenceThreshold
    )

    const retryReason = getCalendarClassificationRetryReason(firstResult)
    if (!retryReason) {
        return firstResult
    }

    const repairCompletion = await runCalendarClassifierCompletion(
        openai,
        buildCalendarClassifierRepairRequestParams({
            selectedModel: auditModel,
            isReasoningModel: auditIsReasoningModel,
            config: cacheConfig,
            definitions,
            normalizedEvent,
            previousResult: firstCompletion.parsed,
            retryReason,
        })
    )

    // The repair pass uses the stronger consistency model and is the final adjudicator.
    // Continue to enforce explicit no-match, configured project IDs, and the confidence
    // threshold, but do not let the lightweight name/token heuristic overrule it again.
    return coerceCalendarProjectResult(
        {
            ...repairCompletion.parsed,
            usage: {
                totalTokens: (firstCompletion.usage?.totalTokens || 0) + (repairCompletion.usage?.totalTokens || 0),
                promptTokens: (firstCompletion.usage?.promptTokens || 0) + (repairCompletion.usage?.promptTokens || 0),
                completionTokens:
                    (firstCompletion.usage?.completionTokens || 0) + (repairCompletion.usage?.completionTokens || 0),
                cachedTokens: (firstCompletion.usage?.cachedTokens || 0) + (repairCompletion.usage?.cachedTokens || 0),
                cacheWriteTokens:
                    (firstCompletion.usage?.cacheWriteTokens || 0) + (repairCompletion.usage?.cacheWriteTokens || 0),
                retriedAfterInconsistentResult: retryReason === 'inconsistent_result',
                retriedAfterZeroConfidence: retryReason === 'zero_confidence',
                auditModel,
            },
        },
        definitions,
        confidenceThreshold,
        { enforceConsistency: false }
    )
}

module.exports = {
    CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT,
    INCONSISTENT_ROUTING_REASON,
    classifyCalendarEventProject,
    coerceCalendarProjectResult,
    extractJsonFromText,
    mapAssistantModelToOpenAIModel,
    normalizeCalendarEventForClassifier,
    normalizeForProjectComparison,
    reasoningMentionsDifferentProject,
}
