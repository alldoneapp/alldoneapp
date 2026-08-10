const { SELECTABLE_ASSISTANT_MODELS } = require('../../../../../functions/Assistant/selectableAssistantModels')

/**
 * Mirrors the server-side allowlist in `functions/GoogleCalendar/calendarProjectRoutingConfig.js`.
 *
 * This used to default to `'MODEL_GPT5_4_NANO'`, a key that is not in the selectable set and that
 * the server's key→model mapper does not know — so it fell through to `gpt-5.2`. Calendar routing
 * therefore ran on a model nobody had chosen, and the stored value never matched what was used.
 * Coercing to the shared default keeps the saved config and the model actually invoked in step.
 */
const CALENDAR_ROUTING_MODEL_KEYS = new Set(SELECTABLE_ASSISTANT_MODELS.map(option => option.model))
const DEFAULT_CALENDAR_ROUTING_MODEL = 'MODEL_GPT5_6_LUNA'

function normalizeCalendarRoutingModel(value) {
    return CALENDAR_ROUTING_MODEL_KEYS.has(value) ? value : DEFAULT_CALENDAR_ROUTING_MODEL
}

const DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT =
    'Choose exactly one active Alldone project for each Google Calendar event when the event clearly belongs to that project. Use the project descriptions as the primary context. Prefer precision over recall: if the event could belong to multiple projects, pick the strongest clear match only when the evidence is specific; otherwise return no match. Consider the event title, description, participants, organizer, location, meeting links, timing, project names, client names, stakeholders, goals, tasks, decisions, updates, and deliverables.'

function cleanProjectDescription(description = '') {
    return typeof description === 'string'
        ? description
              .trim()
              .replace(/^project description\s*:\s*/i, '')
              .trim()
        : ''
}

function buildProjectRoutingDescription(project = {}) {
    const name =
        typeof project.name === 'string' && project.name.trim()
            ? project.name.trim()
            : project.label || 'Untitled project'
    const description = cleanProjectDescription(project.description)

    if (description) {
        return `Use this project for calendar events related to "${name}". ${description}. Match meetings about this project's stakeholders, goals, tasks, deadlines, decisions, updates, or deliverables.`
    }

    return `Use this project for calendar events clearly related to "${name}". Match direct references to the project, its work, stakeholders, tasks, deadlines, decisions, updates, or deliverables.`
}

function buildProjectDefinitionsFromProjects(projects = []) {
    return projects
        .filter(project => project && project.active !== false && !project.isTemplate && !project.parentTemplateId)
        .map((project, index) => {
            const name =
                typeof project.name === 'string' && project.name.trim()
                    ? project.name.trim()
                    : `Untitled project ${index + 1}`
            const description = cleanProjectDescription(project.description)

            return {
                projectId: project.id || '',
                name,
                description,
                routingDescription: buildProjectRoutingDescription({ ...project, name, description }),
            }
        })
}

function normalizeCalendarProjectRoutingConfig(projectId, config = {}, calendarEmail = '') {
    return {
        enabled: typeof config.enabled === 'boolean' ? config.enabled : false,
        projectId,
        calendarEmail: config.calendarEmail || calendarEmail || '',
        prompt: config.prompt || DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
        model: normalizeCalendarRoutingModel(config.model),
        confidenceThreshold: Number.isFinite(config.confidenceThreshold) ? String(config.confidenceThreshold) : '0.7',
    }
}

function sanitizeCalendarProjectRoutingConfigForSave(config = {}) {
    const parsedConfidenceThreshold = parseFloat(config.confidenceThreshold)

    return {
        enabled: !!config.enabled,
        calendarEmail: config.calendarEmail || '',
        prompt: config.prompt || DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
        model: normalizeCalendarRoutingModel(config.model),
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold)
            ? Math.min(Math.max(parsedConfidenceThreshold, 0), 1)
            : 0.7,
    }
}

module.exports = {
    CALENDAR_ROUTING_MODEL_KEYS,
    DEFAULT_CALENDAR_ROUTING_MODEL,
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    normalizeCalendarRoutingModel,
    buildProjectDefinitionsFromProjects,
    buildProjectRoutingDescription,
    cleanProjectDescription,
    normalizeCalendarProjectRoutingConfig,
    sanitizeCalendarProjectRoutingConfigForSave,
}
