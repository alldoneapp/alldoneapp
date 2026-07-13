const MAX_LOOKBACK_DAYS = 30
const MAX_MESSAGES_PER_RUN = 100
const MIN_SYNC_INTERVAL_MINUTES = 5
const MAX_SYNC_INTERVAL_MINUTES = 24 * 60
const GMAIL_LABELING_PROMPT_MODE_DEFAULT = 'default'
const GMAIL_LABELING_PROMPT_MODE_CUSTOM = 'custom'
// Client mirror of the shared Ads guidance in functions/Gmail/serverSideGmailLabelingSync.js —
// keep the texts identical, they only exist here for the default-config preview.
const DEFAULT_ADS_LABEL_GUIDANCE =
    'Use Ads for promotional, marketing, sales, spam, or unsolicited commercial email, including personalized cold sales outreach. ' +
    'A recurring newsletter the user intentionally subscribed to (editorial or digest content) is not Ads; a one-off promotion, discount, or product pitch is Ads, even from a familiar sender. ' +
    'Never use Ads for transactional email such as receipts, invoices, order or shipping confirmations, or account, billing, and security notifications. ' +
    'An email that is a reply in an existing conversation (inReplyTo or references is set) is never Ads. ' +
    "Gmail's CATEGORY_PROMOTIONS label id and a List-Unsubscribe header are strong Ads signals. " +
    'If an email matches both a project label and Ads, prefer the project label unless the email is pure bulk marketing.'
const DEFAULT_ACTIVE_PROJECTS_PROMPT =
    'Classify each Gmail message into exactly one configured label when it clearly belongs to an active Alldone project or the Ads label. Use the label descriptions as the primary basis for deciding. Prefer the strongest specific project label when the evidence is clear. If the email is work-relevant but it is not clear which project label fits best, use the default project label. Use matched:false only when it does not relate to any configured project or Ads label. Consider participants, project names, client names, sender domains, subjects, deadlines, action requests, decisions, deliverables, business context, and project-specific Alldone links. ' +
    DEFAULT_ADS_LABEL_GUIDANCE +
    ' Use the configured confidence threshold for specific non-default project and Ads matches. If project relevance is present but no non-default project reaches that threshold, use the default project label. Confidence for a match means confidence in the selected label; confidence for matched:false means confidence that no configured label applies. Do not use matched:false when your reasoning identifies a configured project, client, sender domain, project-specific link, or clear Ads email; use the matching configured label instead.'
const DEFAULT_PROJECT_FOLLOW_UP_DIRECTION_SCOPE = 'incoming'
const DEFAULT_ADS_LABEL_DEFINITION = {
    key: 'ads',
    gmailLabelName: 'Ads',
    description: DEFAULT_ADS_LABEL_GUIDANCE,
    directionScope: 'incoming',
    autoArchive: false,
    postLabelPrompt: '',
}
const DEFAULT_CUSTOM_GMAIL_LABELING_PROMPT =
    'Read each Gmail message and assign exactly one of the configured Gmail labels when it clearly matches. Messages may be incoming or outgoing depending on the rule scope. Prefer the strongest specific label when the evidence is clear. Use the configured confidence threshold for specific label matches. If the email is work-relevant but it is not clear which label fits best, use the default project as the label. Use matched:false only when the email is not work-relevant and no configured label applies. Confidence for a match means confidence in the selected label; confidence for matched:false means confidence that no configured label applies. Do not use matched:false when your reasoning identifies a configured label, client, sender domain, or project-specific link. Focus on participants, subject, deadlines, action requests, decisions, deliverables, and business relevance.'
const STARTER_CUSTOM_LABEL_DEFINITIONS = [
    {
        key: 'newsletter',
        gmailLabelName: 'Alldone/Newsletter',
        description: 'Low priority newsletters and automated updates',
        directionScope: 'incoming',
        autoArchive: true,
        postLabelPrompt: '',
    },
    {
        key: 'urgent_client',
        gmailLabelName: 'Alldone/Urgent Client',
        description: 'Important client emails requiring fast action',
        directionScope: 'both',
        autoArchive: false,
        postLabelPrompt: '',
    },
]

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

function buildCustomDefaultsForReset() {
    return {
        prompt: DEFAULT_CUSTOM_GMAIL_LABELING_PROMPT,
        labelDefinitions: STARTER_CUSTOM_LABEL_DEFINITIONS.map((label, index) => ({
            ...createEmptyLabel(index),
            ...label,
            id: `custom-default-${Date.now()}-${index}`,
        })),
    }
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
        autoArchiveAllLabeled: config.autoArchiveAllLabeled === true,
        lookbackDays: Number.isFinite(config.lookbackDays) ? String(config.lookbackDays) : '7',
        syncIntervalMinutes: Number.isFinite(config.syncIntervalMinutes) ? String(config.syncIntervalMinutes) : '5',
        maxMessagesPerRun: Number.isFinite(config.maxMessagesPerRun) ? String(config.maxMessagesPerRun) : '20',
        confidenceThreshold: Number.isFinite(config.confidenceThreshold) ? String(config.confidenceThreshold) : '0.7',
        labelDefinitions,
        learnedRules: typeof config.learnedRules === 'string' ? config.learnedRules : '',
        adsAutoArchive: config.adsAutoArchive === true,
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
        autoArchiveAllLabeled: config.autoArchiveAllLabeled === true,
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
        learnedRules: typeof config.learnedRules === 'string' ? config.learnedRules : '',
        adsAutoArchive: config.adsAutoArchive === true,
    }
}

function buildDefaultProjectLabelDescription(project = {}, labelName = '', isDefaultProject = false) {
    const projectName = typeof project.name === 'string' && project.name.trim() ? project.name.trim() : labelName
    const description =
        typeof project.description === 'string'
            ? project.description
                  .trim()
                  .replace(/^project description\s*:\s*/i, '')
                  .trim()
            : ''

    const defaultProjectGuidance = isDefaultProject
        ? ' This is the default project label; use it when an email is work-relevant but no other project label is clearly stronger.'
        : ''

    if (description) {
        return `Use this label for emails related to the Alldone project "${projectName}". ${description}. Match messages about this project's work, stakeholders, goals, deadlines, tasks, decisions, updates, or deliverables.${defaultProjectGuidance}`
    }

    return `Use this label for emails clearly related to the Alldone project "${projectName}". Match direct references to the project, its work, stakeholders, tasks, deadlines, decisions, updates, or deliverables.${defaultProjectGuidance}`
}

function buildDefaultProjectFollowUpPrompt(labelName = '') {
    const projectLabel = labelName || 'the matched project'
    return [
        `Use the supplied follow-up classification as authoritative; do not reclassify the email. When followUpType is "actionable", create a new task in the project ${projectLabel} based on this email in the following format: "[one sentence summary of the task] ".`,
        `When followUpType is "informational", never create a task. Always add one concise comment to the topic chat "Daily emails ${projectLabel} [today's date]" with createIfMissing=true. Every informational email gets exactly one comment, including routine, promotional, automated, or redundant ones. The comment should be in this format: "LINK: Email from [sender name] ([sender email]): [one-line summary]". Use the Gmail web URL from the email context as LINK.`,
        `If the email is from a real person (e.g. not notification from google calendar or something like hello@cal.com) also use update_note with the project ${projectLabel} to update the contact note and include a link to the email with a space at the end.`,
    ].join('\n')
}

function slugifyLabelKey(value = '') {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

function buildDefaultConfigPreviewFromProjects(projects = [], defaultProjectId = '') {
    const counts = new Map()
    const normalizedDefaultProjectId = typeof defaultProjectId === 'string' ? defaultProjectId.trim() : ''
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
            const isDefaultProject = !!normalizedDefaultProjectId && project.id === normalizedDefaultProjectId

            return {
                key: `project_${projectKey}`,
                gmailLabelName,
                description: buildDefaultProjectLabelDescription(project, gmailLabelName, isDefaultProject),
                directionScope: 'both',
                autoArchive: false,
                postLabelPrompt: buildDefaultProjectFollowUpPrompt(gmailLabelName),
                postLabelPromptDirectionScope: DEFAULT_PROJECT_FOLLOW_UP_DIRECTION_SCOPE,
                sourceProjectId: project.id || '',
            }
        })

    return {
        prompt: DEFAULT_ACTIVE_PROJECTS_PROMPT,
        labelDefinitions: [...labelDefinitions, { ...DEFAULT_ADS_LABEL_DEFINITION }],
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
    DEFAULT_CUSTOM_GMAIL_LABELING_PROMPT,
    DEFAULT_ADS_LABEL_DEFINITION,
    GMAIL_LABELING_PROMPT_MODE_CUSTOM,
    GMAIL_LABELING_PROMPT_MODE_DEFAULT,
    STARTER_CUSTOM_LABEL_DEFINITIONS,
    buildCustomDefaultsForReset,
    buildDefaultConfigPreviewFromProjects,
    buildDefaultProjectFollowUpPrompt,
    createEmptyLabel,
    formatPostLabelActionStatus,
    normalizeConfig,
    normalizePromptMode,
    sanitizeConfigForSave,
}
