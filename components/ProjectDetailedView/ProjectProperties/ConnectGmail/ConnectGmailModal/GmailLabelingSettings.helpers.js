const MAX_LOOKBACK_DAYS = 30
const MAX_MESSAGES_PER_RUN = 100
const MIN_SYNC_INTERVAL_MINUTES = 5
const MAX_SYNC_INTERVAL_MINUTES = 24 * 60

function createEmptyLabel(index = 0) {
    return {
        key: '',
        gmailLabelName: '',
        description: '',
        autoArchive: false,
        postLabelPrompt: '',
        id: `label-${Date.now()}-${index}`,
    }
}

function normalizeConfig(projectId, config = {}, gmailEmail = '') {
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
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_4',
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
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_4',
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
            autoArchive: !!label.autoArchive,
            postLabelPrompt: label.postLabelPrompt || '',
        })),
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
    createEmptyLabel,
    formatPostLabelActionStatus,
    normalizeConfig,
    sanitizeConfigForSave,
}
