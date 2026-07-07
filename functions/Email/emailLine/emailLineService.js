'use strict'

const admin = require('firebase-admin')
const {
    CONNECTION_SERVICE_EMAIL,
    findConnectionsForProject,
    getConnection,
    resolveEmailConnection,
} = require('../../Integrations/providerConnections')
const { getGmailLabelingConfigRef, getGmailLabelingStateRef } = require('../../Gmail/gmailLabelingConfig')
const gmailEmailLine = require('./gmailEmailLine')
const microsoftEmailLine = require('./microsoftEmailLine')
const { EmailLineAuthError, isAuthError } = require('./emailLineErrors')
const { composeReply, REPLY_MODEL_KEY } = require('./replyComposer')
const { summarizeEmailAsTaskName, TASK_SUMMARY_MODEL_KEY } = require('./taskSummarizer')

const GOLD_SOURCE_DRAFT_REPLY = 'email_draft_reply'
const GOLD_SOURCE_CREATE_TASK = 'email_create_task'
// How many recent labeling audit records to consider when building needs-reply flags.
const NEEDS_REPLY_AUDIT_WINDOW = 100

function getLabelingAuditCollectionRef(userId, projectId) {
    return getGmailLabelingStateRef(userId, projectId).collection('messages')
}

function getLegacyProjectIdsForEmailConnection(userData = {}, connection = {}) {
    if (!connection || connection.provider !== 'google' || !connection.emailAddress) return []
    const targetEmail = String(connection.emailAddress || '')
        .trim()
        .toLowerCase()
    const targetProvider = String(connection.provider || '')
        .trim()
        .toLowerCase()
    const apisConnected = userData?.apisConnected || {}
    return Object.keys(apisConnected).filter(projectId => {
        const resolved = resolveEmailConnection(apisConnected[projectId] || {})
        return (
            resolved.connected &&
            resolved.provider === targetProvider &&
            String(resolved.emailAddress || '')
                .trim()
                .toLowerCase() === targetEmail
        )
    })
}

function getGmailLabelingLookupKeys(userData = {}, key = '', connection = null) {
    const keys = [key]
    if (connection?.provider === 'google') {
        if (connection.defaultProjectId) keys.push(connection.defaultProjectId)
        keys.push(...getLegacyProjectIdsForEmailConnection(userData, connection))
    }
    return [...new Set(keys.filter(Boolean))]
}

function getProviderModule(provider) {
    return provider === 'microsoft' ? microsoftEmailLine : gmailEmailLine
}

function isInboxLabel(label = {}) {
    return label.kind === 'inbox' || label.labelId === 'INBOX' || label.displayName === 'Inbox'
}

function isNoLabel(label = {}) {
    return label.kind === 'no_label' || label.labelId === '__NO_LABEL__' || label.displayName === 'No label'
}

async function loadUserData(userId, providedUserData) {
    if (providedUserData) return providedUserData
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    return userDoc.exists ? userDoc.data() || {} : {}
}

// The email line key is an account-level connection id (new) or a projectId (legacy).
// Both resolve to { connected, provider, emailAddress } via the shared resolvers.
function resolveProvider(userData, key) {
    if (typeof key === 'string' && key.startsWith('email_')) {
        const connection = getConnection(userData, CONNECTION_SERVICE_EMAIL, key)
        if (connection) {
            return {
                connected: true,
                provider: connection.provider,
                emailAddress: connection.emailAddress,
                defaultProjectId: connection.defaultProjectId || '',
            }
        }
        return { connected: false, provider: '', emailAddress: '' }
    }

    const legacyResolved = resolveEmailConnection(userData?.apisConnected?.[key] || {})
    if (legacyResolved.connected) return { ...legacyResolved, defaultProjectId: key }

    // A project whose connection was created account-level only (new connect flow).
    const [match] = findConnectionsForProject(userData, CONNECTION_SERVICE_EMAIL, key)
    if (match) {
        return {
            connected: true,
            provider: match.provider,
            emailAddress: match.emailAddress,
            defaultProjectId: match.defaultProjectId || key,
        }
    }
    return legacyResolved
}

// Needs-reply now comes from the labeling classifier's audit records — no separate
// detector, no gold charge. Only emails the labeling sync has processed carry a flag,
// so coverage requires labeling to be enabled. Never throws — a read failure must not
// break the summary.
async function loadNeedsReplyFlagsFromAudit(userId, projectIds) {
    const lookupKeys = Array.isArray(projectIds) ? projectIds : [projectIds]
    try {
        const flags = {}
        const snapshots = await Promise.all(
            lookupKeys.map(projectId =>
                getLabelingAuditCollectionRef(userId, projectId)
                    .orderBy('processedAt', 'desc')
                    .limit(NEEDS_REPLY_AUDIT_WINDOW)
                    .get()
            )
        )
        snapshots.forEach(snapshot => {
            snapshot.docs.forEach(doc => {
                if (doc.data()?.needsReply === true) flags[doc.id] = true
            })
        })
        return flags
    } catch (error) {
        console.warn('[emailLine] needs-reply audit read failed:', error?.message || error)
        return {}
    }
}

// Batch-join labeling audit records onto message rows by message id (label name,
// reasoning, confidence, needsReply). Labeling is Gmail-only; other providers simply
// find no audit docs. Never throws — the join is enrichment, not a requirement.
function scoreAuditEntry(audit = {}) {
    let score = 0
    if (typeof audit.reasoning === 'string' && audit.reasoning.trim()) score += 4
    if (audit.selectedLabelKey || audit.selectedGmailLabelName || audit.selectedProjectId) score += 2
    if (audit.taskCreated) score += 1
    return score
}

async function loadAuditEntriesByMessageId(userId, projectIds, messageIds = []) {
    if (!messageIds.length) return {}
    const lookupKeys = Array.isArray(projectIds) ? projectIds : [projectIds]
    try {
        const refMetadata = []
        lookupKeys.forEach(projectId => {
            messageIds.forEach(messageId => {
                refMetadata.push({
                    projectId,
                    messageId,
                    ref: getLabelingAuditCollectionRef(userId, projectId).doc(messageId),
                })
            })
        })
        const refs = refMetadata.map(entry => entry.ref)
        const snapshots = await admin.firestore().getAll(...refs)
        const byId = {}
        snapshots.forEach((snapshot, index) => {
            if (!snapshot.exists) return
            const metadata = refMetadata[index]
            const audit = { ...snapshot.data(), __auditKey: metadata.projectId }
            const existing = byId[metadata.messageId]
            if (!existing || scoreAuditEntry(audit) > scoreAuditEntry(existing)) {
                byId[metadata.messageId] = audit
            }
        })
        return byId
    } catch (error) {
        console.warn('[emailLine] labeling audit join failed:', error?.message || error)
        return {}
    }
}

async function loadConfiguredLabelOptions(userId, userData, projectId, connection) {
    if (connection.provider !== 'google') return []
    const lookupKeys = getGmailLabelingLookupKeys(userData, projectId, connection)
    try {
        const { resolveEffectiveGmailLabelingConfig } = require('../../Gmail/serverSideGmailLabelingSync')
        for (const key of lookupKeys) {
            const configSnap = await getGmailLabelingConfigRef(userId, key)
                .get()
                .catch(() => null)
            if (!configSnap?.exists) continue
            const effectiveConfig = await resolveEffectiveGmailLabelingConfig(configSnap.data() || {}, userData)
            return [
                ...new Set(
                    (effectiveConfig.labelDefinitions || [])
                        .map(label => (typeof label.gmailLabelName === 'string' ? label.gmailLabelName.trim() : ''))
                        .filter(Boolean)
                ),
            ]
        }
    } catch (error) {
        console.warn('[emailLine] configured label options read failed:', error?.message || error)
    }
    return []
}

// Returns { provider, emailAddress, labels, needsReplyCount, needsReplyByMessageId, inboxZero, scannedAt }
async function getEmailLineSummary(userId, projectId, options = {}) {
    const { userData: providedUserData, includeNeedsReply } = options
    const userData = await loadUserData(userId, providedUserData)
    const connection = resolveProvider(userData, projectId)

    if (!connection.connected) {
        return {
            provider: '',
            emailAddress: '',
            labels: [],
            needsReplyCount: 0,
            needsReplyByMessageId: {},
            inboxZero: true,
            connected: false,
            scannedAt: Date.now(),
        }
    }

    let summary
    try {
        if (connection.provider === 'microsoft') {
            summary = await microsoftEmailLine.getMicrosoftLabelSummary(userId, projectId)
        } else {
            summary = await gmailEmailLine.getGmailLabelSummary(userId, projectId)
        }
    } catch (error) {
        if (isAuthError(error)) throw new EmailLineAuthError()
        throw error
    }

    const labels = summary.labels || []
    const configuredLabelOptions = await loadConfiguredLabelOptions(userId, userData, projectId, connection)
    const inboxZero = labels.every(
        label => (Number.isFinite(label.threadCount) ? label.threadCount : label.unreadCount) === 0
    )

    // "Needs reply" = flagged by the labeling classifier AND still unread in the inbox.
    let needsReplyByMessageId = {}
    let labelingEnabled = false
    if (includeNeedsReply && connection.provider !== 'microsoft') {
        const auditLookupKeys = getGmailLabelingLookupKeys(userData, projectId, connection)
        const [auditFlags, unreadIds, configSnaps] = await Promise.all([
            loadNeedsReplyFlagsFromAudit(userId, auditLookupKeys),
            gmailEmailLine.getUnreadInboxMessageIds(userId, projectId, NEEDS_REPLY_AUDIT_WINDOW).catch(() => null),
            Promise.all(
                auditLookupKeys.map(key =>
                    getGmailLabelingConfigRef(userId, key)
                        .get()
                        .catch(() => null)
                )
            ),
        ])
        labelingEnabled = configSnaps.some(configSnap => !!configSnap?.exists && configSnap.data()?.enabled === true)
        if (unreadIds === null) {
            needsReplyByMessageId = auditFlags
        } else {
            const unreadSet = new Set(unreadIds)
            Object.keys(auditFlags).forEach(id => {
                if (unreadSet.has(id)) needsReplyByMessageId[id] = true
            })
        }
    }

    return {
        provider: connection.provider,
        emailAddress: summary.emailAddress || connection.emailAddress || '',
        labels,
        labelOptions: [
            ...new Set([
                ...configuredLabelOptions,
                ...labels
                    .filter(label => !isInboxLabel(label) && !isNoLabel(label))
                    .map(label => label.displayName)
                    .filter(Boolean),
            ]),
        ],
        needsReplyCount: Object.keys(needsReplyByMessageId).length,
        needsReplyByMessageId,
        labelingEnabled,
        inboxZero,
        connected: true,
        scannedAt: Date.now(),
    }
}

async function resolveConnectionOrThrow(userId, projectId, providedUserData) {
    const userData = await loadUserData(userId, providedUserData)
    const connection = resolveProvider(userData, projectId)
    if (!connection.connected) {
        throw new EmailLineAuthError('Email is not connected for this project')
    }
    return { connection, userData }
}

// The real project behind an email line key — the connection's default project when the
// key is a connection id, otherwise the key itself. Used wherever a projectId is stored
// (gold ledger, created tasks) so connection ids never leak into those fields.
function resolveConnectionProjectId(userData, key) {
    if (typeof key === 'string' && key.startsWith('email_')) {
        const connection = getConnection(userData, CONNECTION_SERVICE_EMAIL, key)
        return connection?.defaultProjectId || ''
    }
    return key
}

// Returns { messages, nextPageToken }
async function listEmailLineMessages(userId, projectId, labelId, options = {}) {
    const { pageToken, userData: providedUserData } = options
    const { connection, userData } = await resolveConnectionOrThrow(userId, projectId, providedUserData)
    const provider = getProviderModule(connection.provider)
    try {
        const result = await provider.listMessagesForLabel(userId, projectId, labelId, {
            pageToken,
            emailAddress: connection.emailAddress,
        })
        const rows = result?.messages || []
        const auditLookupIds = [
            ...new Set(
                rows
                    .flatMap(message => [
                        message.messageId,
                        ...(Array.isArray(message.messageIds) ? message.messageIds : []),
                    ])
                    .filter(Boolean)
            ),
        ]
        const auditLookupKeys = getGmailLabelingLookupKeys(userData, projectId, connection)
        const auditById = await loadAuditEntriesByMessageId(userId, auditLookupKeys, auditLookupIds)
        const messages = rows.map(message => {
            const auditMessageId =
                (message.messageId && auditById[message.messageId] && message.messageId) ||
                (Array.isArray(message.messageIds) ? message.messageIds.find(id => auditById[id]) : '') ||
                ''
            const audit = auditById[auditMessageId]
            return {
                ...message,
                auditMessageId,
                needsReply: audit?.needsReply === true,
                hasAudit: !!audit,
                labelKey: audit?.selectedLabelKey || null,
                labelName: audit?.selectedGmailLabelName || null,
                reasoning: audit?.reasoning || '',
                confidence: Number.isFinite(audit?.confidence) ? audit.confidence : null,
                taskCreated: audit?.taskCreated || null,
            }
        })
        return { messages, nextPageToken: result?.nextPageToken || null }
    } catch (error) {
        if (isAuthError(error)) throw new EmailLineAuthError()
        throw error
    }
}

// Composes an AI reply, charges Gold, then creates a provider draft. Gold is
// deducted only after successful composition and refunded if draft creation fails.
async function draftReply({ userId, projectId, connection, userData, messageId, guidance }) {
    if (!messageId) throw new Error('messageId is required for draftReply')
    const provider = getProviderModule(connection.provider)

    let context
    try {
        context = await provider.getMessageContext(userId, projectId, messageId)
    } catch (error) {
        if (isAuthError(error)) throw new EmailLineAuthError()
        throw error
    }

    const composed = await composeReply({
        context,
        guidance,
        language: userData?.language || userData?.appLanguage,
    })
    if (!composed.body) throw new Error('Failed to compose a reply draft')

    const { deductGold, refundGold } = require('../../Gold/goldHelper')
    const { calculateGoldCostFromTokens } = require('../../Assistant/assistantHelper')
    const goldCost = Math.max(1, calculateGoldCostFromTokens(composed.totalTokens, REPLY_MODEL_KEY))
    const goldContext = {
        source: GOLD_SOURCE_DRAFT_REPLY,
        projectId: resolveConnectionProjectId(userData, projectId),
        objectId: messageId,
        channel: connection.provider,
    }

    const goldResult = await deductGold(userId, goldCost, goldContext)
    if (!goldResult.success) {
        const error = new Error('INSUFFICIENT_GOLD')
        error.code = 'INSUFFICIENT_GOLD'
        throw error
    }

    let draft
    try {
        if (connection.provider === 'microsoft') {
            const { createMicrosoftReplyDraftForAssistantRequest } = require('../providers/microsoftEmailProvider')
            draft = await createMicrosoftReplyDraftForAssistantRequest({ userId, messageId, body: composed.body })
        } else {
            const { createGmailReplyDraftForAssistantRequest } = require('../../Gmail/assistantGmailDrafts')
            draft = await createGmailReplyDraftForAssistantRequest({ userId, messageId, body: composed.body })
        }
    } catch (error) {
        await refundGold(userId, goldCost, { ...goldContext, note: 'draft creation failed' })
        if (isAuthError(error)) throw new EmailLineAuthError()
        throw error
    }

    if (!draft || draft.success === false) {
        await refundGold(userId, goldCost, { ...goldContext, note: 'draft creation failed' })
        throw new Error(draft?.message || 'Failed to create reply draft')
    }

    return {
        draftUrl: draft.webUrl || '',
        subject: draft.targetSubject || context.subject || '',
        goldCost,
    }
}

let cachedTaskService = null
async function getTaskService() {
    if (cachedTaskService) return cachedTaskService
    const { TaskService } = require('../../shared/TaskService')
    const moment = require('moment')
    const db = admin.firestore()
    cachedTaskService = new TaskService({
        database: db,
        moment,
        idGenerator: () => db.collection('_').doc().id,
        enableFeeds: true,
        enableValidation: true,
        isCloudFunction: true,
        taskBatchSize: 100,
        maxBatchesPerProject: 20,
    })
    await cachedTaskService.initialize()
    return cachedTaskService
}

// Creates a task from an email in the same format as the labeling follow-up tasks:
// a one-sentence AI summary as the title plus gmailData (origin gmail_label_follow_up)
// so the task row renders the email chip and deep-links back to the message. Target
// project: the label's mapped project from the audit record when the user is still a
// member, else the connection's project. Gold is deducted after summarization and
// refunded if task persistence fails (mirrors draftReply).
async function createTaskFromEmail({ userId, projectId, connection, userData, messageId, messageIds }) {
    const candidateMessageIds = [
        ...new Set([messageId, ...(Array.isArray(messageIds) ? messageIds : [])].filter(Boolean)),
    ]
    if (candidateMessageIds.length === 0) throw new Error('messageId is required for createTask')
    const provider = getProviderModule(connection.provider)
    const auditLookupKeys = getGmailLabelingLookupKeys(userData, projectId, connection)
    const auditById = await loadAuditEntriesByMessageId(userId, auditLookupKeys, candidateMessageIds)
    const selectedMessageId = candidateMessageIds.find(id => auditById[id]) || candidateMessageIds[0]
    const audit = auditById[selectedMessageId] || null

    let context
    try {
        context = await provider.getMessageContext(userId, projectId, selectedMessageId)
    } catch (error) {
        if (isAuthError(error)) throw new EmailLineAuthError()
        throw error
    }

    const summary = await summarizeEmailAsTaskName({ context, language: userData?.language || userData?.appLanguage })

    const taskName = summary.name || context.subject || 'Follow up on email'

    const connectionProjectId = resolveConnectionProjectId(userData, projectId)
    const memberProjectIds = Array.isArray(userData?.projectIds) ? userData.projectIds : []
    const auditProjectId =
        typeof audit?.selectedProjectId === 'string' && audit.selectedProjectId.trim()
            ? audit.selectedProjectId.trim()
            : ''
    const targetProjectId =
        auditProjectId && memberProjectIds.includes(auditProjectId) ? auditProjectId : connectionProjectId

    const webUrl =
        connection.provider === 'microsoft'
            ? context.webUrl || ''
            : gmailEmailLine.buildGmailMessageUrl(connection.emailAddress, selectedMessageId)

    const gmailData = {
        origin: 'gmail_label_follow_up',
        provider: connection.provider,
        gmailEmail: connection.emailAddress || '',
        projectId: connectionProjectId,
        taskProjectId: targetProjectId,
        selectedProjectId: auditProjectId,
        messageId: selectedMessageId,
        messageIds: candidateMessageIds,
        threadId: context.threadId || audit?.gmailThreadId || '',
        webUrl,
        archiveOnComplete: true,
        archiveStatus: null,
    }

    const { deductGold, refundGold } = require('../../Gold/goldHelper')
    const { calculateGoldCostFromTokens } = require('../../Assistant/assistantHelper')
    const goldCost = Math.max(1, calculateGoldCostFromTokens(summary.totalTokens, TASK_SUMMARY_MODEL_KEY))
    const goldContext = {
        source: GOLD_SOURCE_CREATE_TASK,
        projectId: targetProjectId,
        objectId: selectedMessageId,
        channel: connection.provider,
    }

    const goldResult = await deductGold(userId, goldCost, goldContext)
    if (!goldResult.success) {
        const error = new Error('INSUFFICIENT_GOLD')
        error.code = 'INSUFFICIENT_GOLD'
        throw error
    }

    let result
    try {
        const taskService = await getTaskService()
        result = await taskService.createAndPersistTask(
            {
                name: taskName,
                userId,
                projectId: targetProjectId,
                isPrivate: false,
                feedUser: { uid: userId, id: userId, ...userData },
                gmailData,
            },
            {
                userId,
                projectId: targetProjectId,
            }
        )
    } catch (error) {
        await refundGold(userId, goldCost, { ...goldContext, note: 'task creation failed' })
        throw error
    }

    const taskId = result?.taskId || result?.id || result?.task?.id || null
    if (result?.success === false || !taskId) {
        await refundGold(userId, goldCost, { ...goldContext, note: 'task creation failed' })
        throw new Error(result?.message || 'Failed to create task from email')
    }

    // Explain the project choice on the task, same as the labeling follow-up flow.
    // Best-effort: a failed comment must not fail the (already created) task.
    try {
        const { addProjectRoutingReasonComment } = require('../../shared/projectRoutingCommentHelper')
        const matched = !!auditProjectId && targetProjectId === auditProjectId
        await addProjectRoutingReasonComment({
            userData,
            projectId: targetProjectId,
            taskId,
            task: result?.task || null,
            reasoning: matched
                ? audit?.reasoning || ''
                : `it is the default project for ${connection.emailAddress || 'this email account'}`,
            confidence: matched && Number.isFinite(audit?.confidence) ? audit.confidence : null,
            matched,
            source: 'email_line_create_task',
            routingKey: selectedMessageId,
            sourceDataField: 'gmailData',
            routingData: {
                messageId: selectedMessageId,
                messageIds: candidateMessageIds,
                threadId: context.threadId || '',
                selectedLabelKey: audit?.selectedLabelKey || '',
                selectedProjectId: auditProjectId || null,
            },
        })
    } catch (error) {
        console.warn('[emailLine] createTask routing comment failed:', error?.message || error)
    }

    // Remember on the audit record that this email already has a task, so the modal
    // shows the created state (with a link) instead of the + button on reopen.
    try {
        await getLabelingAuditCollectionRef(userId, audit?.__auditKey || projectId)
            .doc(selectedMessageId)
            .set({ taskCreated: { taskId, projectId: targetProjectId, taskName, at: Date.now() } }, { merge: true })
    } catch (error) {
        console.warn('[emailLine] createTask audit stamp failed:', error?.message || error)
    }

    return {
        taskId,
        projectId: targetProjectId,
        taskName,
        goldCost,
    }
}

// Handles archive / markRead / archiveAll / markAllRead / draftReply / createTask.
async function performEmailLineAction(userId, projectId, params = {}) {
    const { action, messageIds, labelId, guidance, userData: providedUserData } = params
    const { connection, userData } = await resolveConnectionOrThrow(userId, projectId, providedUserData)
    const provider = getProviderModule(connection.provider)

    try {
        switch (action) {
            case 'archive':
                return await provider.archiveMessages(userId, projectId, messageIds)
            case 'markRead':
                return await provider.markMessagesRead(userId, projectId, messageIds)
            case 'archiveAll':
            case 'markAllRead':
                if (!labelId) throw new Error('labelId is required for sweep actions')
                return await provider.sweepLabel(userId, projectId, labelId, action)
            case 'draftReply':
                return await draftReply({
                    userId,
                    projectId,
                    connection,
                    userData,
                    messageId: Array.isArray(messageIds) ? messageIds[0] : messageIds,
                    guidance,
                })
            case 'createTask':
                return await createTaskFromEmail({
                    userId,
                    projectId,
                    connection,
                    userData,
                    messageId: Array.isArray(messageIds) ? messageIds[0] : messageIds,
                    messageIds,
                })
            default:
                throw new Error(`Unsupported email line action: ${action}`)
        }
    } catch (error) {
        if (isAuthError(error)) throw new EmailLineAuthError()
        throw error
    }
}

module.exports = {
    getEmailLineSummary,
    listEmailLineMessages,
    performEmailLineAction,
    draftReply,
    createTaskFromEmail,
    getProviderModule,
    GOLD_SOURCE_DRAFT_REPLY,
    GOLD_SOURCE_CREATE_TASK,
}
