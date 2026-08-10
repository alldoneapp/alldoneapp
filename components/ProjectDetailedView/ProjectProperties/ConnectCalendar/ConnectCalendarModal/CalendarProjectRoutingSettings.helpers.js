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
        model: config.model || 'MODEL_GPT5_4_NANO',
        confidenceThreshold: Number.isFinite(config.confidenceThreshold) ? String(config.confidenceThreshold) : '0.7',
    }
}

function sanitizeCalendarProjectRoutingConfigForSave(config = {}) {
    const parsedConfidenceThreshold = parseFloat(config.confidenceThreshold)

    return {
        enabled: !!config.enabled,
        calendarEmail: config.calendarEmail || '',
        prompt: config.prompt || DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
        model: config.model || 'MODEL_GPT5_4_NANO',
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold)
            ? Math.min(Math.max(parsedConfidenceThreshold, 0), 1)
            : 0.7,
    }
}

module.exports = {
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    buildProjectDefinitionsFromProjects,
    buildProjectRoutingDescription,
    cleanProjectDescription,
    normalizeCalendarProjectRoutingConfig,
    sanitizeCalendarProjectRoutingConfigForSave,
}
