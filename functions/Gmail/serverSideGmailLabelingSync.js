'use strict'

const admin = require('firebase-admin')
const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
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

const INITIAL_SYNC_LOOKBACK_QUERY = 'newer_than:7d'
const MAX_HISTORY_PAGES = 5
const MAX_MESSAGES_FETCH_MULTIPLIER = 3
const ALDDONE_MANAGED_LABEL_PREFIX = 'Alldone/'

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

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

function buildBootstrapQuery(config) {
    const queryParts = [INITIAL_SYNC_LOOKBACK_QUERY]
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
    const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: config.maxMessagesPerRun * MAX_MESSAGES_FETCH_MULTIPLIER,
        q: buildBootstrapQuery(config),
    })

    return (response?.data?.messages || []).map(message => message.id).filter(Boolean)
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
    const classifierResult = await classifyGmailMessage({ config, message: normalizedMessage })
    const promptVersion = config.updatedAt || admin.firestore.Timestamp.now()

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

        return { labeled: 0, archived: 0, skipped: 1 }
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

        return { labeled: 0, archived: 0, skipped: 1 }
    }

    const labelId = selectedDefinition.gmailLabelName.startsWith(ALDDONE_MANAGED_LABEL_PREFIX)
        ? await createOrGetGmailLabelId(gmail, labelMap, selectedDefinition.gmailLabelName)
        : await createOrGetGmailLabelId(gmail, labelMap, selectedDefinition.gmailLabelName)

    const modifyResult = await applyLabelAndArchive(gmail, normalizedMessage, labelId, selectedDefinition.autoArchive)

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

async function syncGmailLabeling(userId, projectId, options = {}) {
    const { gmailEmail } = await getConnectedGmailEmail(userId, projectId)
    const { config, exists } = await loadConfig(userId, projectId, gmailEmail)

    if (!exists || !config.enabled) {
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

        let messageIds = []
        let resetHistory = false

        if (state.lastHistoryId && !options.forceBootstrap) {
            try {
                messageIds = await listIncrementalMessageIds(gmail, state, config)
            } catch (error) {
                const staleHistory =
                    error?.code === 404 ||
                    error?.response?.status === 404 ||
                    error?.message?.toLowerCase?.().includes('historyid')
                if (!staleHistory) throw error
                resetHistory = true
            }
        }

        if (!state.lastHistoryId || options.forceBootstrap || resetHistory) {
            messageIds = await listBootstrapMessageIds(gmail, config)
        }

        const fetchedMessages = await fetchMessagesByIds(gmail, messageIds)
        const candidateMessages = filterCandidateMessages(fetchedMessages, config).slice(0, config.maxMessagesPerRun)
        const processedMessageIds = await getExistingAuditIds(
            userId,
            projectId,
            candidateMessages.map(message => message.id)
        )
        const messagesToProcess = candidateMessages.filter(message => !processedMessageIds.has(message.id))

        let labeled = 0
        let archived = 0
        let skipped = candidateMessages.length - messagesToProcess.length

        for (const rawMessage of messagesToProcess) {
            try {
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
            } catch (error) {
                console.error('[gmailLabeling] Failed processing Gmail message', {
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

        await finalizeSyncState(
            userId,
            projectId,
            {
                type: 'gmailLabelingState',
                projectId,
                gmailEmail,
                lastHistoryId: syncStartHistoryId || latestHistoryId || state.lastHistoryId || null,
                lastSuccessfulSyncAt: now,
                lastSyncAt: now,
                lastError: null,
                lastProcessedCount: candidateMessages.length,
                lastLabeledCount: labeled,
                lastArchivedCount: archived,
            },
            'idle'
        )

        return {
            success: true,
            scanned: candidateMessages.length,
            classified: messagesToProcess.length,
            labeled,
            archived,
            skipped,
            lastHistoryId: syncStartHistoryId || latestHistoryId || state.lastHistoryId || null,
            lastError: null,
            gmailEmail,
            userId,
            projectId,
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
            },
            'error'
        )
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
