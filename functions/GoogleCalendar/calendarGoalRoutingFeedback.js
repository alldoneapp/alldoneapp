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
    buildCalendarGoalSeriesRouteKey,
    loadCalendarProjectRoutingConfig,
    normalizeLearnedGoalSeriesRoutes,
} = require('./calendarProjectRoutingConfig')

const CALENDAR_GOAL_FEEDBACK_REVISION_MODEL = 'MODEL_GPT5_6_SOL'
const MAX_RULE_REVISION_ATTEMPTS = 3
const RULE_REVISION_CONFLICT = 'CALENDAR_GOAL_RULE_REVISION_CONFLICT'

const REVISION_SYSTEM_PROMPT =
    'You maintain a compact list of user feedback rules for an AI that assigns calendar tasks to Goals inside an ' +
    "Alldone project. Given the current rules, the project, one calendar event, its previous Goal, and the user's " +
    'authoritative Goal choice, produce the updated rules list. A null selected Goal means the user deliberately ' +
    'wants matching calendar tasks to remain without a Goal. Generalize stable signals such as recurring meeting ' +
    'titles and client names, but do not overgeneralize generic words. Merge compatible feedback, replace ' +
    'contradicted rules, and keep project names, project IDs, Goal names, and Goal IDs exact. Return short plain-text ' +
    'bullet lines beginning with "- ", no more than ' +
    `${MAX_LEARNED_RULES_LENGTH} characters total. Return strict JSON only with the single key learnedGoalRules.`

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalId(value) {
    return normalizeText(value) || null
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

function normalizeGoalFeedbackMarker(task = {}, taskProjectId = '') {
    const marker = task?.calendarData?.goalRoutingFeedback
    if (!marker || typeof marker !== 'object') return null

    const feedbackId = normalizeText(marker.feedbackId)
    const requestedByUserId = normalizeText(marker.requestedByUserId)
    const taskLastEditorId = normalizeText(task.lastEditorId)
    const syncProjectId = normalizeText(
        marker.syncProjectId ||
            task?.calendarData?.originalProjectId ||
            task?.calendarData?.projectRouting?.syncProjectId ||
            taskProjectId
    )
    const projectId = normalizeText(marker.projectId || taskProjectId)
    const previousGoalId = normalizeOptionalId(marker.previousGoalId)
    const selectedGoalId = normalizeOptionalId(marker.selectedGoalId)

    if (
        !feedbackId ||
        !requestedByUserId ||
        requestedByUserId !== taskLastEditorId ||
        !syncProjectId ||
        !projectId ||
        projectId !== taskProjectId
    ) {
        return null
    }

    return {
        feedbackId,
        requestedByUserId,
        syncProjectId,
        projectId,
        previousGoalId,
        selectedGoalId,
        requestedAt: Number.isFinite(marker.requestedAt) ? Number(marker.requestedAt) : 0,
    }
}

function escapeRuleText(value) {
    return normalizeText(value).replace(/\s+/g, ' ').replace(/["\\]/g, '').slice(0, 180)
}

function buildDeterministicCalendarGoalFeedbackRule({ event = {}, project = {}, selectedGoal = null } = {}) {
    const summary = escapeRuleText(event.summary) || 'this calendar event'
    const projectName = escapeRuleText(project.name) || 'the selected project'
    const projectId = escapeRuleText(project.projectId)
    const eventKind = event.recurringEventId ? 'occurrences of the recurring calendar event' : 'calendar events titled'
    const prefix = `- In project "${projectName}" (project ID: "${projectId}"), `

    if (!selectedGoal) return `${prefix}leave ${eventKind} "${summary}" without a Goal.`

    const goalName = escapeRuleText(selectedGoal.name) || 'the selected Goal'
    const goalId = escapeRuleText(selectedGoal.goalId)
    return `${prefix}add ${eventKind} "${summary}" to Goal "${goalName}" (Goal ID: "${goalId}").`
}

function appendDeterministicCalendarGoalFeedbackRule(currentRules = '', context = {}) {
    const nextRule = buildDeterministicCalendarGoalFeedbackRule(context)
    const existingRules = normalizeText(currentRules)
        .split('\n')
        .map(rule => rule.trim())
        .filter(Boolean)
        .filter(rule => rule !== nextRule)
    return [nextRule, ...existingRules].join('\n').slice(0, MAX_LEARNED_RULES_LENGTH)
}

async function reviseCalendarGoalLearnedRules({ currentRules, project, event, previousGoal, selectedGoal }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('Calendar Goal feedback revision unavailable: missing OpenAI key')

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(CALENDAR_GOAL_FEEDBACK_REVISION_MODEL)
    const requestParams = {
        model: selectedModel,
        messages: [
            { role: 'system', content: REVISION_SYSTEM_PROMPT },
            {
                role: 'user',
                content:
                    `Current Goal rules:\n${currentRules || '(none)'}\n\n` +
                    `Project:\n${JSON.stringify(project, null, 2)}\n\n` +
                    `Calendar event:\n${JSON.stringify(event, null, 2)}\n\n` +
                    `Previous Goal:\n${JSON.stringify(previousGoal, null, 2)}\n\n` +
                    `Authoritative selected Goal (null means no Goal):\n${JSON.stringify(selectedGoal, null, 2)}\n\n` +
                    'Return JSON exactly like {"learnedGoalRules":"- In project Acme, recurring status meetings go to Goal Client delivery."}.',
            },
        ],
    }
    if (!isGpt5ReasoningModel(CALENDAR_GOAL_FEEDBACK_REVISION_MODEL)) requestParams.temperature = 0.1
    if (selectedModel.startsWith('gpt-5.6')) requestParams.prompt_cache_options = { mode: 'explicit', ttl: '30m' }

    const completion = await openai.chat.completions.create(requestParams)
    logOpenAiCacheUsage({
        usage: completion?.usage,
        route: 'calendar-goal-routing-feedback-revision',
        model: selectedModel,
        cacheMode: requestParams.prompt_cache_options ? 'explicit-no-breakpoint' : 'automatic',
    })
    const parsed = extractJsonFromText(completion?.choices?.[0]?.message?.content || '')
    const revisedRules = typeof parsed?.learnedGoalRules === 'string' ? parsed.learnedGoalRules.trim() : ''
    if (!revisedRules) throw new Error('Calendar Goal feedback revision produced no rules text')
    return revisedRules.slice(0, MAX_LEARNED_RULES_LENGTH)
}

function buildUpdatedGoalSeriesRoutes(
    config = {},
    event = {},
    project = {},
    selectedGoal = null,
    feedbackId = '',
    learnedAt = Date.now()
) {
    const recurringEventId = normalizeText(event.recurringEventId)
    if (!recurringEventId) return normalizeLearnedGoalSeriesRoutes(config.learnedGoalSeriesRoutes)

    const routeKey = buildCalendarGoalSeriesRouteKey(event.provider, recurringEventId, project.projectId)
    return normalizeLearnedGoalSeriesRoutes({
        ...(config.learnedGoalSeriesRoutes || {}),
        [routeKey]: {
            recurringEventId,
            provider: event.provider || 'google',
            projectId: project.projectId,
            projectName: project.name,
            targetGoalId: selectedGoal?.goalId || '',
            targetGoalName: selectedGoal?.name || '',
            routeToNoGoal: !selectedGoal,
            eventSummary: event.summary,
            feedbackId,
            learnedAt,
        },
    })
}

async function initializeGoalFeedbackAudit(feedbackRef, auditData) {
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

async function ensureLearnedGoalRuleFeed({ feedback, feedbackRef, marker, projectData, selectedGoal, task, userData }) {
    if (!feedback?.learnedRuleCreated || feedback.feedCreatedAt) return false

    const { feedId } = await createCalendarLearnedRuleFeed({
        feedbackId: marker.feedbackId,
        projectId: marker.projectId,
        projectData,
        task,
        userId: marker.requestedByUserId,
        userData,
        ruleType: 'goal',
        selectedGoal,
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

function goalContextFromDoc(goalDoc, fallbackId = '') {
    if (!goalDoc?.exists) return null
    const data = goalDoc.data() || {}
    return {
        goalId: goalDoc.id || fallbackId,
        name: normalizeText(data.extendedName || data.name) || 'Untitled Goal',
    }
}

async function captureCalendarGoalRoutingFeedback({ task = {}, previousTask = null, taskProjectId = '' } = {}) {
    const marker = normalizeGoalFeedbackMarker(task, taskProjectId)
    if (!marker) return { status: 'skipped', reason: 'no_goal_feedback_marker' }

    const taskGoalId = normalizeOptionalId(task.parentGoalId)
    if (taskGoalId !== marker.selectedGoalId) return { status: 'skipped', reason: 'selected_goal_mismatch' }
    if (previousTask && normalizeOptionalId(previousTask.parentGoalId) !== marker.previousGoalId) {
        return { status: 'skipped', reason: 'previous_goal_mismatch' }
    }

    const db = admin.firestore()
    const userRef = db.doc(`users/${marker.requestedByUserId}`)
    const projectRef = db.doc(`projects/${marker.projectId}`)
    const refs = [userRef, projectRef]
    if (marker.selectedGoalId) refs.push(db.doc(`goals/${marker.projectId}/items/${marker.selectedGoalId}`))
    if (marker.previousGoalId) refs.push(db.doc(`goals/${marker.projectId}/items/${marker.previousGoalId}`))
    const docs = await db.getAll(...refs)
    const [userDoc, projectDoc] = docs
    if (!userDoc?.exists || !projectDoc?.exists) return { status: 'skipped', reason: 'missing_context' }

    const userData = userDoc.data() || {}
    const projectData = projectDoc.data() || {}
    const accessibleProjectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    if (
        userData?.premium?.status !== PLAN_STATUS_PREMIUM ||
        !accessibleProjectIds.includes(marker.projectId) ||
        projectData.active === false ||
        projectData.isTemplate === true ||
        projectData.parentTemplateId
    ) {
        return { status: 'skipped', reason: 'routing_not_available' }
    }

    let cursor = 2
    const selectedGoalDoc = marker.selectedGoalId ? docs[cursor++] : null
    const previousGoalDoc = marker.previousGoalId ? docs[cursor] : null
    if (selectedGoalDoc?.exists) {
        const selectedGoalIsPublicFor = Array.isArray(selectedGoalDoc.data()?.isPublicFor)
            ? selectedGoalDoc.data().isPublicFor
            : [0]
        if (!selectedGoalIsPublicFor.includes(0) && !selectedGoalIsPublicFor.includes(marker.requestedByUserId)) {
            return { status: 'skipped', reason: 'selected_goal_not_visible' }
        }
    }
    const selectedGoal = marker.selectedGoalId ? goalContextFromDoc(selectedGoalDoc, marker.selectedGoalId) : null
    if (marker.selectedGoalId && !selectedGoal) return { status: 'skipped', reason: 'selected_goal_missing' }
    const previousGoal = marker.previousGoalId
        ? goalContextFromDoc(previousGoalDoc, marker.previousGoalId) || { goalId: marker.previousGoalId, name: '' }
        : null

    const initialConfigContext = await loadCalendarProjectRoutingConfig(
        marker.requestedByUserId,
        marker.syncProjectId,
        task?.calendarData?.email || ''
    )
    if (!initialConfigContext.exists || !initialConfigContext.config.enabled) {
        return { status: 'skipped', reason: 'routing_not_configured' }
    }

    const project = {
        projectId: marker.projectId,
        name: normalizeText(projectData.name) || 'Untitled project',
    }
    const event = normalizeEventContext(task)
    const feedbackRef = initialConfigContext.ref.collection('goalFeedback').doc(marker.feedbackId)
    const completedFeedback = await initializeGoalFeedbackAudit(feedbackRef, {
        feedbackId: marker.feedbackId,
        userId: marker.requestedByUserId,
        syncProjectId: marker.syncProjectId,
        projectId: marker.projectId,
        previousGoalId: marker.previousGoalId,
        selectedGoalId: marker.selectedGoalId,
        requestedAt: marker.requestedAt,
        event,
        project,
        previousGoal,
        selectedGoal,
        previousRouting: task?.goalSuggestion || null,
    })
    if (completedFeedback) {
        await ensureLearnedGoalRuleFeed({
            feedback: completedFeedback,
            feedbackRef,
            marker,
            projectData,
            selectedGoal,
            task,
            userData,
        })
        return { status: 'completed', alreadyApplied: true }
    }

    for (let attempt = 0; attempt < MAX_RULE_REVISION_ATTEMPTS; attempt++) {
        const configContext = await loadCalendarProjectRoutingConfig(
            marker.requestedByUserId,
            marker.syncProjectId,
            task?.calendarData?.email || ''
        )
        const currentConfig = configContext.config
        const currentRevision = currentConfig.learnedGoalRulesRevision || 0
        let learnedGoalRules

        try {
            learnedGoalRules = await reviseCalendarGoalLearnedRules({
                currentRules: currentConfig.learnedGoalRules,
                project,
                event,
                previousGoal,
                selectedGoal,
            })
        } catch (error) {
            console.warn('[calendarGoalRoutingFeedback] Using deterministic feedback rule fallback', {
                feedbackId: marker.feedbackId,
                error: error.message,
            })
            learnedGoalRules = appendDeterministicCalendarGoalFeedbackRule(currentConfig.learnedGoalRules, {
                event,
                project,
                selectedGoal,
            })
        }

        const learnedAt = Date.now()
        const learnedGoalSeriesRoutes = buildUpdatedGoalSeriesRoutes(
            currentConfig,
            event,
            project,
            selectedGoal,
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
                const persistedRevision = Number.isFinite(persistedConfig.learnedGoalRulesRevision)
                    ? Number(persistedConfig.learnedGoalRulesRevision)
                    : 0
                if (persistedRevision !== currentRevision) {
                    const conflict = new Error('Calendar Goal learned rules changed during feedback revision')
                    conflict.code = RULE_REVISION_CONFLICT
                    throw conflict
                }

                learnedRuleCreated = normalizeText(persistedConfig.learnedGoalRules) !== normalizeText(learnedGoalRules)

                transaction.set(
                    configContext.ref,
                    {
                        learnedGoalRules,
                        learnedGoalRulesRevision: currentRevision + 1,
                        learnedGoalSeriesRoutes,
                        updatedAt: Timestamp.now(),
                        updatedBy: marker.requestedByUserId,
                    },
                    { merge: true }
                )
                transaction.set(
                    feedbackRef,
                    {
                        status: 'completed',
                        learnedGoalRules,
                        learnedGoalRulesRevision: currentRevision + 1,
                        learnedGoalSeriesRouteApplied: !!event.recurringEventId,
                        learnedRuleCreated,
                        completedAt: Timestamp.now(),
                    },
                    { merge: true }
                )
            })

            const feedCreated = await ensureLearnedGoalRuleFeed({
                feedback: completedFeedbackFromTransaction || {
                    learnedRuleCreated,
                },
                feedbackRef,
                marker,
                projectData,
                selectedGoal,
                task,
                userData,
            })

            return {
                status: 'completed',
                alreadyApplied,
                feedCreated,
                learnedGoalRules,
                learnedGoalSeriesRouteApplied: !!event.recurringEventId,
            }
        } catch (error) {
            if (error?.code === RULE_REVISION_CONFLICT && attempt + 1 < MAX_RULE_REVISION_ATTEMPTS) continue
            throw error
        }
    }

    throw new Error('Calendar Goal feedback could not be committed after concurrent rule updates')
}

module.exports = {
    CALENDAR_GOAL_FEEDBACK_REVISION_MODEL,
    appendDeterministicCalendarGoalFeedbackRule,
    buildDeterministicCalendarGoalFeedbackRule,
    buildUpdatedGoalSeriesRoutes,
    captureCalendarGoalRoutingFeedback,
    normalizeGoalFeedbackMarker,
    reviseCalendarGoalLearnedRules,
}
