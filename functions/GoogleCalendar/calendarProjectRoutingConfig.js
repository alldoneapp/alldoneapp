'use strict'

const admin = require('firebase-admin')
const { DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_GMAIL_LABELING_MODEL } = require('../Gmail/gmailLabelingConfig')

const CALENDAR_PROJECT_ROUTING_CONFIG_TYPE = 'calendarProjectRoutingConfig'
const DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT =
    'Choose exactly one active Alldone project for each Google Calendar event when the event clearly belongs to that project. Use the project descriptions as the primary context. Prefer precision over recall: if the event could belong to multiple projects, pick the strongest clear match only when the evidence is specific; otherwise return no match. Consider the event title, description, participants, organizer, location, meeting links, timing, project names, client names, stakeholders, goals, tasks, decisions, updates, and deliverables.'

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
        model:
            typeof input.model === 'string' && input.model.trim() ? input.model.trim() : DEFAULT_GMAIL_LABELING_MODEL,
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold)
            ? Math.min(Math.max(parsedConfidenceThreshold, 0), 1)
            : DEFAULT_CONFIDENCE_THRESHOLD,
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

    const now = admin.firestore.Timestamp.now()

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
    const { ref, config, exists } = await loadCalendarProjectRoutingConfig(userId, projectId, calendarEmail)
    const writeData = buildCalendarProjectRoutingConfigWriteData(
        userId,
        projectId,
        configInput,
        calendarEmail,
        exists ? config : null
    )

    await ref.set(writeData, { merge: true })
    return writeData
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
    buildCalendarProjectDefinitions,
    buildCalendarProjectRoutingConfigWriteData,
    buildProjectRoutingDescription,
    cleanProjectDescription,
    getCalendarProjectRoutingConfigDocId,
    getCalendarProjectRoutingConfigRef,
    getCalendarProjectRoutingConfigWithPreview,
    loadActiveProjectsForCalendarRouting,
    loadCalendarProjectRoutingConfig,
    normalizeCalendarProjectRoutingConfigInput,
    upsertCalendarProjectRoutingConfig,
    validateCalendarProjectRoutingConfig,
}
