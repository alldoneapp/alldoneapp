'use strict'

const admin = require('firebase-admin')
const { Timestamp } = require('firebase-admin/firestore')

const { PLAN_STATUS_PREMIUM } = require('../Payment/premiumHelper')
const { getCachedEnvFunctions, getOpenAIClient, logOpenAiCacheUsage } = require('../Assistant/assistantHelper')
const {
    extractJsonFromText,
    isGpt5ReasoningModel,
    mapAssistantModelToOpenAIModel,
} = require('../Gmail/gmailPromptClassifier')
const { MAX_LEARNED_RULES_LENGTH } = require('../Gmail/gmailLabelingConfig')
const { createCalendarLearnedRuleFeed } = require('./calendarLearnedRuleFeed')
const {
    buildCalendarProjectDefinitions,
    buildCalendarSeriesRouteKey,
    loadActiveProjectsForCalendarRouting,
    loadCalendarProjectRoutingConfig,
    normalizeLearnedSeriesRoutes,
} = require('./calendarProjectRoutingConfig')

const CALENDAR_FEEDBACK_REVISION_MODEL = 'MODEL_GPT5_6_SOL'
const MAX_RULE_REVISION_ATTEMPTS = 3
const RULE_REVISION_CONFLICT = 'CALENDAR_RULE_REVISION_CONFLICT'

const REVISION_SYSTEM_PROMPT =
    'You maintain a compact list of user feedback rules for an AI calendar-to-project routing assistant. ' +
    'Given the current rules, active projects, one calendar event, the previous routing decision, and the project ' +
    'the user manually moved the event to, produce the updated rules list. Treat that manual move as authoritative. ' +
    'Generalize stable signals such as recurring meeting titles, client names, organizer or attendee domains, but do ' +
    'not overgeneralize generic words. Merge compatible feedback, replace contradicted rules, and keep project names ' +
    'and project IDs exact. Return short plain-text bullet lines beginning with "- ", no more than ' +
    `${MAX_LEARNED_RULES_LENGTH} characters total. Return strict JSON only with the single key learnedRules.`

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeFeedbackMarker(task = {}, taskProjectId = '') {
    const marker = task?.calendarData?.projectRoutingFeedback
    if (!marker || typeof marker !== 'object') return null

    const feedbackId = normalizeText(marker.feedbackId)
    const requestedByUserId = normalizeText(marker.requestedByUserId)
    const taskLastEditorId = normalizeText(task.lastEditorId)
    const syncProjectId = normalizeText(
        marker.syncProjectId ||
            task?.calendarData?.originalProjectId ||
            task?.calendarData?.projectRouting?.syncProjectId
    )
    const movedToProjectId = normalizeText(marker.movedToProjectId || taskProjectId)
    const movedFromProjectId = normalizeText(marker.movedFromProjectId)

    if (
        !feedbackId ||
        !requestedByUserId ||
        requestedByUserId !== taskLastEditorId ||
        !syncProjectId ||
        !movedToProjectId ||
        movedToProjectId !== taskProjectId
    ) {
        return null
    }

    return {
        feedbackId,
        requestedByUserId,
        syncProjectId,
        movedFromProjectId,
        movedToProjectId,
        previousRoutedProjectId: normalizeText(marker.previousRoutedProjectId),
        requestedAt: Number.isFinite(marker.requestedAt) ? Number(marker.requestedAt) : 0,
    }
}

function normalizeEventContext(task = {}) {
    const calendarData = task.calendarData || {}
    return {
        eventId: normalizeText(task.id),
        summary: normalizeText(task.name || task.extendedName),
        description: normalizeText(task.description).slice(0, 4000),
        provider: normalizeText(calendarData.provider) || 'google',
        recurringEventId: normalizeText(calendarData.recurringEventId),
        start: calendarData.start || null,
        end: calendarData.end || null,
    }
}

function escapeRuleText(value) {
    return normalizeText(value).replace(/\s+/g, ' ').replace(/["\\]/g, '').slice(0, 180)
}

function buildDeterministicCalendarFeedbackRule({ event = {}, targetProject = {} } = {}) {
    const summary = escapeRuleText(event.summary) || 'this calendar event'
    const projectName = escapeRuleText(targetProject.name) || 'the selected project'
    const projectId = escapeRuleText(targetProject.projectId)
    const eventKind = event.recurringEventId ? 'occurrences of the recurring calendar event' : 'calendar events titled'
    return `- Route ${eventKind} "${summary}" to "${projectName}" (project ID: "${projectId}").`
}

function appendDeterministicCalendarFeedbackRule(currentRules = '', context = {}) {
    const nextRule = buildDeterministicCalendarFeedbackRule(context)
    const existingRules = normalizeText(currentRules)
        .split('\n')
        .map(rule => rule.trim())
        .filter(Boolean)
        .filter(rule => rule !== nextRule)
    return [nextRule, ...existingRules].join('\n').slice(0, MAX_LEARNED_RULES_LENGTH)
}

async function reviseCalendarLearnedRules({ currentRules, projectDefinitions, event, previousRouting, targetProject }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('Calendar routing feedback revision unavailable: missing OpenAI key')

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(CALENDAR_FEEDBACK_REVISION_MODEL)
    const requestParams = {
        model: selectedModel,
        messages: [
            { role: 'system', content: REVISION_SYSTEM_PROMPT },
            {
                role: 'user',
                content:
                    `Current rules:\n${currentRules || '(none)'}\n\n` +
                    `Active projects:\n${JSON.stringify(projectDefinitions, null, 2)}\n\n` +
                    `Calendar event:\n${JSON.stringify(event, null, 2)}\n\n` +
                    `Previous routing:\n${JSON.stringify(previousRouting, null, 2)}\n\n` +
                    `Authoritative user correction:\n${JSON.stringify(
                        {
                            targetProjectId: targetProject.projectId,
                            targetProjectName: targetProject.name,
                        },
                        null,
                        2
                    )}\n\n` +
                    'Return JSON exactly like {"learnedRules":"- Recurring Acme status meetings route to Acme (project ID: \\\"project-123\\\")."}.',
            },
        ],
    }
    if (!isGpt5ReasoningModel(CALENDAR_FEEDBACK_REVISION_MODEL)) requestParams.temperature = 0.1
    if (selectedModel.startsWith('gpt-5.6')) {
        requestParams.prompt_cache_options = { mode: 'explicit', ttl: '30m' }
    }

    const completion = await openai.chat.completions.create(requestParams)
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: 'calendar-routing-feedback-revision',
        model: selectedModel,
        cacheMode: requestParams.prompt_cache_options ? 'explicit-no-breakpoint' : 'automatic',
    })
    const parsed = extractJsonFromText(completion?.choices?.[0]?.message?.content || '')
    const revisedRules = typeof parsed?.learnedRules === 'string' ? parsed.learnedRules.trim() : ''
    if (!revisedRules) throw new Error('Calendar routing feedback revision produced no rules text')
    return revisedRules.slice(0, MAX_LEARNED_RULES_LENGTH)
}

function buildUpdatedSeriesRoutes(
    config = {},
    event = {},
    targetProject = {},
    feedbackId = '',
    learnedAt = Date.now()
) {
    const recurringEventId = normalizeText(event.recurringEventId)
    if (!recurringEventId) return normalizeLearnedSeriesRoutes(config.learnedSeriesRoutes)

    const routeKey = buildCalendarSeriesRouteKey(event.provider, recurringEventId)
    return normalizeLearnedSeriesRoutes({
        ...(config.learnedSeriesRoutes || {}),
        [routeKey]: {
            recurringEventId,
            provider: event.provider || 'google',
            targetProjectId: targetProject.projectId,
            targetProjectName: targetProject.name,
            eventSummary: event.summary,
            feedbackId,
            learnedAt,
        },
    })
}

async function initializeFeedbackAudit(feedbackRef, auditData) {
    let completedFeedback = null
    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(feedbackRef)
        if (snapshot.exists && snapshot.data()?.status === 'completed') {
            completedFeedback = snapshot.data()
            return
        }
        transaction.set(
            feedbackRef,
            {
                ...auditData,
                status: 'pending',
                lastAttemptAt: Timestamp.now(),
            },
            { merge: true }
        )
    })
    return completedFeedback
}

async function ensureLearnedRuleFeed({
    feedback,
    feedbackRef,
    marker,
    task,
    userData,
    targetProject,
    targetProjectData,
}) {
    if (!feedback?.learnedRuleCreated || feedback.feedCreatedAt) return false

    const { feedId } = await createCalendarLearnedRuleFeed({
        feedbackId: marker.feedbackId,
        projectId: marker.movedToProjectId,
        projectData: targetProjectData,
        task,
        userId: marker.requestedByUserId,
        userData,
        ruleType: 'project',
        targetProject,
    })
    await feedbackRef.set(
        {
            feedId,
            feedCreatedAt: Timestamp.now(),
        },
        { merge: true }
    )
    return true
}

async function captureCalendarProjectRoutingFeedback({ task = {}, taskProjectId = '' } = {}) {
    const marker = normalizeFeedbackMarker(task, taskProjectId)
    if (!marker) return { status: 'skipped', reason: 'no_feedback_marker' }

    const db = admin.firestore()
    const userRef = db.doc(`users/${marker.requestedByUserId}`)
    const targetProjectRef = db.doc(`projects/${marker.movedToProjectId}`)
    const [userDoc, targetProjectDoc] = await db.getAll(userRef, targetProjectRef)
    if (!userDoc.exists || !targetProjectDoc.exists) return { status: 'skipped', reason: 'missing_context' }

    const userData = userDoc.data() || {}
    const targetProjectData = targetProjectDoc.data() || {}
    const accessibleProjectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    if (
        userData?.premium?.status !== PLAN_STATUS_PREMIUM ||
        !accessibleProjectIds.includes(marker.movedToProjectId) ||
        targetProjectData.active === false ||
        targetProjectData.isTemplate === true ||
        targetProjectData.parentTemplateId
    ) {
        return { status: 'skipped', reason: 'routing_not_available' }
    }

    const initialConfigContext = await loadCalendarProjectRoutingConfig(
        marker.requestedByUserId,
        marker.syncProjectId,
        task?.calendarData?.email || ''
    )
    if (!initialConfigContext.exists || !initialConfigContext.config.enabled) {
        return { status: 'skipped', reason: 'routing_not_configured' }
    }

    const targetProject = {
        projectId: targetProjectDoc.id,
        name: normalizeText(targetProjectData.name) || 'Untitled project',
    }
    const event = normalizeEventContext(task)
    const feedbackRef = initialConfigContext.ref.collection('feedback').doc(marker.feedbackId)
    const previousRouting = task?.calendarData?.projectRouting || null
    const completedFeedback = await initializeFeedbackAudit(feedbackRef, {
        feedbackId: marker.feedbackId,
        userId: marker.requestedByUserId,
        syncProjectId: marker.syncProjectId,
        movedFromProjectId: marker.movedFromProjectId,
        movedToProjectId: marker.movedToProjectId,
        requestedAt: marker.requestedAt,
        event,
        previousRouting,
    })
    if (completedFeedback) {
        await ensureLearnedRuleFeed({
            feedback: completedFeedback,
            feedbackRef,
            marker,
            task,
            userData,
            targetProject,
            targetProjectData,
        })
        return { status: 'completed', alreadyApplied: true }
    }

    const activeProjects = await loadActiveProjectsForCalendarRouting(userData)
    const projectDefinitions = buildCalendarProjectDefinitions(activeProjects)

    for (let attempt = 0; attempt < MAX_RULE_REVISION_ATTEMPTS; attempt++) {
        const configContext = await loadCalendarProjectRoutingConfig(
            marker.requestedByUserId,
            marker.syncProjectId,
            task?.calendarData?.email || ''
        )
        const currentConfig = configContext.config
        const currentRevision = currentConfig.learnedRulesRevision || 0
        let learnedRules

        try {
            learnedRules = await reviseCalendarLearnedRules({
                currentRules: currentConfig.learnedRules,
                projectDefinitions,
                event,
                previousRouting,
                targetProject,
            })
        } catch (error) {
            console.warn('[calendarProjectRoutingFeedback] Using deterministic feedback rule fallback', {
                feedbackId: marker.feedbackId,
                error: error.message,
            })
            learnedRules = appendDeterministicCalendarFeedbackRule(currentConfig.learnedRules, {
                event,
                targetProject,
            })
        }

        const learnedAt = Date.now()
        const learnedSeriesRoutes = buildUpdatedSeriesRoutes(
            currentConfig,
            event,
            targetProject,
            marker.feedbackId,
            learnedAt
        )

        try {
            let alreadyApplied = false
            let completedFeedbackFromTransaction = null
            let learnedRuleCreated = false
            await db.runTransaction(async transaction => {
                const [feedbackSnapshot, configSnapshot] = await Promise.all([
                    transaction.get(feedbackRef),
                    transaction.get(configContext.ref),
                ])
                if (feedbackSnapshot.exists && feedbackSnapshot.data()?.status === 'completed') {
                    alreadyApplied = true
                    completedFeedbackFromTransaction = feedbackSnapshot.data()
                    return
                }

                const persistedConfig = configSnapshot.exists ? configSnapshot.data() || {} : {}
                const persistedRevision = Number.isFinite(persistedConfig.learnedRulesRevision)
                    ? Number(persistedConfig.learnedRulesRevision)
                    : 0
                if (persistedRevision !== currentRevision) {
                    const conflict = new Error('Calendar routing learned rules changed during feedback revision')
                    conflict.code = RULE_REVISION_CONFLICT
                    throw conflict
                }

                learnedRuleCreated = normalizeText(persistedConfig.learnedRules) !== normalizeText(learnedRules)

                transaction.set(
                    configContext.ref,
                    {
                        learnedRules,
                        learnedRulesRevision: currentRevision + 1,
                        learnedSeriesRoutes,
                        updatedAt: Timestamp.now(),
                        updatedBy: marker.requestedByUserId,
                    },
                    { merge: true }
                )
                transaction.set(
                    feedbackRef,
                    {
                        status: 'completed',
                        learnedRules,
                        learnedRulesRevision: currentRevision + 1,
                        learnedSeriesRouteApplied: !!event.recurringEventId,
                        learnedRuleCreated,
                        targetProject,
                        completedAt: Timestamp.now(),
                    },
                    { merge: true }
                )
            })

            const feedCreated = await ensureLearnedRuleFeed({
                feedback: completedFeedbackFromTransaction || {
                    learnedRuleCreated,
                },
                feedbackRef,
                marker,
                task,
                userData,
                targetProject,
                targetProjectData,
            })

            return {
                status: 'completed',
                alreadyApplied,
                feedCreated,
                learnedRules,
                learnedSeriesRouteApplied: !!event.recurringEventId,
            }
        } catch (error) {
            if (error?.code === RULE_REVISION_CONFLICT && attempt + 1 < MAX_RULE_REVISION_ATTEMPTS) continue
            throw error
        }
    }

    throw new Error('Calendar routing feedback could not be committed after concurrent rule updates')
}

module.exports = {
    CALENDAR_FEEDBACK_REVISION_MODEL,
    appendDeterministicCalendarFeedbackRule,
    buildDeterministicCalendarFeedbackRule,
    buildUpdatedSeriesRoutes,
    captureCalendarProjectRoutingFeedback,
    normalizeEventContext,
    normalizeFeedbackMarker,
    reviseCalendarLearnedRules,
}
