'use strict'

const admin = require('firebase-admin')

const DEFAULT_GMAIL_LABELING_MODEL = 'MODEL_GPT5_2'
const DEFAULT_MAX_MESSAGES_PER_RUN = 20
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7
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
        },
        {
            key: 'urgent_client',
            gmailLabelName: 'Alldone/Urgent Client',
            description: 'Important client emails requiring fast action',
            autoArchive: false,
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
    }
}

function normalizeConfigInput(projectId, input = {}, gmailEmail = '') {
    const defaultConfig = getDefaultGmailLabelingConfig(projectId, gmailEmail)
    const normalizedLabels = Array.isArray(input.labelDefinitions)
        ? input.labelDefinitions.map(normalizeLabelDefinition).filter(label => label.key || label.gmailLabelName)
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
        lastError: null,
        lastProcessedCount: 0,
        lastLabeledCount: 0,
        lastArchivedCount: 0,
    }
}

module.exports = {
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_GMAIL_LABELING_MODEL,
    DEFAULT_MAX_MESSAGES_PER_RUN,
    GMAIL_LABELING_CONFIG_TYPE,
    GMAIL_LABELING_LOCK_TIMEOUT_MS,
    GMAIL_LABELING_STATE_TYPE,
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
    normalizeLabelDefinition,
    validateGmailLabelingConfig,
}
