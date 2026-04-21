'use strict'

const admin = require('firebase-admin')
const crypto = require('crypto')
const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const {
    addBaseInstructions,
    calculateTokens,
    calculateGoldCostFromTokens,
    collectAssistantTextWithToolCalls,
    getAssistantForChat,
    interactWithChatStream,
    parseTextForUseLiKePrompt,
} = require('../Assistant/assistantHelper')
const { getDefaultAssistantData, GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const { deductGold, refundGold } = require('../Gold/goldHelper')
const {
    GMAIL_LABELING_CONFIG_TYPE,
    GMAIL_LABELING_LOCK_TIMEOUT_MS,
    GMAIL_DIRECTION_SCOPE_BOTH,
    GMAIL_DIRECTION_SCOPE_INCOMING,
    GMAIL_DIRECTION_SCOPE_OUTGOING,
    DEFAULT_GMAIL_LABELING_MODEL,
    buildConfigWriteData,
    buildDefaultState,
    getDefaultGmailLabelingConfig,
    getGmailLabelingConfigRef,
    getGmailLabelingStateRef,
} = require('./gmailLabelingConfig')
const {
    extractEmailAddresses,
    getGmailMessageDirection,
    normalizeGmailMessage,
    parseEmailHeaderAddresses,
} = require('./gmailMessageParser')
const { classifyGmailMessage } = require('./gmailPromptClassifier')

const MAX_HISTORY_PAGES = 5
const MAX_MESSAGES_FETCH_MULTIPLIER = 3
const ALDDONE_MANAGED_LABEL_PREFIX = 'Alldone/'
// Minimum Gold a user must hold before we'll invoke the classifier LLM. The
// actual billed cost is computed from the classifier's token usage AFTER the
// call and deducted in a single ledger entry; see processSingleMessage for the
// full flow. This constant is also used as the minimum charge when real token
// cost rounds to 0 Gold, so every labeled email is reflected in the log.
const GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY = 1
const DEFAULT_SYNC_INTERVAL_MINUTES = 5

class GmailSyncLockedError extends Error {
    constructor(message) {
        super(message)
        this.name = 'GmailSyncLockedError'
        this.code = 'gmail-sync-locked'
    }
}

function getMessagesAuditCollectionRef(userId, projectId) {
    return getGmailLabelingStateRef(userId, projectId).collection('messages')
}

function chunkArray(items, chunkSize) {
    const chunks = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}

function createSyncLogContext(userId, projectId, gmailEmail = '') {
    return {
        runId: `${projectId}-${Date.now()}`,
        userId,
        projectId,
        gmailEmail,
    }
}

function normalizeTimestampToMillis(value) {
    if (!value) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.toDate === 'function') return value.toDate().getTime()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    if (typeof value?._seconds === 'number') return value._seconds * 1000
    if (typeof value === 'number') return value

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function getConfiguredSyncIntervalMinutes(config = {}) {
    const parsedInterval = Number(config?.syncIntervalMinutes)
    if (!Number.isFinite(parsedInterval)) return DEFAULT_SYNC_INTERVAL_MINUTES
    return Math.max(DEFAULT_SYNC_INTERVAL_MINUTES, Math.trunc(parsedInterval))
}

function isScheduledSyncDue(state = {}, config = {}) {
    const intervalMinutes = getConfiguredSyncIntervalMinutes(config)
    const lastSyncMillis = normalizeTimestampToMillis(state?.lastSyncAt || state?.lastSuccessfulSyncAt)
    if (!lastSyncMillis) return true
    return Date.now() - lastSyncMillis >= intervalMinutes * 60 * 1000
}

function logSync(message, context = {}) {
    console.log('[gmailLabeling]', message, context)
}

function buildGmailMessageUrl(gmailEmail = '', messageId = '') {
    if (!messageId) return ''
    const normalizedEmail = typeof gmailEmail === 'string' ? gmailEmail.trim().toLowerCase() : ''
    const authQuery = normalizedEmail ? `?authuser=${encodeURIComponent(normalizedEmail)}` : ''
    return `https://mail.google.com/mail/u/0/${authQuery}#all/${encodeURIComponent(messageId)}`
}

function createPostLabelPromptHash(ruleKey = '', prompt = '') {
    return crypto.createHash('sha1').update(`${ruleKey}:${prompt}`).digest('hex')
}

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

function buildBootstrapQuery(config) {
    return `newer_than:${config.lookbackDays || 7}d`
}

const GMAIL_LABELING_LEGACY_GPT5_MODELS = new Set([
    'MODEL_GPT5',
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_4',
    'MODEL_GPT5_4_MINI',
])

function applyGmailLabelingModelMigration(config = {}) {
    if (!config || typeof config !== 'object') return config
    if (config.model && !GMAIL_LABELING_LEGACY_GPT5_MODELS.has(config.model)) {
        return config
    }

    return {
        ...config,
        model: DEFAULT_GMAIL_LABELING_MODEL,
    }
}

async function loadConfig(userId, projectId, gmailEmail = '') {
    const configRef = getGmailLabelingConfigRef(userId, projectId)
    const configDoc = await configRef.get()
    if (!configDoc.exists) {
        return {
            config: getDefaultGmailLabelingConfig(projectId, gmailEmail),
            exists: false,
            ref: configRef,
        }
    }

    return {
        config: applyGmailLabelingModelMigration(configDoc.data()),
        exists: true,
        ref: configRef,
    }
}

async function loadState(userId, projectId, gmailEmail = '') {
    const stateRef = getGmailLabelingStateRef(userId, projectId)
    const stateDoc = await stateRef.get()
    return {
        state: stateDoc.exists ? stateDoc.data() : buildDefaultState(projectId, gmailEmail),
        exists: stateDoc.exists,
        ref: stateRef,
    }
}

async function upsertGmailLabelingConfig(userId, projectId, configInput, gmailEmail = '') {
    const { ref, config, exists } = await loadConfig(userId, projectId, gmailEmail)
    const writeData = buildConfigWriteData(userId, projectId, configInput, gmailEmail, exists ? config : null)
    await ref.set(writeData, { merge: true })
    return writeData
}

async function getGmailLabelingConfigWithState(userId, projectId, gmailEmail = '') {
    const [{ config, exists }, { state }] = await Promise.all([
        loadConfig(userId, projectId, gmailEmail),
        loadState(userId, projectId, gmailEmail),
    ])
    const recentAuditEntries = await loadRecentAuditEntries(userId, projectId)
    return {
        config: exists ? config : getDefaultGmailLabelingConfig(projectId, gmailEmail),
        state,
        recentAuditEntries,
    }
}

async function acquireSyncLock(userId, projectId, gmailEmail = '') {
    const stateRef = getGmailLabelingStateRef(userId, projectId)
    const now = admin.firestore.Timestamp.now()

    await admin.firestore().runTransaction(async transaction => {
        const stateDoc = await transaction.get(stateRef)
        const stateData = stateDoc.exists ? stateDoc.data() : buildDefaultState(projectId, gmailEmail)
        const lockMillis = stateData.lockAcquiredAt?.toMillis?.() || 0
        const isLocked =
            stateData.status === 'running' && lockMillis > 0 && Date.now() - lockMillis < GMAIL_LABELING_LOCK_TIMEOUT_MS

        if (isLocked) {
            throw new GmailSyncLockedError('A Gmail sync is already running for this project.')
        }

        transaction.set(
            stateRef,
            {
                ...buildDefaultState(projectId, gmailEmail),
                projectId,
                gmailEmail,
                status: 'running',
                lockAcquiredAt: now,
                lastSyncAt: now,
                lastError: null,
            },
            { merge: true }
        )
    })
}

async function finalizeSyncState(userId, projectId, statePatch, status = 'idle') {
    await getGmailLabelingStateRef(userId, projectId).set(
        {
            ...statePatch,
            status,
            lockAcquiredAt: null,
        },
        { merge: true }
    )
}

async function getCurrentProfileHistoryId(gmail) {
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return profile?.data?.historyId || null
}

async function listBootstrapMessageIds(gmail, config) {
    const query = buildBootstrapQuery(config)
    const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: config.maxMessagesPerRun * MAX_MESSAGES_FETCH_MULTIPLIER,
        q: query,
    })

    return {
        query,
        messageIds: (response?.data?.messages || []).map(message => message.id).filter(Boolean),
    }
}

async function listIncrementalMessageIds(gmail, state, config) {
    const messageIds = new Set()
    let pageToken = undefined
    let pageCount = 0

    while (
        pageCount < MAX_HISTORY_PAGES &&
        messageIds.size < config.maxMessagesPerRun * MAX_MESSAGES_FETCH_MULTIPLIER
    ) {
        const response = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: state.lastHistoryId,
            historyTypes: ['messageAdded'],
            pageToken,
        })

        const histories = response?.data?.history || []
        histories.forEach(history => {
            const messagesAdded = Array.isArray(history.messagesAdded) ? history.messagesAdded : []
            messagesAdded.forEach(entry => {
                const messageId = entry?.message?.id
                if (messageId) messageIds.add(messageId)
            })
        })

        pageToken = response?.data?.nextPageToken
        pageCount += 1

        if (!pageToken) break
    }

    return Array.from(messageIds)
}

async function fetchMessagesByIds(gmail, messageIds) {
    const uniqueIds = Array.from(new Set(messageIds)).filter(Boolean)
    const fetchedMessages = []

    for (const group of chunkArray(uniqueIds, 10)) {
        const responses = await Promise.all(
            group.map(messageId =>
                gmail.users.messages
                    .get({
                        userId: 'me',
                        id: messageId,
                        format: 'full',
                    })
                    .catch(error => {
                        console.warn('[gmailLabeling] Failed fetching Gmail message', {
                            messageId,
                            error: error.message,
                        })
                        return null
                    })
            )
        )

        responses.forEach(response => {
            if (response?.data?.id) fetchedMessages.push(response.data)
        })
    }

    return fetchedMessages
}

function filterCandidateMessages(messages, config) {
    return messages.filter(message => {
        const labelIds = Array.isArray(message.labelIds) ? message.labelIds : []
        const direction = getGmailMessageDirection(message)
        if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) {
            return labelIds.includes('SENT') && !labelIds.includes('DRAFT')
        }
        if (config.onlyInbox && !labelIds.includes('INBOX')) return false
        if (config.processUnreadOnly && !labelIds.includes('UNREAD')) return false
        return true
    })
}

function shouldBootstrapForScopeExpansion(state, config) {
    const unreadScopeUnknown =
        state.lastHistoryId && typeof state.lastProcessUnreadOnly !== 'boolean' && config.processUnreadOnly === false
    const inboxScopeUnknown =
        state.lastHistoryId && typeof state.lastOnlyInbox !== 'boolean' && config.onlyInbox === false
    const unreadExpanded = state.lastProcessUnreadOnly === true && config.processUnreadOnly === false
    const inboxExpanded = state.lastOnlyInbox === true && config.onlyInbox === false
    return unreadExpanded || inboxExpanded || unreadScopeUnknown || inboxScopeUnknown
}

async function getExistingAuditIds(userId, projectId, messageIds) {
    if (!messageIds.length) return new Set()

    const messageRefs = messageIds.map(messageId => getMessagesAuditCollectionRef(userId, projectId).doc(messageId))
    const snapshots = await admin.firestore().getAll(...messageRefs)
    const existingIds = new Set()
    snapshots.forEach(snapshot => {
        if (snapshot.exists) existingIds.add(snapshot.id)
    })
    return existingIds
}

function normalizeLabelName(labelName = '') {
    return String(labelName || '').trim()
}

function findExistingLabelId(labelMap, labelName) {
    const normalizedLabelName = normalizeLabelName(labelName)
    if (!normalizedLabelName) return null

    if (labelMap.has(normalizedLabelName)) return labelMap.get(normalizedLabelName)

    const normalizedLookup = normalizedLabelName.toLowerCase()
    for (const [existingLabelName, existingLabelId] of labelMap.entries()) {
        if (normalizeLabelName(existingLabelName).toLowerCase() === normalizedLookup) {
            labelMap.set(normalizedLabelName, existingLabelId)
            return existingLabelId
        }
    }

    return null
}

async function createOrGetGmailLabelId(gmail, labelMap, labelName) {
    const normalizedLabelName = normalizeLabelName(labelName)
    const existingLabelId = findExistingLabelId(labelMap, normalizedLabelName)
    if (existingLabelId) return existingLabelId

    let createdLabel
    try {
        createdLabel = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: normalizedLabelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        })
    } catch (error) {
        const alreadyExists = error?.code === 409 || error?.response?.status === 409
        if (!alreadyExists) throw error

        const refreshedMap = await loadExistingLabelMap(gmail)
        const refreshedLabelId = findExistingLabelId(refreshedMap, normalizedLabelName)
        if (refreshedLabelId) {
            labelMap.set(normalizedLabelName, refreshedLabelId)
            return refreshedLabelId
        }

        throw new Error(
            `Label name exists or conflicts in Gmail: "${normalizedLabelName}". Use the exact existing Gmail label name or rename this rule label.`
        )
    }

    const labelId = createdLabel?.data?.id || null
    if (!labelId) {
        throw new Error(`Failed creating Gmail label "${normalizedLabelName}"`)
    }

    labelMap.set(normalizedLabelName, labelId)
    return labelId
}

async function loadExistingLabelMap(gmail) {
    const response = await gmail.users.labels.list({ userId: 'me' })
    const map = new Map()
    ;(response?.data?.labels || []).forEach(label => {
        if (label?.name && label?.id) {
            map.set(label.name, label.id)
        }
    })
    return map
}

async function writeAuditRecord(userId, projectId, normalizedMessage, auditData) {
    await getMessagesAuditCollectionRef(userId, projectId)
        .doc(normalizedMessage.messageId)
        .set(
            {
                gmailMessageId: normalizedMessage.messageId,
                gmailThreadId: normalizedMessage.threadId,
                internalDate: normalizedMessage.internalDate,
                from: normalizedMessage.from,
                subject: normalizedMessage.subject,
                snippet: normalizedMessage.snippet,
                processedAt: admin.firestore.Timestamp.now(),
                ...auditData,
            },
            { merge: true }
        )
}

async function loadRecentAuditEntries(userId, projectId, limit = 20) {
    const snapshot = await getMessagesAuditCollectionRef(userId, projectId)
        .orderBy('processedAt', 'desc')
        .limit(limit)
        .get()

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

async function loadAuditEntry(userId, projectId, messageId) {
    if (!messageId) return null
    const snapshot = await getMessagesAuditCollectionRef(userId, projectId).doc(messageId).get()
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null
}

async function getDefaultAssistantIdForProject(userData = {}, projectId = '') {
    const db = admin.firestore()
    const normalizedProjectId = String(projectId || '').trim()
    const userDefaultAssistantId =
        typeof userData?.defaultAssistantId === 'string' ? userData.defaultAssistantId.trim() : ''

    if (!normalizedProjectId) return null

    const assistantExistsInProjectOrGlobal = async assistantId => {
        if (!assistantId) return false
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${normalizedProjectId}/items/${assistantId}`),
            db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`)
        )
        return projectAssistantDoc.exists || globalAssistantDoc.exists
    }

    try {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        const projectAssistantId = projectDoc.exists ? String(projectDoc.data()?.assistantId || '').trim() : ''
        if (projectAssistantId && (await assistantExistsInProjectOrGlobal(projectAssistantId))) {
            return projectAssistantId
        }
    } catch (error) {
        console.warn('[gmailLabeling] Could not resolve project assistant', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    if (userDefaultAssistantId) {
        try {
            if (await assistantExistsInProjectOrGlobal(userDefaultAssistantId)) {
                return userDefaultAssistantId
            }
        } catch (error) {
            console.warn('[gmailLabeling] Could not validate user default assistant', {
                projectId: normalizedProjectId,
                error: error.message,
            })
        }
    }

    try {
        const snapshot = await db.collection(`assistants/${normalizedProjectId}/items`).limit(1).get()
        if (!snapshot.empty) {
            return snapshot.docs[0].id
        }
    } catch (error) {
        console.warn('[gmailLabeling] Could not find assistant in project', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            return defaultAssistant.uid
        }
    } catch (error) {
        console.warn('[gmailLabeling] Could not fetch global default assistant', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    return null
}

async function resolvePostLabelAssistantContext(userId, userData = {}) {
    const defaultProjectId = typeof userData?.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (!defaultProjectId) {
        return {
            assistantProjectId: null,
            assistantId: null,
            assistant: null,
        }
    }

    const assistantId = await getDefaultAssistantIdForProject(userData, defaultProjectId)
    if (!assistantId) {
        return {
            assistantProjectId: defaultProjectId,
            assistantId: null,
            assistant: null,
        }
    }

    const assistant = await getAssistantForChat(defaultProjectId, assistantId, userId, { forceRefresh: true })
    return {
        assistantProjectId: defaultProjectId,
        assistantId,
        assistant,
    }
}

function buildPostLabelActionSkipped({
    prompt = '',
    promptHash = '',
    status = 'skipped',
    error = '',
    assistantProjectId = null,
    assistantId = null,
    goldSpent = 0,
    estimatedNormalGoldCost = 0,
    tokenUsage = null,
}) {
    return {
        prompt,
        promptHash,
        assistantProjectId,
        assistantId,
        executedToolNames: [],
        executedToolCallsCount: 0,
        assistantResponse: '',
        status,
        error: error || '',
        goldSpent: Number.isFinite(goldSpent) ? goldSpent : 0,
        estimatedNormalGoldCost: Number.isFinite(estimatedNormalGoldCost) ? estimatedNormalGoldCost : 0,
        tokenUsage,
        executedAt: admin.firestore.Timestamp.now(),
    }
}

function getDefinitionDirectionScope(definition = {}) {
    const scope = typeof definition.directionScope === 'string' ? definition.directionScope.trim().toLowerCase() : ''
    if (scope === GMAIL_DIRECTION_SCOPE_OUTGOING || scope === GMAIL_DIRECTION_SCOPE_BOTH) return scope
    return GMAIL_DIRECTION_SCOPE_INCOMING
}

function getEligibleLabelDefinitions(labelDefinitions = [], direction = GMAIL_DIRECTION_SCOPE_INCOMING) {
    return (Array.isArray(labelDefinitions) ? labelDefinitions : []).filter(label => {
        const scope = getDefinitionDirectionScope(label)
        return scope === GMAIL_DIRECTION_SCOPE_BOTH || scope === direction
    })
}

function getExternalRecipientEmails(normalizedMessage = {}, gmailEmail = '') {
    const connectedEmail = typeof gmailEmail === 'string' ? gmailEmail.trim().toLowerCase() : ''
    const recipients = extractEmailAddresses(normalizedMessage.to)

    return Array.from(new Set(recipients.filter(email => email && email !== connectedEmail)))
}

function getTargetContactName(
    normalizedMessage = {},
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = ''
) {
    if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) {
        const normalizedTargetEmail =
            typeof targetContactEmail === 'string' ? targetContactEmail.trim().toLowerCase() : ''
        if (!normalizedTargetEmail) return ''

        const outgoingCandidates = [
            ...parseEmailHeaderAddresses(normalizedMessage.to),
            ...parseEmailHeaderAddresses(normalizedMessage.cc),
            ...parseEmailHeaderAddresses(normalizedMessage.bcc),
        ]
        const match = outgoingCandidates.find(entry => entry.email === normalizedTargetEmail)
        return match?.displayName || ''
    }

    const incomingSender = parseEmailHeaderAddresses(normalizedMessage.from)[0]
    return incomingSender?.displayName || ''
}

function getTargetContactEmail(
    normalizedMessage = {},
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = ''
) {
    if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) {
        return typeof targetContactEmail === 'string' ? targetContactEmail.trim().toLowerCase() : ''
    }

    const incomingSender = parseEmailHeaderAddresses(normalizedMessage.from)[0]
    return incomingSender?.email || ''
}

function buildPostLabelAssistantMessages({
    prompt,
    normalizedMessage,
    selectedDefinition,
    gmailEmail,
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = '',
    targetContactName = '',
}) {
    const gmailWebUrl = buildGmailMessageUrl(gmailEmail, normalizedMessage.messageId)
    const resolvedTargetContactEmail = getTargetContactEmail(normalizedMessage, direction, targetContactEmail)
    return [
        [
            'system',
            'You are executing a follow-up action after a Gmail labeling rule matched. Use your available tools when needed. Return a concise execution summary. If a required tool is not available, say so clearly and do not claim completion.',
        ],
        [
            'user',
            parseTextForUseLiKePrompt(
                [
                    `Direction: ${direction}`,
                    `Matched Gmail rule key: ${selectedDefinition.key}`,
                    `Matched Gmail label: ${selectedDefinition.gmailLabelName}`,
                    `Matched Gmail direction scope: ${getDefinitionDirectionScope(selectedDefinition)}`,
                    `Gmail messageId: ${normalizedMessage.messageId || ''}`,
                    `Gmail threadId: ${normalizedMessage.threadId || ''}`,
                    `Gmail web URL: ${gmailWebUrl || ''}`,
                    `From: ${normalizedMessage.from || ''}`,
                    `To: ${normalizedMessage.to || ''}`,
                    `Cc: ${normalizedMessage.cc || ''}`,
                    `Target contact email: ${resolvedTargetContactEmail || ''}`,
                    `Target contact name: ${targetContactName || ''}`,
                    `Date: ${normalizedMessage.date || ''}`,
                    `Subject: ${normalizedMessage.subject || ''}`,
                    `Snippet: ${normalizedMessage.snippet || ''}`,
                    `Body:\n${normalizedMessage.bodyText || ''}`,
                    '',
                    `Follow-up instruction: ${prompt}`,
                ].join('\n')
            ),
        ],
    ]
}

function buildPostLabelGmailContext({
    normalizedMessage,
    gmailEmail,
    assistantProjectId,
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = '',
    targetContactName = '',
}) {
    const messageId = typeof normalizedMessage?.messageId === 'string' ? normalizedMessage.messageId.trim() : ''
    const threadId = typeof normalizedMessage?.threadId === 'string' ? normalizedMessage.threadId.trim() : ''
    const normalizedEmail = typeof gmailEmail === 'string' ? gmailEmail.trim().toLowerCase() : ''
    const resolvedTargetContactEmail = getTargetContactEmail(normalizedMessage, direction, targetContactEmail)

    return {
        origin: 'gmail_label_follow_up',
        gmailEmail: normalizedEmail,
        projectId: assistantProjectId || '',
        messageId,
        threadId,
        webUrl: buildGmailMessageUrl(normalizedEmail, messageId),
        archiveOnComplete: direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? false : true,
        direction,
        targetContactEmail: resolvedTargetContactEmail,
        targetContactName: typeof targetContactName === 'string' ? targetContactName.trim() : '',
    }
}

async function executePostLabelPrompt({
    userId,
    userData,
    selectedDefinition,
    normalizedMessage,
    gmailEmail,
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = '',
    forceExecute = false,
    existingAuditEntry = null,
}) {
    const prompt =
        typeof selectedDefinition?.postLabelPrompt === 'string' ? selectedDefinition.postLabelPrompt.trim() : ''
    const promptHash = createPostLabelPromptHash(selectedDefinition?.key || '', prompt)

    if (!prompt) {
        return buildPostLabelActionSkipped({ prompt: '', promptHash: '', status: 'skipped' })
    }

    if (
        !forceExecute &&
        existingAuditEntry?.postLabelAction?.status === 'completed' &&
        existingAuditEntry?.postLabelAction?.promptHash === promptHash
    ) {
        return {
            ...existingAuditEntry.postLabelAction,
            status: 'skipped',
            error: '',
        }
    }

    const { assistantProjectId, assistantId, assistant } = await resolvePostLabelAssistantContext(userId, userData)
    if (!assistantProjectId || !assistantId || !assistant) {
        return buildPostLabelActionSkipped({
            prompt,
            promptHash,
            status: 'blocked',
            error: 'No assistant could be resolved for the user default project.',
            assistantProjectId,
            assistantId,
        })
    }

    const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
    const messages = []
    const targetContactName = getTargetContactName(normalizedMessage, direction, targetContactEmail)

    await addBaseInstructions(
        messages,
        assistant.displayName || assistant.name || 'Assistant',
        'English',
        assistant.instructions || 'You are a helpful assistant.',
        allowedTools,
        null,
        {
            projectId: assistantProjectId,
            assistantId,
        }
    )
    messages.push(
        ...buildPostLabelAssistantMessages({
            prompt,
            normalizedMessage,
            selectedDefinition,
            gmailEmail,
            direction,
            targetContactEmail,
            targetContactName,
        })
    )

    try {
        const gmailContext = buildPostLabelGmailContext({
            normalizedMessage,
            gmailEmail,
            assistantProjectId,
            direction,
            targetContactEmail,
            targetContactName,
        })
        const stream = await interactWithChatStream(messages, assistant.model, assistant.temperature, allowedTools, {
            projectId: assistantProjectId,
            assistantId,
            requestUserId: userId,
            gmailContext,
        })
        const result = await collectAssistantTextWithToolCalls({
            stream,
            conversationHistory: messages,
            modelKey: assistant.model,
            temperatureKey: assistant.temperature,
            allowedTools,
            toolRuntimeContext: {
                projectId: assistantProjectId,
                assistantId,
                requestUserId: userId,
                gmailContext,
            },
        })
        const totalTokens = calculateTokens(
            result?.assistantResponse || '',
            Array.isArray(result?.finalConversation) ? result.finalConversation : messages,
            assistant.model
        )
        const estimatedNormalGoldCost = calculateGoldCostFromTokens(totalTokens, assistant.model)
        let goldSpent = 0
        if (estimatedNormalGoldCost > 0) {
            const goldResult = await deductGold(userId, estimatedNormalGoldCost, {
                source: 'gmail_label_follow_up',
                projectId: assistantProjectId,
                objectId: normalizedMessage?.messageId || '',
                channel: 'gmail',
            })
            if (goldResult?.success) {
                goldSpent = estimatedNormalGoldCost
            } else {
                console.warn('[gmailLabeling] Failed to deduct gold for post-label prompt', {
                    userId,
                    assistantProjectId,
                    assistantId,
                    messageId: normalizedMessage?.messageId || '',
                    requestedGold: estimatedNormalGoldCost,
                    currentGold: goldResult?.currentGold ?? null,
                })
            }
        }

        return {
            prompt,
            promptHash,
            assistantProjectId,
            assistantId,
            executedToolNames: Array.isArray(result?.executedToolNames) ? result.executedToolNames : [],
            executedToolCallsCount: Number(result?.executedToolCallsCount) || 0,
            assistantResponse: result?.assistantResponse || '',
            status: 'completed',
            error: '',
            goldSpent,
            estimatedNormalGoldCost,
            tokenUsage: {
                totalTokens,
            },
            executedAt: admin.firestore.Timestamp.now(),
        }
    } catch (error) {
        const isBlocked = error.message?.includes('Tool not permitted')
        return {
            prompt,
            promptHash,
            assistantProjectId,
            assistantId,
            executedToolNames: [],
            executedToolCallsCount: 0,
            assistantResponse: '',
            status: isBlocked ? 'blocked' : 'failed',
            error: error.message || 'Failed to execute follow-up prompt.',
            goldSpent: 0,
            estimatedNormalGoldCost: 0,
            tokenUsage: null,
            executedAt: admin.firestore.Timestamp.now(),
        }
    }
}

async function applyLabelAndArchive(gmail, normalizedMessage, labelId, autoArchive, direction) {
    const shouldArchive = direction !== GMAIL_DIRECTION_SCOPE_OUTGOING && autoArchive
    const removeLabelIds = shouldArchive && normalizedMessage.labelIds.includes('INBOX') ? ['INBOX'] : []
    await gmail.users.messages.modify({
        userId: 'me',
        id: normalizedMessage.messageId,
        requestBody: {
            addLabelIds: [labelId],
            removeLabelIds,
        },
    })

    return {
        applied: true,
        archived: shouldArchive && removeLabelIds.includes('INBOX'),
    }
}

async function processSingleMessage({
    gmail,
    labelMap,
    config,
    userId,
    userData,
    projectId,
    gmailEmail,
    rawMessage,
    syncRunId,
    forceFollowUp = false,
}) {
    const normalizedMessage = normalizeGmailMessage(rawMessage)
    const direction = getGmailMessageDirection(rawMessage)
    const eligibleLabelDefinitions = getEligibleLabelDefinitions(config.labelDefinitions, direction)
    const promptVersion = config.updatedAt || admin.firestore.Timestamp.now()
    const existingAuditEntry = await loadAuditEntry(userId, projectId, normalizedMessage.messageId)

    // Check the user has at least the minimum balance to run the classifier.
    // No Gold is deducted here — we only want a single ledger entry per email,
    // created after classification based on actual token usage.
    const preClassifyUserSnapshot = await admin.firestore().collection('users').doc(userId).get()
    const preClassifyUserGold = Number(preClassifyUserSnapshot.data()?.gold) || 0
    if (preClassifyUserGold < GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY) {
        logSync('Skipping Gmail labeling because user has insufficient gold', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            requiredGold: GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY,
            currentGold: preClassifyUserGold,
        })

        await writeAuditRecord(userId, projectId, normalizedMessage, {
            syncRunId,
            direction,
            selectedLabelKey: null,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: null,
            reasoning: 'Skipped before classification because the user has insufficient gold.',
            applied: false,
            archived: false,
            skippedReason: 'insufficient_gold',
            promptVersion,
            postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: 0,
            insufficientGold: true,
        }
    }

    let classifierResult
    try {
        classifierResult = await classifyGmailMessage({
            config: {
                ...config,
                labelDefinitions: eligibleLabelDefinitions,
            },
            message: {
                ...normalizedMessage,
                direction,
            },
        })
    } catch (error) {
        // No Gold was deducted before classification, so no refund is needed.
        console.warn('[gmailLabeling] Gmail classification failed', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            error: error.message,
        })
        throw error
    }

    logSync('Classified Gmail message', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        threadId: normalizedMessage.threadId,
        direction,
        matched: classifierResult.matched,
        labelKey: classifierResult.labelKey || null,
        confidence: classifierResult.confidence,
        reasoning: classifierResult.reasoning,
        tokenUsage: classifierResult.usage || null,
    })

    const tokenUsage = classifierResult?.usage || null
    const estimatedNormalGoldCost = tokenUsage?.totalTokens
        ? calculateGoldCostFromTokens(tokenUsage.totalTokens, config.model)
        : 0

    // Charge the real token-based cost in a single ledger entry. If tokens round
    // to 0 Gold we still charge a minimum of 1 so usage is reflected somewhere.
    const goldToCharge = Math.max(estimatedNormalGoldCost, GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY)

    logSync('Gmail classifier gold accounting inputs', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        model: config?.model || null,
        tokenUsage,
        estimatedNormalGoldCost,
        goldToCharge,
    })

    let classificationGoldSpent = 0
    let insufficientGoldForClassification = false
    const chargeResult = await deductGold(userId, goldToCharge, {
        source: 'gmail_labeling',
        projectId,
        objectId: normalizedMessage.messageId,
        channel: 'gmail',
    })
    if (chargeResult?.success) {
        classificationGoldSpent = goldToCharge
    } else {
        // Balance ran out between the pre-check and the post-classify deduction.
        // The classifier work already happened; record under-charge and halt sync.
        insufficientGoldForClassification = true
        console.warn('[gmailLabeling] Unable to deduct classifier gold cost', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            estimatedNormalGoldCost,
            goldToCharge,
            currentGold: chargeResult?.currentGold ?? null,
        })
    }

    logSync('Gmail classifier gold accounting result', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        classificationGoldSpent,
        insufficientGoldForClassification,
    })

    if (!classifierResult.matched) {
        await writeAuditRecord(userId, projectId, normalizedMessage, {
            syncRunId,
            direction,
            selectedLabelKey: null,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: classifierResult.confidence,
            reasoning: classifierResult.reasoning,
            applied: false,
            archived: false,
            skippedReason: 'no_match',
            promptVersion,
            postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: classificationGoldSpent,
            estimatedNormalGoldCost,
            insufficientGold: insufficientGoldForClassification,
        }
    }

    const selectedDefinition = eligibleLabelDefinitions.find(label => label.key === classifierResult.labelKey)
    if (!selectedDefinition) {
        await writeAuditRecord(userId, projectId, normalizedMessage, {
            syncRunId,
            direction,
            selectedLabelKey: classifierResult.labelKey,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: classifierResult.confidence,
            reasoning: classifierResult.reasoning,
            applied: false,
            archived: false,
            skippedReason: 'missing_label_definition',
            promptVersion,
            postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: classificationGoldSpent,
            estimatedNormalGoldCost,
            insufficientGold: insufficientGoldForClassification,
        }
    }

    let labelId
    let modifyResult
    try {
        labelId = selectedDefinition.gmailLabelName.startsWith(ALDDONE_MANAGED_LABEL_PREFIX)
            ? await createOrGetGmailLabelId(gmail, labelMap, selectedDefinition.gmailLabelName)
            : await createOrGetGmailLabelId(gmail, labelMap, selectedDefinition.gmailLabelName)

        logSync('Applying Gmail label to message', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            threadId: normalizedMessage.threadId,
            selectedLabelKey: selectedDefinition.key,
            selectedGmailLabelName: selectedDefinition.gmailLabelName,
            labelId,
            autoArchive: !!selectedDefinition.autoArchive,
            direction,
        })

        modifyResult = await applyLabelAndArchive(
            gmail,
            normalizedMessage,
            labelId,
            selectedDefinition.autoArchive,
            direction
        )
    } catch (error) {
        if (classificationGoldSpent > 0) {
            await refundGold(userId, classificationGoldSpent, {
                source: 'gmail_labeling',
                projectId,
                objectId: normalizedMessage.messageId,
                channel: 'gmail',
                note: 'Refund real classifier cost after Gmail label apply failure',
            })
        }
        console.warn('[gmailLabeling] Refunded gold after Gmail label resolution/apply failure', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            refundedGold: classificationGoldSpent,
            error: error.message,
        })
        throw error
    }

    const targetContactEmails =
        direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? getExternalRecipientEmails(normalizedMessage, gmailEmail) : ['']
    const postLabelActions = []
    let followUpGoldSpent = 0
    let followUpEstimatedNormalGoldCost = 0

    for (const targetContactEmail of targetContactEmails) {
        const action = await executePostLabelPrompt({
            userId,
            userData,
            selectedDefinition,
            normalizedMessage,
            gmailEmail,
            direction,
            targetContactEmail,
            forceExecute: forceFollowUp,
            existingAuditEntry,
        })
        postLabelActions.push(action)
        followUpGoldSpent += Number(action?.goldSpent) || 0
        followUpEstimatedNormalGoldCost += Number(action?.estimatedNormalGoldCost) || 0
    }

    const primaryPostLabelAction = postLabelActions[0] || buildPostLabelActionSkipped({ status: 'skipped' })

    await writeAuditRecord(userId, projectId, normalizedMessage, {
        syncRunId,
        direction,
        selectedLabelKey: selectedDefinition.key,
        selectedGmailLabelName: selectedDefinition.gmailLabelName,
        autoArchive: direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? false : !!selectedDefinition.autoArchive,
        confidence: classifierResult.confidence,
        reasoning: classifierResult.reasoning,
        applied: modifyResult.applied,
        archived: modifyResult.archived,
        skippedReason: null,
        promptVersion,
        recipientEmails: targetContactEmails.filter(Boolean),
        postLabelAction: primaryPostLabelAction,
        postLabelActions,
    })

    return {
        labeled: 1,
        archived: modifyResult.archived ? 1 : 0,
        skipped: 0,
        goldSpent: classificationGoldSpent + followUpGoldSpent,
        estimatedNormalGoldCost: estimatedNormalGoldCost + followUpEstimatedNormalGoldCost,
        insufficientGold: insufficientGoldForClassification,
    }
}

async function getConnectedGmailEmail(userId, projectId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) {
        throw new Error('User not found')
    }

    const userData = userDoc.data() || {}
    const gmailConnection = userData.apisConnected?.[projectId] || {}
    if (!gmailConnection.gmail) {
        throw new Error('Gmail is not connected for this project')
    }

    return {
        userData,
        gmailEmail: gmailConnection.gmailEmail || userData.email || '',
    }
}

function assertPremiumAccess(userData) {
    if (userData?.premium?.status !== 'premium') {
        const error = new Error('Gmail labeling is available for premium users only.')
        error.code = 'premium-required'
        throw error
    }
}

async function syncGmailLabeling(userId, projectId, options = {}) {
    const { gmailEmail, userData } = await getConnectedGmailEmail(userId, projectId)
    const logContext = createSyncLogContext(userId, projectId, gmailEmail)
    assertPremiumAccess(userData)
    const { config, exists } = await loadConfig(userId, projectId, gmailEmail)

    logSync('Starting Gmail labeling sync', {
        ...logContext,
        options,
        configExists: exists,
        configEnabled: config?.enabled,
        processUnreadOnly: config?.processUnreadOnly,
        onlyInbox: config?.onlyInbox,
        maxMessagesPerRun: config?.maxMessagesPerRun,
        lookbackDays: config?.lookbackDays,
    })

    if (!exists || !config.enabled) {
        logSync('Skipping Gmail labeling sync because config is missing or disabled', {
            ...logContext,
            skippedReason: exists ? 'disabled' : 'missing_config',
        })
        return {
            success: true,
            scanned: 0,
            classified: 0,
            labeled: 0,
            archived: 0,
            skipped: 0,
            lastHistoryId: null,
            lastError: null,
            skippedReason: exists ? 'disabled' : 'missing_config',
        }
    }

    await acquireSyncLock(userId, projectId, gmailEmail)

    try {
        const gmail = await getGmailClient(userId, projectId)
        const { state } = await loadState(userId, projectId, gmailEmail)
        const labelMap = await loadExistingLabelMap(gmail)
        const syncStartHistoryId = await getCurrentProfileHistoryId(gmail)
        const bootstrapForScopeExpansion = shouldBootstrapForScopeExpansion(state, config)

        logSync('Loaded Gmail labeling sync state', {
            ...logContext,
            lastHistoryId: state.lastHistoryId || null,
            lastProcessUnreadOnly:
                typeof state.lastProcessUnreadOnly === 'boolean' ? state.lastProcessUnreadOnly : null,
            lastOnlyInbox: typeof state.lastOnlyInbox === 'boolean' ? state.lastOnlyInbox : null,
            syncStartHistoryId: syncStartHistoryId || null,
            bootstrapForScopeExpansion,
            forceBootstrap: !!options.forceBootstrap,
        })

        let messageIds = []
        let resetHistory = false
        let syncMode = 'incremental'
        let bootstrapQuery = null

        if (state.lastHistoryId && !options.forceBootstrap && !bootstrapForScopeExpansion) {
            try {
                messageIds = await listIncrementalMessageIds(gmail, state, config)
                logSync('Fetched incremental Gmail message ids', {
                    ...logContext,
                    lastHistoryId: state.lastHistoryId,
                    incrementalCount: messageIds.length,
                })
            } catch (error) {
                const staleHistory =
                    error?.code === 404 ||
                    error?.response?.status === 404 ||
                    error?.message?.toLowerCase?.().includes('historyid')
                if (!staleHistory) throw error
                resetHistory = true
                logSync('Resetting Gmail history cursor after stale historyId', {
                    ...logContext,
                    lastHistoryId: state.lastHistoryId,
                    error: error.message,
                })
            }
        }

        if (!state.lastHistoryId || options.forceBootstrap || resetHistory || bootstrapForScopeExpansion) {
            const bootstrapResult = await listBootstrapMessageIds(gmail, config)
            messageIds = bootstrapResult.messageIds
            bootstrapQuery = bootstrapResult.query
            syncMode = bootstrapForScopeExpansion ? 'bootstrap_scope_expansion' : 'bootstrap'
            logSync('Fetched bootstrap Gmail message ids', {
                ...logContext,
                syncMode,
                bootstrapQuery,
                bootstrapCount: messageIds.length,
                hadLastHistoryId: !!state.lastHistoryId,
                resetHistory,
            })
        }

        const fetchedMessages = await fetchMessagesByIds(gmail, messageIds)
        logSync('Fetched Gmail messages by id', {
            ...logContext,
            syncMode,
            requestedMessageCount: messageIds.length,
            fetchedMessageCount: fetchedMessages.length,
        })

        const candidateMessages = filterCandidateMessages(fetchedMessages, config).slice(0, config.maxMessagesPerRun)
        logSync('Filtered Gmail candidate messages', {
            ...logContext,
            syncMode,
            fetchedMessageCount: fetchedMessages.length,
            candidateMessageCount: candidateMessages.length,
            processUnreadOnly: config.processUnreadOnly,
            onlyInbox: config.onlyInbox,
            lookbackDays: config.lookbackDays,
            maxMessagesPerRun: config.maxMessagesPerRun,
        })

        const processedMessageIds = options.forceBootstrap
            ? new Set()
            : await getExistingAuditIds(
                  userId,
                  projectId,
                  candidateMessages.map(message => message.id)
              )
        const messagesToProcess = options.forceBootstrap
            ? candidateMessages
            : candidateMessages.filter(message => !processedMessageIds.has(message.id))

        logSync('Prepared Gmail messages for processing', {
            ...logContext,
            syncMode,
            candidateMessageCount: candidateMessages.length,
            alreadyProcessedCount: processedMessageIds.size,
            messageCountToProcess: messagesToProcess.length,
        })

        let labeled = 0
        let archived = 0
        let skipped = candidateMessages.length - messagesToProcess.length
        let goldSpent = 0
        let estimatedNormalGoldSpent = 0
        let syncLastError = null

        for (const rawMessage of messagesToProcess) {
            try {
                logSync('Processing Gmail message', {
                    ...logContext,
                    messageId: rawMessage.id,
                    threadId: rawMessage.threadId,
                    labelIds: rawMessage.labelIds || [],
                })
                const result = await processSingleMessage({
                    gmail,
                    labelMap,
                    config,
                    userId,
                    userData,
                    projectId,
                    gmailEmail,
                    rawMessage,
                    syncRunId: logContext.runId,
                    forceFollowUp: !!options.forceBootstrap,
                })
                labeled += result.labeled
                archived += result.archived
                skipped += result.skipped
                goldSpent += result.goldSpent || 0
                estimatedNormalGoldSpent += result.estimatedNormalGoldCost || 0
                logSync('Finished processing Gmail message', {
                    ...logContext,
                    messageId: rawMessage.id,
                    labeled: result.labeled,
                    archived: result.archived,
                    skipped: result.skipped,
                    goldSpent: result.goldSpent || 0,
                    estimatedNormalGoldCost: result.estimatedNormalGoldCost || 0,
                    insufficientGold: !!result.insufficientGold,
                })
                if (result.insufficientGold) {
                    syncLastError = 'Insufficient Gold to label additional emails.'
                    logSync('Stopping Gmail labeling sync after insufficient gold', {
                        ...logContext,
                        messageId: rawMessage.id,
                        goldSpent,
                    })
                    break
                }
            } catch (error) {
                console.error('[gmailLabeling] Failed processing Gmail message', {
                    ...logContext,
                    projectId,
                    userId,
                    messageId: rawMessage.id,
                    error: error.message,
                })

                const normalizedMessage = normalizeGmailMessage(rawMessage)
                const direction = getGmailMessageDirection(rawMessage)
                await writeAuditRecord(userId, projectId, normalizedMessage, {
                    syncRunId: logContext.runId,
                    direction,
                    selectedLabelKey: null,
                    selectedGmailLabelName: null,
                    autoArchive: false,
                    confidence: null,
                    reasoning: error.message,
                    applied: false,
                    archived: false,
                    skippedReason: 'processing_error',
                    promptVersion: config.updatedAt || admin.firestore.Timestamp.now(),
                    postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
                })
                skipped += 1
            }
        }

        const latestHistoryId = await getCurrentProfileHistoryId(gmail)
        const now = admin.firestore.Timestamp.now()
        const resolvedHistoryId = syncStartHistoryId || latestHistoryId || state.lastHistoryId || null

        await finalizeSyncState(
            userId,
            projectId,
            {
                type: 'gmailLabelingState',
                projectId,
                gmailEmail,
                lastHistoryId: resolvedHistoryId,
                lastSuccessfulSyncAt: now,
                lastSyncAt: now,
                lastRunId: logContext.runId,
                lastError: syncLastError,
                lastProcessedCount: candidateMessages.length,
                lastLabeledCount: labeled,
                lastArchivedCount: archived,
                lastProcessUnreadOnly: config.processUnreadOnly,
                lastOnlyInbox: config.onlyInbox,
            },
            'idle'
        )

        logSync('Completed Gmail labeling sync', {
            ...logContext,
            syncMode,
            bootstrapQuery,
            scanned: candidateMessages.length,
            classified: messagesToProcess.length,
            labeled,
            archived,
            skipped,
            goldSpent,
            resolvedHistoryId,
            lastError: syncLastError,
        })

        return {
            success: true,
            scanned: candidateMessages.length,
            classified: messagesToProcess.length,
            labeled,
            archived,
            skipped,
            goldSpent,
            estimatedNormalGoldSpent,
            lastSyncAt: now,
            lastRunId: logContext.runId,
            recentAuditEntries: await loadRecentAuditEntries(userId, projectId),
            lastHistoryId: resolvedHistoryId,
            lastError: syncLastError,
            gmailEmail,
            userId,
            projectId,
            syncMode,
        }
    } catch (error) {
        const now = admin.firestore.Timestamp.now()
        await finalizeSyncState(
            userId,
            projectId,
            {
                type: 'gmailLabelingState',
                projectId,
                gmailEmail,
                lastSyncAt: now,
                lastError: error.message,
                lastProcessUnreadOnly: config.processUnreadOnly,
                lastOnlyInbox: config.onlyInbox,
            },
            'error'
        )
        console.error('[gmailLabeling] Gmail labeling sync failed', {
            ...logContext,
            error: error.message,
            stack: error.stack,
        })
        throw error
    }
}

async function processEnabledGmailLabelingConfigs(limit = 100) {
    const snapshot = await admin
        .firestore()
        .collectionGroup('private')
        .where('type', '==', GMAIL_LABELING_CONFIG_TYPE)
        .where('enabled', '==', true)
        .limit(limit)
        .get()

    const results = []

    for (const doc of snapshot.docs) {
        const data = doc.data() || {}
        const parent = doc.ref.parent?.parent
        const userId = parent?.id
        if (!userId || !data.projectId) continue

        try {
            const { state } = await loadState(userId, data.projectId, data.gmailEmail || '')
            if (!isScheduledSyncDue(state, data)) {
                results.push({
                    success: true,
                    skippedReason: 'interval_not_due',
                    userId,
                    projectId: data.projectId,
                    syncIntervalMinutes: getConfiguredSyncIntervalMinutes(data),
                })
                continue
            }

            const result = await syncGmailLabeling(userId, data.projectId)
            results.push(result)
        } catch (error) {
            if (error?.code === 'premium-required') {
                console.log('[gmailLabeling] Scheduled sync skipped because premium is required', {
                    userId,
                    projectId: data.projectId,
                })
                results.push({
                    success: false,
                    skippedReason: 'premium_required',
                    userId,
                    projectId: data.projectId,
                })
                continue
            }

            if (error instanceof GmailSyncLockedError) {
                results.push({
                    success: false,
                    skippedReason: 'locked',
                    userId,
                    projectId: data.projectId,
                })
                continue
            }

            console.error('[gmailLabeling] Scheduled sync failed', {
                userId,
                projectId: data.projectId,
                error: error.message,
            })
            results.push({
                success: false,
                userId,
                projectId: data.projectId,
                lastError: error.message,
            })
        }
    }

    return results
}

module.exports = {
    GmailSyncLockedError,
    buildGmailMessageUrl,
    buildPostLabelGmailContext,
    createPostLabelPromptHash,
    executePostLabelPrompt,
    getGmailLabelingConfigWithState,
    getDefaultAssistantIdForProject,
    getExternalRecipientEmails,
    processEnabledGmailLabelingConfigs,
    processSingleMessage,
    resolvePostLabelAssistantContext,
    syncGmailLabeling,
    upsertGmailLabelingConfig,
}
