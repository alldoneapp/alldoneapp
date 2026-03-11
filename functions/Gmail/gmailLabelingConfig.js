'use strict'

const admin = require('firebase-admin')

const DEFAULT_GMAIL_LABELING_MODEL = 'MODEL_GPT5_4'
const DEFAULT_MAX_MESSAGES_PER_RUN = 20
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7
const DEFAULT_LOOKBACK_DAYS = 7
const DEFAULT_SYNC_INTERVAL_MINUTES = 5
const MIN_SYNC_INTERVAL_MINUTES = 5
const MAX_SYNC_INTERVAL_MINUTES = 24 * 60
const DEFAULT_ESTIMATED_EMAILS_PER_DAY = 20
const MAX_ESTIMATED_EMAILS_PER_DAY = 10000
const MAX_LOOKBACK_DAYS = 30
const GMAIL_LABELING_CONFIG_TYPE = 'gmailLabelingConfig'
const GMAIL_LABELING_STATE_TYPE = 'gmailLabelingState'
const GMAIL_LABELING_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const SYSTEM_GMAIL_LABELS = new Set([
    'INBOX',
    'UNREAD',
    'STARRED',
    'IMPORTANT',
    'SENT',
    'DRAFT',
    'SPAM',
    'TRASH',
    'CATEGORY_PERSONAL',
    'CATEGORY_SOCIAL',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_UPDATES',
    'CATEGORY_FORUMS',
    'CHAT',
])

function getGmailLabelingConfigDocId(projectId) {
    return `gmailLabeling_${projectId}`
}

function getGmailLabelingStateDocId(projectId) {
    return `gmailLabelingState_${projectId}`
}

function getGmailLabelingConfigRef(userId, projectId) {
    return admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc(getGmailLabelingConfigDocId(projectId))
}

function getGmailLabelingStateRef(userId, projectId) {
    return admin
        .firestore()
        .collection('users')
        .doc(userId)
        .collection('private')
        .doc(getGmailLabelingStateDocId(projectId))
}

function getStarterLabelDefinitions() {
    return [
        {
            key: 'newsletter',
            gmailLabelName: 'Alldone/Newsletter',
            description: 'Low priority newsletters and automated updates',
            autoArchive: true,
            postLabelPrompt: '',
        },
        {
            key: 'urgent_client',
            gmailLabelName: 'Alldone/Urgent Client',
            description: 'Important client emails requiring fast action',
            autoArchive: false,
            postLabelPrompt: '',
        },
    ]
}

function getDefaultGmailLabelingConfig(projectId, gmailEmail = '') {
    return {
        enabled: true,
        projectId,
        gmailEmail,
        prompt:
            'Read each incoming inbox email and assign exactly one of the configured Gmail labels when it clearly matches. Prefer precision over recall. If no label clearly matches, return no match. Focus on sender, subject, deadlines, action requests, and business relevance.',
        model: DEFAULT_GMAIL_LABELING_MODEL,
        processUnreadOnly: true,
        onlyInbox: true,
        lookbackDays: DEFAULT_LOOKBACK_DAYS,
        syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
        estimatedEmailsPerDay: DEFAULT_ESTIMATED_EMAILS_PER_DAY,
        maxMessagesPerRun: DEFAULT_MAX_MESSAGES_PER_RUN,
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        labelDefinitions: getStarterLabelDefinitions(),
    }
}

function normalizeLabelDefinition(label = {}) {
    return {
        key: typeof label.key === 'string' ? label.key.trim() : '',
        gmailLabelName: typeof label.gmailLabelName === 'string' ? label.gmailLabelName.trim() : '',
        description: typeof label.description === 'string' ? label.description.trim() : '',
        autoArchive: !!label.autoArchive,
        postLabelPrompt: typeof label.postLabelPrompt === 'string' ? label.postLabelPrompt.trim() : '',
    }
}

function slugifyLabelKey(value = '') {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

function ensureLabelKeys(labelDefinitions = []) {
    const usedKeys = new Set()

    return labelDefinitions.map((label, index) => {
        const normalizedLabel = normalizeLabelDefinition(label)
        const baseKey =
            normalizedLabel.key ||
            slugifyLabelKey(normalizedLabel.gmailLabelName) ||
            slugifyLabelKey(normalizedLabel.description) ||
            `label_${index + 1}`

        let nextKey = baseKey
        let suffix = 2

        while (usedKeys.has(nextKey)) {
            nextKey = `${baseKey}_${suffix}`
            suffix += 1
        }

        usedKeys.add(nextKey)

        return {
            ...normalizedLabel,
            key: nextKey,
        }
    })
}

function normalizeConfigInput(projectId, input = {}, gmailEmail = '') {
    const defaultConfig = getDefaultGmailLabelingConfig(projectId, gmailEmail)
    const normalizedLabels = Array.isArray(input.labelDefinitions)
        ? ensureLabelKeys(input.labelDefinitions).filter(label => label.key || label.gmailLabelName)
        : defaultConfig.labelDefinitions

    return {
        type: GMAIL_LABELING_CONFIG_TYPE,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : defaultConfig.enabled,
        projectId,
        gmailEmail:
            typeof input.gmailEmail === 'string' && input.gmailEmail.trim()
                ? input.gmailEmail.trim().toLowerCase()
                : gmailEmail || defaultConfig.gmailEmail,
        prompt: typeof input.prompt === 'string' ? input.prompt.trim() : defaultConfig.prompt,
        model:
            typeof input.model === 'string' && input.model.trim() ? input.model.trim() : DEFAULT_GMAIL_LABELING_MODEL,
        processUnreadOnly:
            typeof input.processUnreadOnly === 'boolean' ? input.processUnreadOnly : defaultConfig.processUnreadOnly,
        onlyInbox: typeof input.onlyInbox === 'boolean' ? input.onlyInbox : defaultConfig.onlyInbox,
        lookbackDays: Number.isFinite(input.lookbackDays)
            ? Math.min(Math.max(Math.trunc(input.lookbackDays), 1), MAX_LOOKBACK_DAYS)
            : defaultConfig.lookbackDays,
        syncIntervalMinutes: Number.isFinite(input.syncIntervalMinutes)
            ? Math.min(
                  Math.max(Math.trunc(input.syncIntervalMinutes), MIN_SYNC_INTERVAL_MINUTES),
                  MAX_SYNC_INTERVAL_MINUTES
              )
            : defaultConfig.syncIntervalMinutes,
        estimatedEmailsPerDay: Number.isFinite(input.estimatedEmailsPerDay)
            ? Math.min(Math.max(Math.trunc(input.estimatedEmailsPerDay), 0), MAX_ESTIMATED_EMAILS_PER_DAY)
            : defaultConfig.estimatedEmailsPerDay,
        maxMessagesPerRun: Number.isFinite(input.maxMessagesPerRun)
            ? Math.min(Math.max(Math.trunc(input.maxMessagesPerRun), 1), 100)
            : defaultConfig.maxMessagesPerRun,
        confidenceThreshold: Number.isFinite(input.confidenceThreshold)
            ? Math.min(Math.max(Number(input.confidenceThreshold), 0), 1)
            : DEFAULT_CONFIDENCE_THRESHOLD,
        labelDefinitions: normalizedLabels,
    }
}

function validateGmailLabelingConfig(config = {}) {
    const errors = []
    const keySet = new Set()
    const labelNameSet = new Set()
    const labelDefinitions = Array.isArray(config.labelDefinitions) ? config.labelDefinitions : []

    if (!config.projectId || typeof config.projectId !== 'string') {
        errors.push('A valid projectId is required.')
    }

    if (config.enabled) {
        if (!config.prompt || typeof config.prompt !== 'string' || !config.prompt.trim()) {
            errors.push('Prompt is required when Gmail labeling is enabled.')
        }

        if (labelDefinitions.length === 0) {
            errors.push('At least one label definition is required when Gmail labeling is enabled.')
        }
    }

    labelDefinitions.forEach((rawLabel, index) => {
        const label = normalizeLabelDefinition(rawLabel)
        const keyLower = label.key.toLowerCase()
        const gmailLabelNameUpper = label.gmailLabelName.toUpperCase()

        if (!label.key) {
            errors.push(`Label ${index + 1} requires a key.`)
        } else if (keySet.has(keyLower)) {
            errors.push(`Label key "${label.key}" is duplicated.`)
        } else {
            keySet.add(keyLower)
        }

        if (!label.gmailLabelName) {
            errors.push(`Label ${index + 1} requires a Gmail label name.`)
        } else if (labelNameSet.has(gmailLabelNameUpper)) {
            errors.push(`Gmail label name "${label.gmailLabelName}" is duplicated.`)
        } else if (SYSTEM_GMAIL_LABELS.has(gmailLabelNameUpper)) {
            errors.push(`Gmail label name "${label.gmailLabelName}" uses a reserved Gmail system label.`)
        } else {
            labelNameSet.add(gmailLabelNameUpper)
        }
    })

    return {
        valid: errors.length === 0,
        errors,
    }
}

function buildConfigWriteData(userId, projectId, configInput, gmailEmail = '', existingData = null) {
    const normalizedConfig = normalizeConfigInput(projectId, configInput, gmailEmail)
    const validation = validateGmailLabelingConfig(normalizedConfig)

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

function buildDefaultState(projectId, gmailEmail = '') {
    return {
        type: GMAIL_LABELING_STATE_TYPE,
        projectId,
        gmailEmail,
        status: 'idle',
        lockAcquiredAt: null,
        lastHistoryId: null,
        lastSyncAt: null,
        lastSuccessfulSyncAt: null,
        lastRunId: null,
        lastError: null,
        lastProcessedCount: 0,
        lastLabeledCount: 0,
        lastArchivedCount: 0,
        lastProcessUnreadOnly: null,
        lastOnlyInbox: null,
    }
}

module.exports = {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_ESTIMATED_EMAILS_PER_DAY,
    DEFAULT_GMAIL_LABELING_MODEL,
    DEFAULT_LOOKBACK_DAYS,
    DEFAULT_MAX_MESSAGES_PER_RUN,
    DEFAULT_SYNC_INTERVAL_MINUTES,
    GMAIL_LABELING_CONFIG_TYPE,
    GMAIL_LABELING_LOCK_TIMEOUT_MS,
    GMAIL_LABELING_STATE_TYPE,
    MAX_ESTIMATED_EMAILS_PER_DAY,
    MAX_LOOKBACK_DAYS,
    MAX_SYNC_INTERVAL_MINUTES,
    MIN_SYNC_INTERVAL_MINUTES,
    SYSTEM_GMAIL_LABELS,
    buildConfigWriteData,
    buildDefaultState,
    getDefaultGmailLabelingConfig,
    getGmailLabelingConfigDocId,
    getGmailLabelingConfigRef,
    getGmailLabelingStateDocId,
    getGmailLabelingStateRef,
    getStarterLabelDefinitions,
    normalizeConfigInput,
    ensureLabelKeys,
    normalizeLabelDefinition,
    slugifyLabelKey,
    validateGmailLabelingConfig,
}
