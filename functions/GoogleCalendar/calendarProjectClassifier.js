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
    logOpenAiCacheUsage,
    normalizeModelKey,
} = require('../Assistant/assistantHelper')
const { reasoningReferencesDifferentOption } = require('../shared/reasoningConsistency')
const { getOpenRouterAssistantModelId } = require('../Assistant/assistantModelRouting')
const { resolveClassifierClient } = require('../Assistant/classifierModelClient')
const { appendCalendarLearnedRulesToPrompt } = require('./calendarProjectRoutingConfig')
const { MEETING_CATEGORIES, isMeetingCategory } = require('../shared/meetingReview/meetingReviewConstants')
const { toAiConfidenceLevel } = require('../shared/meetingReview/meetingCategorySuggestion')

// AT-3137: the same run also proposes the meeting's PURPOSE category for the user's private meeting
// statistics, so the suggestion costs no extra model call and sends no extra data. It is only a
// type ("what kind of appointment"), never a judgement of whether the meeting was useful: that is
// the user's call alone, and the model is told so explicitly.
const MEETING_CATEGORY_PROMPT =
    ' Additionally classify the PURPOSE of the event into exactly one meeting category, using only the event fields provided: ' +
    `"${MEETING_CATEGORIES[0]}" (working meeting: jointly working out or deciding something concrete, workshops, planning, design sessions, co-creation, also with customers), ` +
    `"${MEETING_CATEGORIES[1]}" (stakeholder meeting: aligning expectations, approval or support with management, customers, partners, investors, board), ` +
    `"${MEETING_CATEGORIES[2]}" (status and routine: exchanging the current state, standups, jour fixe, weekly syncs, reporting, info all-hands, also with customers), ` +
    `"${MEETING_CATEGORIES[3]}" (network and exchange: relationship, intro, mentoring, career talks, conferences, webinars, interviews, without a concrete work result), ` +
    `"${MEETING_CATEGORIES[4]}" (own time: no other participants or private: focus blocks, solo work, preparation, travel, lunch, family, doctor, sport). ` +
    'Precedence: no other participants or private comes first; then what happens in the meeting decides over who attends (reporting status to a customer is status, a workshop with a customer is working). ' +
    'Add keys meetingCategory (one of the category keys, or null when the event gives no basis), meetingCategoryConfidence (0 to 1; use below 0.6 when the signals are thin or conflicting) and meetingCategorySignals (at most 3 short factual phrases in the language of the event title naming the event fields you used, e.g. a title word, the attendee count, the recurrence). ' +
    'Never judge whether the meeting is useful, necessary, productive or a waste of time, and never invent outcomes, decisions or content that is not in the event.'

// AT-3136: the same run also decides whether an event is a block of the user's OWN WORK time. Only
// an event that is also reliably solo (`calendarData.soloEvent`, decided from the participant data,
// never by the model) and that the model calls a work block stays "time to work" in the All
// projects line; a private solo appointment (doctor, childcare) still takes time away.
const WORK_BLOCK_PROMPT =
    ' Additionally decide whether the event is a block the user reserved for their own work: add key workBlock as true only when the event is clearly time for the user to work alone (focus or deep work, solo work on a topic, preparation, writing, reading, admin or email time, a time blocker for work); ' +
    'false when it is a meeting or call with other people, a private or personal appointment (doctor, childcare, family, lunch, sport, errands), travel or commute, out of office or a reminder that is not work time; ' +
    'null when the event gives no clear basis. Base this only on the event fields provided.'

const CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT =
    "You route Google Calendar events to exactly one configured Alldone project or no match. Weigh every available signal in the event. Treat the attendees' and organizer's email addresses, and especially their domains, as a strong hint about which client or project an event belongs to: when attendees share a company or client domain, match that domain against the project descriptions, client names, and stakeholders. Return strict JSON only with keys matched, projectId, projectName, confidence, reasoning. projectName must exactly match the selected project name. Never invent project IDs or project names. Confidence must be a number between 0 and 1." +
    MEETING_CATEGORY_PROMPT +
    WORK_BLOCK_PROMPT

// A "why" line that judges the meeting is dropped, whatever the prompt said: the suggestion must
// never carry a usefulness verdict into the sheet.
const JUDGEMENT_WORDS =
    /(?<!\p{L})(useless|pointless|waste|wasted|unnecessary|unproductive|productive|worthwhile|not helpful|sinnlos|unnötig|überflüssig|verschwend\p{L}*|nutzlos|unproduktiv|produktiv|lohnt|gelohnt)(?!\p{L})/iu

function coerceMeetingCategorySuggestion(result) {
    const category = typeof result?.meetingCategory === 'string' ? result.meetingCategory.trim() : ''
    if (!isMeetingCategory(category)) return null
    const signals = (Array.isArray(result.meetingCategorySignals) ? result.meetingCategorySignals : [])
        .filter(item => typeof item === 'string')
        .map(item => item.trim().slice(0, 120))
        .filter(item => item && !JUDGEMENT_WORDS.test(item))
        .slice(0, 3)
    return {
        category,
        confidence: toAiConfidenceLevel(Number(result.meetingCategoryConfidence)),
        signals,
    }
}
const INCONSISTENT_ROUTING_REASON = 'Classifier returned inconsistent project routing details.'

const GPT5_REASONING_MODEL_KEYS = new Set([
    'MODEL_GPT6_SOL',
    'MODEL_GPT5_6_TERRA',
    'MODEL_GPT6_LUNA',
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_5',
    'MODEL_GPT5_4_MINI',
    'MODEL_GPT5_4_NANO',
])

function mapAssistantModelToOpenAIModel(modelKey) {
    const normalizedKey = normalizeModelKey(modelKey || DEFAULT_GMAIL_LABELING_MODEL)
    // Models served through OpenRouter resolve from the shared routing table. Checked first so the
    // `gpt-5.2` fallback at the bottom — which exists for genuinely unknown keys — can never quietly
    // swallow a known non-OpenAI model and bill the user for a model they did not select.
    const openRouterModelId = getOpenRouterAssistantModelId(normalizedKey)
    if (openRouterModelId) return openRouterModelId
    if (normalizedKey === 'MODEL_GPT3_5') return 'gpt-3.5-turbo'
    if (normalizedKey === 'MODEL_GPT4') return 'gpt-4'
    if (normalizedKey === 'MODEL_GPT4O') return 'gpt-4o'
    if (normalizedKey === 'MODEL_GPT5_1') return 'gpt-5.1'
    if (normalizedKey === 'MODEL_GPT5_5') return 'gpt-5.5'
    if (normalizedKey === 'MODEL_GPT6_SOL') return 'gpt-6.1-sol'
    if (normalizedKey === 'MODEL_GPT5_6_TERRA') return 'gpt-5.6-terra'
    if (normalizedKey === 'MODEL_GPT6_LUNA') return 'gpt-6-luna'
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
        recurringEventId: event.recurringEventId || event.seriesMasterId || '',
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
        // Google's own type ("focusTime", "outOfOffice", ...) helps the work block verdict.
        ...(typeof event.eventType === 'string' && event.eventType ? { eventType: event.eventType } : {}),
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

// Only a real boolean counts; anything else ("yes", 1, null) is "the model did not decide".
function coerceWorkBlockVerdict(result) {
    return typeof result?.workBlock === 'boolean' ? result.workBlock : null
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
    // The category is independent of the project decision: a "no project matched" answer can still
    // carry a perfectly good meeting category.
    const meetingCategory = coerceMeetingCategorySuggestion(result)
    const workBlock = coerceWorkBlockVerdict(result)

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
            meetingCategory,
            workBlock,
        }
    }

    return {
        matched: true,
        projectId,
        projectName: expectedProjectName || projectName,
        confidence,
        reasoning,
        usage,
        meetingCategory,
        workBlock,
    }
}

function buildCalendarClassifierRequestParams({
    selectedModel,
    isReasoningModel,
    config,
    definitions,
    normalizedEvent,
    enableCacheWrite = true,
    isOpenRouter = false,
}) {
    // `prompt_cache_key` / `prompt_cache_options` / `prompt_cache_breakpoint` are OpenAI extensions
    // with no equivalent on OpenRouter's Chat Completions surface, so they are omitted there rather
    // than sent speculatively. See the matching note in `gmailPromptClassifier`.
    const supportsExplicitCaching = !isOpenRouter && /^gpt-(?:5\.6|6)(?:[.-])/.test(selectedModel)
    const usesExplicitCacheBreakpoint = supportsExplicitCaching && enableCacheWrite
    const staticUserContent =
        `Prompt:\n${appendCalendarLearnedRulesToPrompt(config.prompt, config.learnedRules)}\n\n` +
        `Active projects:\n${JSON.stringify(definitions)}\n\n` +
        `Configured confidence threshold: ${config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD}.`
    const dynamicUserContent =
        `Calendar event:\n${JSON.stringify(normalizedEvent)}\n\n` +
        'Return JSON exactly like {"matched":true,"projectId":"project-123","projectName":"Project name exactly as provided","confidence":0.92,"reasoning":"...","meetingCategory":"status","meetingCategoryConfidence":0.7,"meetingCategorySignals":["..."],"workBlock":false}. If no project matches clearly, return {"matched":false,"projectId":null,"projectName":null,"confidence":0.2,"reasoning":"...","meetingCategory":null,"meetingCategoryConfidence":0.2,"meetingCategorySignals":[],"workBlock":null}'
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
                content: usesExplicitCacheBreakpoint
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
    }

    if (!isOpenRouter) {
        requestParams.prompt_cache_key = promptCacheKey
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
    isOpenRouter = false,
}) {
    const requestParams = buildCalendarClassifierRequestParams({
        selectedModel,
        isReasoningModel,
        config,
        definitions,
        normalizedEvent,
        // Repair calls are sparse, so writing their prefix to the explicit cache
        // costs more than it saves. Keep explicit mode but omit the breakpoint.
        enableCacheWrite: false,
        isOpenRouter,
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
    const hasExplicitCacheBreakpoint = requestParams.messages.some(message =>
        Array.isArray(message.content) ? message.content.some(part => !!part?.prompt_cache_breakpoint) : false
    )
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: 'calendar-project-classifier',
        model: requestParams.model,
        cacheKey: requestParams.prompt_cache_key,
        cacheMode: requestParams.prompt_cache_options
            ? hasExplicitCacheBreakpoint
                ? 'explicit'
                : 'explicit-no-breakpoint'
            : 'automatic',
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
    const openRouterKey = envFunctions?.OPENROUTER_API_KEY
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

    // First pass and repair pass resolve their client independently: the first pass is
    // user-selectable (and may be DeepSeek via OpenRouter) while the repair pass defaults to a
    // strong OpenAI model, so they can legitimately sit on different providers.
    const { client: openai, isOpenRouter } = resolveClassifierClient(config?.model, {
        openAiKey,
        openRouterKey,
    })
    const selectedModel = mapAssistantModelToOpenAIModel(config?.model)
    const isReasoningModel = isGpt5ReasoningModel(config?.model)

    // The inconsistency-repair pass (second pass) runs on a stronger, independent model than the
    // first pass. Re-judging with the same (small) model just reproduces the first pass's error;
    // a different high-capability model gives genuinely uncorrelated judgement. Mirrors the Gmail
    // label auditor. Overridable per-config via `consistencyModel`; otherwise the strong default.
    const auditModelKey = config?.consistencyModel || DEFAULT_GMAIL_CONSISTENCY_MODEL
    const auditModel = mapAssistantModelToOpenAIModel(auditModelKey)
    const auditIsReasoningModel = isGpt5ReasoningModel(auditModelKey)
    const { client: auditOpenai, isOpenRouter: auditIsOpenRouter } = resolveClassifierClient(auditModelKey, {
        openAiKey,
        openRouterKey,
    })

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
            isOpenRouter,
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
        auditOpenai,
        buildCalendarClassifierRepairRequestParams({
            selectedModel: auditModel,
            isReasoningModel: auditIsReasoningModel,
            config: cacheConfig,
            definitions,
            normalizedEvent,
            previousResult: firstCompletion.parsed,
            retryReason,
            isOpenRouter: auditIsOpenRouter,
        })
    )

    // The repair pass uses the stronger consistency model and is the final adjudicator.
    // Continue to enforce explicit no-match, configured project IDs, and the confidence
    // threshold, but do not let the lightweight name/token heuristic overrule it again.
    const repairedResult = coerceCalendarProjectResult(
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
    // The repair prompt is about the project; keep the first pass's category if it omitted one.
    if (!repairedResult.meetingCategory && firstResult.meetingCategory) {
        repairedResult.meetingCategory = firstResult.meetingCategory
    }
    // The same for the AT-3136 work block verdict.
    if (repairedResult.workBlock === null && typeof firstResult.workBlock === 'boolean') {
        repairedResult.workBlock = firstResult.workBlock
    }
    return repairedResult
}

module.exports = {
    CALENDAR_PROJECT_ROUTER_SYSTEM_PROMPT,
    coerceMeetingCategorySuggestion,
    INCONSISTENT_ROUTING_REASON,
    classifyCalendarEventProject,
    coerceCalendarProjectResult,
    coerceWorkBlockVerdict,
    extractJsonFromText,
    mapAssistantModelToOpenAIModel,
    normalizeCalendarEventForClassifier,
    normalizeForProjectComparison,
    reasoningMentionsDifferentProject,
}
