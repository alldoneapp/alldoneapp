'use strict'

const admin = require('firebase-admin')
const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { calculateGoldCostFromTokens } = require('../Assistant/assistantHelper')
const { deductGold } = require('../Gold/goldHelper')
const { adGoldToUser } = require('../Users/usersFirestore')
const {
    GMAIL_LABELING_CONFIG_TYPE,
    GMAIL_LABELING_LOCK_TIMEOUT_MS,
    buildConfigWriteData,
    buildDefaultState,
    getDefaultGmailLabelingConfig,
    getGmailLabelingConfigRef,
    getGmailLabelingStateRef,
} = require('./gmailLabelingConfig')
const { normalizeGmailMessage } = require('./gmailMessageParser')
const { classifyGmailMessage } = require('./gmailPromptClassifier')

const MAX_HISTORY_PAGES = 5
const MAX_MESSAGES_FETCH_MULTIPLIER = 3
const ALDDONE_MANAGED_LABEL_PREFIX = 'Alldone/'
const GMAIL_LABELING_GOLD_COST_PER_EMAIL = 1

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

function logSync(message, context = {}) {
    console.log('[gmailLabeling]', message, context)
}

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

function buildBootstrapQuery(config) {
    const queryParts = [`newer_than:${config.lookbackDays || 7}d`]
    if (config.onlyInbox) queryParts.push('in:inbox')
    if (config.processUnreadOnly) queryParts.push('is:unread')
    return queryParts.join(' ')
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
        config: configDoc.data(),
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
    return {
        config: exists ? config : getDefaultGmailLabelingConfig(projectId, gmailEmail),
        state,
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

async function createOrGetGmailLabelId(gmail, labelMap, labelName) {
    if (labelMap.has(labelName)) return labelMap.get(labelName)

    let createdLabel
    try {
        createdLabel = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: labelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        })
    } catch (error) {
        const alreadyExists = error?.code === 409 || error?.response?.status === 409
        if (!alreadyExists) throw error

        const refreshedMap = await loadExistingLabelMap(gmail)
        const existingLabelId = refreshedMap.get(labelName)
        if (existingLabelId) {
            labelMap.set(labelName, existingLabelId)
            return existingLabelId
        }

        throw error
    }

    const labelId = createdLabel?.data?.id || null
    if (!labelId) {
        throw new Error(`Failed creating Gmail label "${labelName}"`)
    }

    labelMap.set(labelName, labelId)
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

async function applyLabelAndArchive(gmail, normalizedMessage, labelId, autoArchive) {
    const removeLabelIds = autoArchive && normalizedMessage.labelIds.includes('INBOX') ? ['INBOX'] : []
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
        archived: removeLabelIds.includes('INBOX'),
    }
}

async function processSingleMessage({ gmail, labelMap, config, userId, projectId, rawMessage }) {
    const normalizedMessage = normalizeGmailMessage(rawMessage)
    const promptVersion = config.updatedAt || admin.firestore.Timestamp.now()

    const goldResult = await deductGold(userId, GMAIL_LABELING_GOLD_COST_PER_EMAIL)
    if (!goldResult?.success) {
        logSync('Skipping Gmail labeling because user has insufficient gold', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            requiredGold: GMAIL_LABELING_GOLD_COST_PER_EMAIL,
            currentGold: goldResult?.currentGold ?? null,
        })

        await writeAuditRecord(userId, projectId, normalizedMessage, {
            selectedLabelKey: null,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: null,
            reasoning: 'Skipped before classification because the user has insufficient gold.',
            applied: false,
            archived: false,
            skippedReason: 'insufficient_gold',
            promptVersion,
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
        classifierResult = await classifyGmailMessage({ config, message: normalizedMessage })
    } catch (error) {
        await adGoldToUser(userId, GMAIL_LABELING_GOLD_COST_PER_EMAIL)
        console.warn('[gmailLabeling] Refunded gold after Gmail classification failure', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            refundedGold: GMAIL_LABELING_GOLD_COST_PER_EMAIL,
            error: error.message,
        })
        throw error
    }

    logSync('Classified Gmail message', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        threadId: normalizedMessage.threadId,
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

    if (!classifierResult.matched) {
        await writeAuditRecord(userId, projectId, normalizedMessage, {
            selectedLabelKey: null,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: classifierResult.confidence,
            reasoning: classifierResult.reasoning,
            applied: false,
            archived: false,
            skippedReason: 'no_match',
            promptVersion,
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: GMAIL_LABELING_GOLD_COST_PER_EMAIL,
            estimatedNormalGoldCost,
            insufficientGold: false,
        }
    }

    const selectedDefinition = config.labelDefinitions.find(label => label.key === classifierResult.labelKey)
    if (!selectedDefinition) {
        await writeAuditRecord(userId, projectId, normalizedMessage, {
            selectedLabelKey: classifierResult.labelKey,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: classifierResult.confidence,
            reasoning: classifierResult.reasoning,
            applied: false,
            archived: false,
            skippedReason: 'missing_label_definition',
            promptVersion,
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: GMAIL_LABELING_GOLD_COST_PER_EMAIL,
            estimatedNormalGoldCost,
            insufficientGold: false,
        }
    }

    const labelId = selectedDefinition.gmailLabelName.startsWith(ALDDONE_MANAGED_LABEL_PREFIX)
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
    })

    let modifyResult
    try {
        modifyResult = await applyLabelAndArchive(gmail, normalizedMessage, labelId, selectedDefinition.autoArchive)
    } catch (error) {
        await adGoldToUser(userId, GMAIL_LABELING_GOLD_COST_PER_EMAIL)
        console.warn('[gmailLabeling] Refunded gold after Gmail label apply failure', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            refundedGold: GMAIL_LABELING_GOLD_COST_PER_EMAIL,
            error: error.message,
        })
        throw error
    }

    await writeAuditRecord(userId, projectId, normalizedMessage, {
        selectedLabelKey: selectedDefinition.key,
        selectedGmailLabelName: selectedDefinition.gmailLabelName,
        autoArchive: !!selectedDefinition.autoArchive,
        confidence: classifierResult.confidence,
        reasoning: classifierResult.reasoning,
        applied: modifyResult.applied,
        archived: modifyResult.archived,
        skippedReason: null,
        promptVersion,
    })

    return {
        labeled: 1,
        archived: modifyResult.archived ? 1 : 0,
        skipped: 0,
        goldSpent: GMAIL_LABELING_GOLD_COST_PER_EMAIL,
        estimatedNormalGoldCost,
        insufficientGold: false,
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

        const processedMessageIds = await getExistingAuditIds(
            userId,
            projectId,
            candidateMessages.map(message => message.id)
        )
        const messagesToProcess = candidateMessages.filter(message => !processedMessageIds.has(message.id))

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
                    projectId,
                    rawMessage,
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
                await writeAuditRecord(userId, projectId, normalizedMessage, {
                    selectedLabelKey: null,
                    selectedGmailLabelName: null,
                    autoArchive: false,
                    confidence: null,
                    reasoning: error.message,
                    applied: false,
                    archived: false,
                    skippedReason: 'processing_error',
                    promptVersion: config.updatedAt || admin.firestore.Timestamp.now(),
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
    getGmailLabelingConfigWithState,
    processEnabledGmailLabelingConfigs,
    syncGmailLabeling,
    upsertGmailLabelingConfig,
}
