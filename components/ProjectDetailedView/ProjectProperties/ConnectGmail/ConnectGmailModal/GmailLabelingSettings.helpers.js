const MAX_LOOKBACK_DAYS = 30
const MAX_MESSAGES_PER_RUN = 100
const MIN_SYNC_INTERVAL_MINUTES = 5
const MAX_SYNC_INTERVAL_MINUTES = 24 * 60
const GMAIL_LABELING_PROMPT_MODE_DEFAULT = 'default'
const GMAIL_LABELING_PROMPT_MODE_CUSTOM = 'custom'
const DEFAULT_ACTIVE_PROJECTS_PROMPT =
    'Classify each Gmail message into exactly one active Alldone project label when the message clearly belongs to that project. Use the project descriptions in the configured labels as the primary basis for deciding. Prefer precision over recall: if the email could belong to multiple projects, pick the strongest clear match only when the evidence is specific; otherwise return no match. Consider participants, project names, client names, subjects, deadlines, action requests, decisions, deliverables, and business context. Do not label general newsletters, spam, or unrelated messages unless they clearly mention a configured active project.'

function createEmptyLabel(index = 0) {
    return {
        key: '',
        gmailLabelName: '',
        description: '',
        directionScope: 'incoming',
        autoArchive: false,
        postLabelPrompt: '',
        id: `label-${Date.now()}-${index}`,
    }
}

function normalizePromptMode(value, fallback = GMAIL_LABELING_PROMPT_MODE_DEFAULT) {
    return value === GMAIL_LABELING_PROMPT_MODE_CUSTOM || value === GMAIL_LABELING_PROMPT_MODE_DEFAULT
        ? value
        : fallback
}

function normalizeConfig(projectId, config = {}, gmailEmail = '') {
    const hasStoredConfig = !!config && Object.keys(config).length > 0
    const promptModeFallback = hasStoredConfig ? GMAIL_LABELING_PROMPT_MODE_CUSTOM : GMAIL_LABELING_PROMPT_MODE_DEFAULT
    const labelDefinitions = Array.isArray(config.labelDefinitions)
        ? config.labelDefinitions.map((label, index) => ({
              ...createEmptyLabel(index),
              ...label,
          }))
        : [createEmptyLabel(0), createEmptyLabel(1)]

    return {
        enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
        projectId,
        gmailEmail: config.gmailEmail || gmailEmail || '',
        promptMode: normalizePromptMode(config.promptMode, promptModeFallback),
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_4_NANO',
        processUnreadOnly: typeof config.processUnreadOnly === 'boolean' ? config.processUnreadOnly : true,
        onlyInbox: typeof config.onlyInbox === 'boolean' ? config.onlyInbox : true,
        lookbackDays: Number.isFinite(config.lookbackDays) ? String(config.lookbackDays) : '7',
        syncIntervalMinutes: Number.isFinite(config.syncIntervalMinutes) ? String(config.syncIntervalMinutes) : '5',
        maxMessagesPerRun: Number.isFinite(config.maxMessagesPerRun) ? String(config.maxMessagesPerRun) : '20',
        confidenceThreshold: Number.isFinite(config.confidenceThreshold) ? String(config.confidenceThreshold) : '0.7',
        labelDefinitions,
    }
}

function sanitizeConfigForSave(config) {
    const parsedLookbackDays = parseInt(config.lookbackDays, 10)
    const parsedSyncIntervalMinutes = parseInt(config.syncIntervalMinutes, 10)
    const parsedMaxMessages = parseInt(config.maxMessagesPerRun, 10)
    const parsedConfidenceThreshold = parseFloat(config.confidenceThreshold)

    return {
        enabled: !!config.enabled,
        gmailEmail: config.gmailEmail || '',
        promptMode: normalizePromptMode(config.promptMode),
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_4_NANO',
        processUnreadOnly: !!config.processUnreadOnly,
        onlyInbox: !!config.onlyInbox,
        lookbackDays: Number.isFinite(parsedLookbackDays)
            ? Math.min(Math.max(parsedLookbackDays, 1), MAX_LOOKBACK_DAYS)
            : 7,
        syncIntervalMinutes: Number.isFinite(parsedSyncIntervalMinutes)
            ? Math.min(Math.max(parsedSyncIntervalMinutes, MIN_SYNC_INTERVAL_MINUTES), MAX_SYNC_INTERVAL_MINUTES)
            : 5,
        maxMessagesPerRun: Number.isFinite(parsedMaxMessages)
            ? Math.min(Math.max(parsedMaxMessages, 1), MAX_MESSAGES_PER_RUN)
            : 20,
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold) ? parsedConfidenceThreshold : 0.7,
        labelDefinitions: (config.labelDefinitions || []).map(({ id, ...label }) => ({
            ...label,
            directionScope: label.directionScope || 'incoming',
            autoArchive: !!label.autoArchive,
            postLabelPrompt: label.postLabelPrompt || '',
        })),
    }
}

function buildDefaultProjectLabelDescription(project = {}, labelName = '') {
    const projectName = typeof project.name === 'string' && project.name.trim() ? project.name.trim() : labelName
    const description = typeof project.description === 'string' ? project.description.trim() : ''

    if (description) {
        return `Use this label for emails related to the Alldone project "${projectName}". Project description: ${description}. Match messages about this project's work, stakeholders, goals, deadlines, tasks, decisions, updates, or deliverables.`
    }

    return `Use this label for emails clearly related to the Alldone project "${projectName}". Match direct references to the project, its work, stakeholders, tasks, deadlines, decisions, updates, or deliverables.`
}

function slugifyLabelKey(value = '') {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

function buildDefaultConfigPreviewFromProjects(projects = []) {
    const counts = new Map()
    const labelDefinitions = projects
        .filter(project => project && project.active !== false && !project.isTemplate && !project.parentTemplateId)
        .map((project, index) => {
            const baseLabelName =
                typeof project.name === 'string' && project.name.trim()
                    ? project.name.trim()
                    : `Untitled project ${index + 1}`
            const lookup = baseLabelName.toLowerCase()
            const nextCount = (counts.get(lookup) || 0) + 1
            counts.set(lookup, nextCount)
            const gmailLabelName = nextCount === 1 ? baseLabelName : `${baseLabelName} (${nextCount})`
            const projectKey = slugifyLabelKey(project.id || gmailLabelName) || `project_${index + 1}`

            return {
                key: `project_${projectKey}`,
                gmailLabelName,
                description: buildDefaultProjectLabelDescription(project, gmailLabelName),
                directionScope: 'both',
                autoArchive: false,
                postLabelPrompt: '',
                sourceProjectId: project.id || '',
            }
        })

    return {
        prompt: DEFAULT_ACTIVE_PROJECTS_PROMPT,
        labelDefinitions,
    }
}

function formatPostLabelActionStatus(action = {}) {
    switch (action?.status) {
        case 'completed':
            return 'Completed'
        case 'failed':
            return 'Failed'
        case 'blocked':
            return 'Blocked'
        case 'skipped':
            return 'Skipped'
        default:
            return ''
    }
}

module.exports = {
    GMAIL_LABELING_PROMPT_MODE_CUSTOM,
    GMAIL_LABELING_PROMPT_MODE_DEFAULT,
    buildDefaultConfigPreviewFromProjects,
    createEmptyLabel,
    formatPostLabelActionStatus,
    normalizeConfig,
    normalizePromptMode,
    sanitizeConfigForSave,
}
