'use strict'

const admin = require('firebase-admin')
const crypto = require('crypto')
const {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_GMAIL_LABELING_MODEL,
    GMAIL_LABELING_MODEL_KEYS,
    MAX_LEARNED_RULES_LENGTH,
} = require('../Gmail/gmailLabelingConfig')
const { Timestamp } = require('firebase-admin/firestore')

const CALENDAR_PROJECT_ROUTING_CONFIG_TYPE = 'calendarProjectRoutingConfig'
const MAX_CALENDAR_LEARNED_SERIES_ROUTES = 200
const MAX_CALENDAR_LEARNED_GOAL_SERIES_ROUTES = 200
const DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT =
    'Choose exactly one active Alldone project for each Google Calendar event when the event clearly belongs to that project. Use the project descriptions as the primary context. Prefer precision over recall: if the event could belong to multiple projects, pick the strongest clear match only when the evidence is specific; otherwise return no match. Consider the event title, description, attendees and their email addresses, organizer, creator, location, meeting links, timing, project names, client names, stakeholders, goals, tasks, decisions, updates, and deliverables. Pay particular attention to the attendees\' and organizer\'s email addresses and especially their domains: a shared company or client domain (for example everyone on "@acme.com") is a strong signal that the event belongs to the project tied to that company or client. Match those domains and individual addresses against the project descriptions, client names, and stakeholders to decide the project.'

/**
 * Calendar routing now validates its model against the same allowlist Gmail labeling uses, instead
 * of passing any string straight through.
 *
 * The pass-through was load-bearing by accident and actively harmful. Its only special case
 * (`=== 'MODEL_GPT5_6_LUNA'` → `DEFAULT_GMAIL_LABELING_MODEL`) was dead code, because that default
 * *is* Luna. So an arbitrary stored value reached `mapAssistantModelToOpenAIModel`, missed every
 * branch, and silently became `gpt-5.2` — which is exactly what happened in production: the client
 * helper defaulted this field to `MODEL_GPT5_4_NANO`, a key not in the selectable set, so calendar
 * routing has been running on `gpt-5.2` while reporting nano. Coercing an unknown key to the default
 * makes the stored value and the model actually used agree again, and is what stops a new
 * non-OpenAI key (AT-2238's DeepSeek) from being accepted here and then silently swapped for an
 * OpenAI model at request time.
 */
function normalizeCalendarProjectRoutingModel(model) {
    const normalizedModel = typeof model === 'string' ? model.trim() : ''
    if (!normalizedModel || !GMAIL_LABELING_MODEL_KEYS.has(normalizedModel)) return DEFAULT_GMAIL_LABELING_MODEL
    return normalizedModel
}

function getCalendarProjectRoutingConfigDocId(projectId) {
    return `calendarProjectRouting_${projectId}`
}

function getCalendarProjectRoutingConfigRef(userId, projectId) {
    return admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc(getCalendarProjectRoutingConfigDocId(projectId))
}

function appendCalendarLearnedRulesToPrompt(prompt = '', learnedRules = '') {
    const rules = typeof learnedRules === 'string' ? learnedRules.trim() : ''
    if (!rules) return prompt
    return [prompt, `User routing feedback rules (always apply):\n${rules}`].filter(Boolean).join('\n\n')
}

function appendCalendarGoalLearnedRulesToPrompt(prompt = '', learnedGoalRules = '') {
    const rules = typeof learnedGoalRules === 'string' ? learnedGoalRules.trim() : ''
    if (!rules) return prompt
    return [prompt, `User calendar-to-Goal feedback rules (always apply):\n${rules}`].filter(Boolean).join('\n\n')
}

function buildCalendarSeriesRouteKey(provider = '', recurringEventId = '') {
    const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
    const normalizedRecurringEventId =
        typeof recurringEventId === 'string' ? recurringEventId.trim() : String(recurringEventId || '').trim()
    if (!normalizedRecurringEventId) return ''

    return crypto
        .createHash('sha256')
        .update(`${normalizedProvider || 'google'}:${normalizedRecurringEventId}`)
        .digest('hex')
        .slice(0, 32)
}

function buildCalendarGoalSeriesRouteKey(provider = '', recurringEventId = '', projectId = '') {
    const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
    const normalizedRecurringEventId =
        typeof recurringEventId === 'string' ? recurringEventId.trim() : String(recurringEventId || '').trim()
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : ''
    if (!normalizedRecurringEventId || !normalizedProjectId) return ''

    return crypto
        .createHash('sha256')
        .update(`${normalizedProvider || 'google'}:${normalizedRecurringEventId}:${normalizedProjectId}`)
        .digest('hex')
        .slice(0, 32)
}

function normalizeLearnedSeriesRoutes(routes = {}) {
    if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return {}

    return Object.entries(routes)
        .map(([key, route]) => {
            const recurringEventId = typeof route?.recurringEventId === 'string' ? route.recurringEventId.trim() : ''
            const targetProjectId = typeof route?.targetProjectId === 'string' ? route.targetProjectId.trim() : ''
            if (!key || !recurringEventId || !targetProjectId) return null

            return [
                key,
                {
                    recurringEventId,
                    provider: typeof route.provider === 'string' ? route.provider.trim().toLowerCase() : 'google',
                    targetProjectId,
                    targetProjectName:
                        typeof route.targetProjectName === 'string' ? route.targetProjectName.trim() : '',
                    eventSummary: typeof route.eventSummary === 'string' ? route.eventSummary.trim() : '',
                    feedbackId: typeof route.feedbackId === 'string' ? route.feedbackId.trim() : '',
                    learnedAt: Number.isFinite(route.learnedAt) ? Number(route.learnedAt) : 0,
                },
            ]
        })
        .filter(Boolean)
        .sort((left, right) => right[1].learnedAt - left[1].learnedAt)
        .slice(0, MAX_CALENDAR_LEARNED_SERIES_ROUTES)
        .reduce((normalized, [key, route]) => {
            normalized[key] = route
            return normalized
        }, {})
}

function normalizeLearnedGoalSeriesRoutes(routes = {}) {
    if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return {}

    return Object.entries(routes)
        .map(([key, route]) => {
            const recurringEventId = typeof route?.recurringEventId === 'string' ? route.recurringEventId.trim() : ''
            const projectId = typeof route?.projectId === 'string' ? route.projectId.trim() : ''
            const targetGoalId = typeof route?.targetGoalId === 'string' ? route.targetGoalId.trim() : ''
            const routeToNoGoal = route?.routeToNoGoal === true
            if (!key || !recurringEventId || !projectId || (!targetGoalId && !routeToNoGoal)) return null

            return [
                key,
                {
                    recurringEventId,
                    provider: typeof route.provider === 'string' ? route.provider.trim().toLowerCase() : 'google',
                    projectId,
                    projectName: typeof route.projectName === 'string' ? route.projectName.trim() : '',
                    targetGoalId: routeToNoGoal ? '' : targetGoalId,
                    targetGoalName:
                        !routeToNoGoal && typeof route.targetGoalName === 'string' ? route.targetGoalName.trim() : '',
                    routeToNoGoal,
                    eventSummary: typeof route.eventSummary === 'string' ? route.eventSummary.trim() : '',
                    feedbackId: typeof route.feedbackId === 'string' ? route.feedbackId.trim() : '',
                    learnedAt: Number.isFinite(route.learnedAt) ? Number(route.learnedAt) : 0,
                },
            ]
        })
        .filter(Boolean)
        .sort((left, right) => right[1].learnedAt - left[1].learnedAt)
        .slice(0, MAX_CALENDAR_LEARNED_GOAL_SERIES_ROUTES)
        .reduce((normalized, [key, route]) => {
            normalized[key] = route
            return normalized
        }, {})
}

function findLearnedCalendarSeriesRoute(config = {}, event = {}) {
    const recurringEventId =
        typeof event.recurringEventId === 'string'
            ? event.recurringEventId.trim()
            : typeof event.seriesMasterId === 'string'
              ? event.seriesMasterId.trim()
              : ''
    if (!recurringEventId) return null

    const provider = typeof event.provider === 'string' ? event.provider : 'google'
    const routeKey = buildCalendarSeriesRouteKey(provider, recurringEventId)
    return normalizeLearnedSeriesRoutes(config.learnedSeriesRoutes)[routeKey] || null
}

function findLearnedCalendarGoalSeriesRoute(config = {}, event = {}, projectId = '') {
    const recurringEventId =
        typeof event.recurringEventId === 'string'
            ? event.recurringEventId.trim()
            : typeof event.seriesMasterId === 'string'
              ? event.seriesMasterId.trim()
              : ''
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : ''
    if (!recurringEventId || !normalizedProjectId) return null

    const provider = typeof event.provider === 'string' ? event.provider : 'google'
    const routeKey = buildCalendarGoalSeriesRouteKey(provider, recurringEventId, normalizedProjectId)
    return normalizeLearnedGoalSeriesRoutes(config.learnedGoalSeriesRoutes)[routeKey] || null
}

function cleanProjectDescription(description = '') {
    return typeof description === 'string'
        ? description
              .trim()
              .replace(/^project description\s*:\s*/i, '')
              .trim()
        : ''
}

function normalizeCalendarProjectRoutingConfigInput(projectId, input = {}, calendarEmail = '') {
    const parsedConfidenceThreshold = Number(input.confidenceThreshold)

    return {
        type: CALENDAR_PROJECT_ROUTING_CONFIG_TYPE,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : false,
        projectId,
        calendarEmail:
            typeof input.calendarEmail === 'string' && input.calendarEmail.trim()
                ? input.calendarEmail.trim().toLowerCase()
                : calendarEmail || '',
        prompt:
            typeof input.prompt === 'string' && input.prompt.trim()
                ? input.prompt.trim()
                : DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
        model: normalizeCalendarProjectRoutingModel(input.model),
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold)
            ? Math.min(Math.max(parsedConfidenceThreshold, 0), 1)
            : DEFAULT_CONFIDENCE_THRESHOLD,
        learnedRules:
            typeof input.learnedRules === 'string' ? input.learnedRules.trim().slice(0, MAX_LEARNED_RULES_LENGTH) : '',
        learnedRulesRevision: Number.isFinite(input.learnedRulesRevision)
            ? Math.max(0, Math.trunc(input.learnedRulesRevision))
            : 0,
        learnedSeriesRoutes: normalizeLearnedSeriesRoutes(input.learnedSeriesRoutes),
        learnedGoalRules:
            typeof input.learnedGoalRules === 'string'
                ? input.learnedGoalRules.trim().slice(0, MAX_LEARNED_RULES_LENGTH)
                : '',
        learnedGoalRulesRevision: Number.isFinite(input.learnedGoalRulesRevision)
            ? Math.max(0, Math.trunc(input.learnedGoalRulesRevision))
            : 0,
        learnedGoalSeriesRoutes: normalizeLearnedGoalSeriesRoutes(input.learnedGoalSeriesRoutes),
    }
}

function validateCalendarProjectRoutingConfig(config = {}) {
    const errors = []

    if (!config.projectId || typeof config.projectId !== 'string') {
        errors.push('A valid projectId is required.')
    }

    if (config.enabled && (!config.prompt || typeof config.prompt !== 'string' || !config.prompt.trim())) {
        errors.push('Prompt is required when Calendar project routing is enabled.')
    }

    return {
        valid: errors.length === 0,
        errors,
    }
}

function buildCalendarProjectRoutingConfigWriteData(userId, projectId, configInput, calendarEmail = '', existingData) {
    const normalizedConfig = normalizeCalendarProjectRoutingConfigInput(projectId, configInput, calendarEmail)
    const validation = validateCalendarProjectRoutingConfig(normalizedConfig)

    if (!validation.valid) {
        const error = new Error(validation.errors.join(' '))
        error.validationErrors = validation.errors
        throw error
    }

    const now = Timestamp.now()
    const hasLearnedRules = Object.prototype.hasOwnProperty.call(configInput || {}, 'learnedRules')
    const existingLearnedRules = typeof existingData?.learnedRules === 'string' ? existingData.learnedRules : ''
    const existingLearnedRulesRevision = Number.isFinite(existingData?.learnedRulesRevision)
        ? Math.max(0, Math.trunc(existingData.learnedRulesRevision))
        : 0

    if (!hasLearnedRules) {
        normalizedConfig.learnedRules = existingLearnedRules
        normalizedConfig.learnedRulesRevision = existingLearnedRulesRevision
    } else {
        const submittedLearnedRulesRevision = Number.isFinite(configInput.learnedRulesRevision)
            ? Math.max(0, Math.trunc(configInput.learnedRulesRevision))
            : existingLearnedRulesRevision
        if (
            existingData &&
            submittedLearnedRulesRevision < existingLearnedRulesRevision &&
            normalizedConfig.learnedRules !== existingLearnedRules
        ) {
            const error = new Error(
                'Calendar routing learned rules changed while settings were open. Reload and try again.'
            )
            error.validationErrors = [error.message]
            throw error
        }
        normalizedConfig.learnedRulesRevision =
            normalizedConfig.learnedRules === existingLearnedRules
                ? existingLearnedRulesRevision
                : existingLearnedRulesRevision + 1
    }

    // Series mappings are written only by routing feedback. Settings saves from older or current
    // clients must never erase them. Explicitly clearing a non-empty learned-rules block is the
    // reset gesture for both the readable rules and the hidden exact recurring-series mappings.
    const explicitlyClearedLearnedRules = hasLearnedRules && !!existingLearnedRules && !normalizedConfig.learnedRules
    normalizedConfig.learnedSeriesRoutes = explicitlyClearedLearnedRules
        ? {}
        : normalizeLearnedSeriesRoutes(existingData?.learnedSeriesRoutes)

    const hasLearnedGoalRules = Object.prototype.hasOwnProperty.call(configInput || {}, 'learnedGoalRules')
    const existingLearnedGoalRules =
        typeof existingData?.learnedGoalRules === 'string' ? existingData.learnedGoalRules : ''
    const existingLearnedGoalRulesRevision = Number.isFinite(existingData?.learnedGoalRulesRevision)
        ? Math.max(0, Math.trunc(existingData.learnedGoalRulesRevision))
        : 0

    if (!hasLearnedGoalRules) {
        normalizedConfig.learnedGoalRules = existingLearnedGoalRules
        normalizedConfig.learnedGoalRulesRevision = existingLearnedGoalRulesRevision
    } else {
        const submittedLearnedGoalRulesRevision = Number.isFinite(configInput.learnedGoalRulesRevision)
            ? Math.max(0, Math.trunc(configInput.learnedGoalRulesRevision))
            : existingLearnedGoalRulesRevision
        if (
            existingData &&
            submittedLearnedGoalRulesRevision < existingLearnedGoalRulesRevision &&
            normalizedConfig.learnedGoalRules !== existingLearnedGoalRules
        ) {
            const error = new Error(
                'Calendar Goal routing learned rules changed while settings were open. Reload and try again.'
            )
            error.validationErrors = [error.message]
            throw error
        }
        normalizedConfig.learnedGoalRulesRevision =
            normalizedConfig.learnedGoalRules === existingLearnedGoalRules
                ? existingLearnedGoalRulesRevision
                : existingLearnedGoalRulesRevision + 1
    }

    const explicitlyClearedLearnedGoalRules =
        hasLearnedGoalRules && !!existingLearnedGoalRules && !normalizedConfig.learnedGoalRules
    normalizedConfig.learnedGoalSeriesRoutes = explicitlyClearedLearnedGoalRules
        ? {}
        : normalizeLearnedGoalSeriesRoutes(existingData?.learnedGoalSeriesRoutes)

    return {
        ...normalizedConfig,
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
        updatedBy: userId,
    }
}

function getActiveProjectIdsFromUserData(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const archivedProjectIds = Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : []
    const templateProjectIds = Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : []
    const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []
    const blockedProjectIds = new Set([...archivedProjectIds, ...templateProjectIds, ...guideProjectIds])

    return projectIds.filter(
        projectId => typeof projectId === 'string' && projectId.trim() && !blockedProjectIds.has(projectId)
    )
}

function buildProjectRoutingDescription(project = {}) {
    const name = typeof project.name === 'string' && project.name.trim() ? project.name.trim() : 'Untitled project'
    const description = cleanProjectDescription(project.description)

    if (description) {
        return `Use this project for calendar events related to "${name}". ${description}. Match meetings about this project's stakeholders, goals, tasks, deadlines, decisions, updates, or deliverables.`
    }

    return `Use this project for calendar events clearly related to "${name}". Match direct references to the project, its work, stakeholders, tasks, deadlines, decisions, updates, or deliverables.`
}

function buildCalendarProjectDefinitions(projects = []) {
    return projects
        .filter(
            project =>
                project && project.id && project.active !== false && !project.isTemplate && !project.parentTemplateId
        )
        .map((project, index) => {
            const name =
                typeof project.name === 'string' && project.name.trim()
                    ? project.name.trim()
                    : `Untitled project ${index + 1}`
            const description = cleanProjectDescription(project.description)

            return {
                projectId: project.id,
                name,
                description,
                routingDescription: buildProjectRoutingDescription({ ...project, name, description }),
            }
        })
}

async function loadActiveProjectsForCalendarRouting(userData = {}) {
    const activeProjectIds = getActiveProjectIdsFromUserData(userData)
    if (activeProjectIds.length === 0) return []

    const projectDocs = await Promise.all(
        activeProjectIds.map(projectId =>
            admin
                .firestore()
                .collection('projects')
                .doc(projectId)
                .get()
                .catch(error => {
                    console.warn('[calendarProjectRouting] Failed loading active project', {
                        projectId,
                        error: error.message,
                    })
                    return null
                })
        )
    )

    return projectDocs
        .map(doc => {
            if (!doc?.exists) return null
            const data = doc.data() || {}
            return {
                id: doc.id,
                name: data.name || '',
                description: data.description || '',
                active: data.active,
                isTemplate: data.isTemplate,
                parentTemplateId: data.parentTemplateId,
            }
        })
        .filter(Boolean)
}

async function loadCalendarProjectRoutingConfig(userId, projectId, calendarEmail = '') {
    const ref = getCalendarProjectRoutingConfigRef(userId, projectId)
    const doc = await ref.get()

    if (!doc.exists) {
        return {
            config: normalizeCalendarProjectRoutingConfigInput(projectId, {}, calendarEmail),
            exists: false,
            ref,
        }
    }

    const data = doc.data() || {}

    return {
        config: {
            ...normalizeCalendarProjectRoutingConfigInput(projectId, data, calendarEmail),
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            updatedBy: data.updatedBy || '',
        },
        exists: true,
        ref,
    }
}

async function upsertCalendarProjectRoutingConfig(userId, projectId, configInput, calendarEmail = '') {
    const ref = getCalendarProjectRoutingConfigRef(userId, projectId)
    return await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const existingData = snapshot.exists ? snapshot.data() || {} : null
        const writeData = buildCalendarProjectRoutingConfigWriteData(
            userId,
            projectId,
            configInput,
            calendarEmail,
            existingData
        )

        transaction.set(ref, writeData, { merge: true })
        return writeData
    })
}

async function getCalendarProjectRoutingConfigWithPreview(userId, projectId, calendarEmail = '', userData = {}) {
    const { config } = await loadCalendarProjectRoutingConfig(userId, projectId, calendarEmail)
    const activeProjects = await loadActiveProjectsForCalendarRouting(userData)

    return {
        config,
        projectDefinitions: buildCalendarProjectDefinitions(activeProjects),
        defaultPrompt: DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    }
}

module.exports = {
    CALENDAR_PROJECT_ROUTING_CONFIG_TYPE,
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    MAX_CALENDAR_LEARNED_SERIES_ROUTES,
    MAX_CALENDAR_LEARNED_GOAL_SERIES_ROUTES,
    appendCalendarGoalLearnedRulesToPrompt,
    appendCalendarLearnedRulesToPrompt,
    buildCalendarGoalSeriesRouteKey,
    buildCalendarSeriesRouteKey,
    buildCalendarProjectDefinitions,
    buildCalendarProjectRoutingConfigWriteData,
    buildProjectRoutingDescription,
    cleanProjectDescription,
    getCalendarProjectRoutingConfigDocId,
    getCalendarProjectRoutingConfigRef,
    getCalendarProjectRoutingConfigWithPreview,
    findLearnedCalendarSeriesRoute,
    findLearnedCalendarGoalSeriesRoute,
    loadActiveProjectsForCalendarRouting,
    loadCalendarProjectRoutingConfig,
    normalizeCalendarProjectRoutingConfigInput,
    normalizeLearnedGoalSeriesRoutes,
    normalizeLearnedSeriesRoutes,
    upsertCalendarProjectRoutingConfig,
    validateCalendarProjectRoutingConfig,
}
