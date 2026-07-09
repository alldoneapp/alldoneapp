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

// Firestore `in` accepts at most 30 values per query.
const TASK_MESSAGE_ID_QUERY_CHUNK = 30

function chunkArray(items = [], size = TASK_MESSAGE_ID_QUERY_CHUNK) {
    const chunks = []
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
    return chunks
}

// Authoritatively reconcile emails against the tasks collection so the modal shows
// whether a task already exists for each email — even across close/reopen. Both the
// labeling follow-up flow and the "＋ create task" button stamp `gmailData.messageId`
// on the created task, so a query by that field is the source of truth: it finds open
// AND done tasks (a completed task's doc stays in `items/{projectId}/tasks`) and misses
// deleted tasks (they are hard-deleted), so the indicator self-heals when a task is
// removed. Scoped to the projects an email-derived task can land in — the connection's
// project plus any label-mapped project seen on the audit records — so it relies only on
// Firestore's automatic single-field index (no new composite/collection-group index).
// Returns a { [messageId]: { taskId, projectId, taskName } } map, or `null` if the
// reconcile failed (so the caller can fall back to the audit stamp instead of hiding a
// real task).
async function loadTasksByMessageId(userId, connection, userData, projectId, messageIds = [], auditById = {}) {
    if (!messageIds.length) return {}

    const memberProjectIds = Array.isArray(userData?.projectIds) ? userData.projectIds : []
    const candidateProjectSet = new Set()
    const connectionProjectId = resolveConnectionProjectId(userData, projectId)
    if (connectionProjectId) candidateProjectSet.add(connectionProjectId)
    Object.values(auditById).forEach(audit => {
        const selectedProjectId = typeof audit?.selectedProjectId === 'string' ? audit.selectedProjectId.trim() : ''
        if (selectedProjectId) candidateProjectSet.add(selectedProjectId)
        const stampedProjectId =
            typeof audit?.taskCreated?.projectId === 'string' ? audit.taskCreated.projectId.trim() : ''
        if (stampedProjectId) candidateProjectSet.add(stampedProjectId)
    })
    // An email-derived task always lands in a project the user belongs to; only read those.
    const candidateProjects = [...candidateProjectSet].filter(
        candidate => !memberProjectIds.length || memberProjectIds.includes(candidate)
    )
    if (!candidateProjects.length) return {}

    const connectionEmail = String(connection?.emailAddress || '')
        .trim()
        .toLowerCase()
    const byMessageId = {}
    try {
        const db = admin.firestore()
        for (const candidateProjectId of candidateProjects) {
            for (const chunk of chunkArray(messageIds)) {
                const snapshot = await db
                    .collection(`items/${candidateProjectId}/tasks`)
                    .where('gmailData.messageId', 'in', chunk)
                    .get()
                snapshot.forEach(doc => {
                    const task = doc.data() || {}
                    const taskMessageId = task?.gmailData?.messageId
                    if (!taskMessageId || byMessageId[taskMessageId]) return
                    // A Gmail message id is unique per account; guard against an unrelated
                    // task in a shared project by matching the connection's account email.
                    const taskEmail = String(task?.gmailData?.gmailEmail || '')
                        .trim()
                        .toLowerCase()
                    if (connectionEmail && taskEmail && taskEmail !== connectionEmail) return
                    byMessageId[taskMessageId] = {
                        taskId: doc.id,
                        projectId: candidateProjectId,
                        taskName: task?.name || '',
                    }
                })
            }
        }
        return byMessageId
    } catch (error) {
        console.warn('[emailLine] task reconcile failed:', error?.message || error)
        return null
    }
}

// The effective labeling label definitions for this connection (default- or custom-mode).
// Each definition carries `gmailLabelName` and, for default-mode project labels, a
// `sourceProjectId` that ties the label to an Alldone project — used both for the feedback
// options and to stamp each summary label with its owning project.
async function loadConfiguredLabelDefinitions(userId, userData, projectId, connection) {
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
            return Array.isArray(effectiveConfig.labelDefinitions) ? effectiveConfig.labelDefinitions : []
        }
    } catch (error) {
        console.warn('[emailLine] configured label definitions read failed:', error?.message || error)
    }
    return []
}

// Returns every configured label as { gmailLabelName, displayName } — the FULL set the feedback UI
// can move an email to, independent of which labels currently have inbox threads. `gmailLabelName`
// is the real Gmail label name the server resolves the id from; `displayName` is what the UI shows.
function buildLabelOptionsFromDefinitions(labelDefinitions = []) {
    return labelDefinitions
        .map(label => (typeof label.gmailLabelName === 'string' ? label.gmailLabelName.trim() : ''))
        .filter(Boolean)
        .map(gmailLabelName => ({
            gmailLabelName,
            displayName: gmailEmailLine.stripLabelPrefix(gmailLabelName),
        }))
}

// Stamps each summary label with the Alldone project it maps to (default-mode project labels
// carry a `sourceProjectId` in the config). Inbox and No-label are synthetic buckets with no
// project; Ads and custom labels have no `sourceProjectId`, so they stay unmapped. The client
// uses this to place a label's chip on its project's header line instead of All Projects.
function attachLabelProjectIds(labels = [], labelDefinitions = [], connection = {}) {
    if (connection.provider !== 'google' || !labelDefinitions.length) return labels
    return labels.map(label => {
        if (isInboxLabel(label) || isNoLabel(label)) return label
        const matched = findDefinitionProjectForLabel(labelDefinitions, {
            selectedLabelName: label.name || label.displayName,
        })
        return matched?.projectId ? { ...label, projectId: matched.projectId } : label
    })
}

function normalizeLabelText(value = '') {
    return String(value || '').trim()
}

function labelsMatch(left = '', right = '') {
    const normalizedLeft = normalizeLabelText(left)
    const normalizedRight = normalizeLabelText(right)
    if (!normalizedLeft || !normalizedRight) return false
    if (normalizedLeft === normalizedRight) return true
    return gmailEmailLine.stripLabelPrefix(normalizedLeft) === gmailEmailLine.stripLabelPrefix(normalizedRight)
}

function findDefinitionProjectForLabel(labelDefinitions = [], { selectedLabelKey = '', selectedLabelName = '' } = {}) {
    const definition = labelDefinitions.find(label => {
        if (selectedLabelKey && label.key === selectedLabelKey) return true
        return labelsMatch(label.gmailLabelName, selectedLabelName)
    })

    const sourceProjectId =
        typeof definition?.sourceProjectId === 'string' && definition.sourceProjectId.trim()
            ? definition.sourceProjectId.trim()
            : ''
    if (!sourceProjectId) return null

    return {
        projectId: sourceProjectId,
        labelKey: definition.key || selectedLabelKey || '',
        gmailLabelName: definition.gmailLabelName || selectedLabelName || '',
    }
}

async function resolveConfiguredProjectForEmailLabel({ userId, userData, projectId, connection, audit, labelName }) {
    if (connection.provider !== 'google') return null

    const selectedLabelKey = normalizeLabelText(audit?.selectedLabelKey)
    const selectedLabelName = normalizeLabelText(audit?.selectedGmailLabelName) || normalizeLabelText(labelName)
    if (!selectedLabelKey && !selectedLabelName) return null

    const lookupKeys = [audit?.__auditKey, ...getGmailLabelingLookupKeys(userData, projectId, connection)].filter(
        Boolean
    )
    const uniqueLookupKeys = [...new Set(lookupKeys)]

    try {
        const { resolveEffectiveGmailLabelingConfig } = require('../../Gmail/serverSideGmailLabelingSync')
        for (const lookupKey of uniqueLookupKeys) {
            const configSnap = await getGmailLabelingConfigRef(userId, lookupKey)
                .get()
                .catch(() => null)
            if (!configSnap?.exists) continue
            const effectiveConfig = await resolveEffectiveGmailLabelingConfig(configSnap.data() || {}, userData)
            const matchedProject = findDefinitionProjectForLabel(effectiveConfig.labelDefinitions || [], {
                selectedLabelKey,
                selectedLabelName,
            })
            if (matchedProject) return matchedProject
        }
    } catch (error) {
        console.warn('[emailLine] configured label project lookup failed:', error?.message || error)
    }

    return null
}

// Merge the configured labels with the labels that currently carry threads (some may be plain Gmail
// labels not in the config), deduped by Gmail label name so each move target appears once.
function mergeLabelOptions(configuredLabelOptions, labels) {
    const byName = new Map()
    const add = (gmailLabelName, displayName) => {
        const name = typeof gmailLabelName === 'string' ? gmailLabelName.trim() : ''
        if (!name || byName.has(name)) return
        byName.set(name, { gmailLabelName: name, displayName: displayName || name })
    }
    configuredLabelOptions.forEach(option => add(option.gmailLabelName, option.displayName))
    labels
        .filter(label => !isInboxLabel(label) && !isNoLabel(label))
        .forEach(label => add(label.name || label.displayName, label.displayName))
    return [...byName.values()]
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

    const rawLabels = summary.labels || []
    const labelDefinitions = await loadConfiguredLabelDefinitions(userId, userData, projectId, connection)
    const configuredLabelOptions = buildLabelOptionsFromDefinitions(labelDefinitions)
    const labels = attachLabelProjectIds(rawLabels, labelDefinitions, connection)
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
        labelOptions: mergeLabelOptions(configuredLabelOptions, labels),
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

function truncateContextText(value, maxLength = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function isUserProject(userData = {}, projectId = '') {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    return projectIds.length === 0 || projectIds.includes(projectId)
}

async function loadReplyGroundingContext({ userId, userData = {}, projectId }) {
    const resolvedProjectId = resolveConnectionProjectId(userData, projectId)
    const projectDoc = resolvedProjectId
        ? await admin
              .firestore()
              .doc(`projects/${resolvedProjectId}`)
              .get()
              .catch(() => null)
        : null
    const project = projectDoc?.exists ? projectDoc.data() || {} : {}
    const projectUserData = project?.usersData?.[userId] || {}

    return {
        userName: truncateContextText(userData.displayName || userData.name || '', 200),
        globalUserDescription: truncateContextText(userData.extendedDescription || userData.description || ''),
        projectName: truncateContextText(project.name || '', 200),
        projectUserDescription: truncateContextText(
            projectUserData.extendedDescription || projectUserData.description || ''
        ),
        projectDescription: truncateContextText(project.description || ''),
    }
}

async function addDraftReplyLinkComment({ userId, userData = {}, sourceProjectId, sourceTaskId, draftUrl }) {
    if (!sourceProjectId || !sourceTaskId || !draftUrl) return null
    if (!isUserProject(userData, sourceProjectId)) return null

    try {
        const { getDefaultAssistantIdForProject } = require('../../shared/projectRoutingCommentHelper')
        const assistantProjectId = userData.defaultProjectId || sourceProjectId
        const assistantId = await getDefaultAssistantIdForProject(userData, assistantProjectId)
        if (!assistantId) return null

        const { TaskCommentService } = require('../../shared/TaskCommentService')
        const taskCommentService = new TaskCommentService({ database: admin.firestore() })
        return await taskCommentService.addComment({
            projectId: sourceProjectId,
            taskId: sourceTaskId,
            comment: `I created a draft reply for this email: ${draftUrl}`,
            actor: { uid: assistantId, id: assistantId, displayName: 'Assistant' },
            fromAssistant: true,
            silent: true,
        })
    } catch (error) {
        console.warn('[emailLine] draft reply comment failed:', {
            userId,
            sourceProjectId,
            sourceTaskId,
            error: error?.message || error,
        })
        return null
    }
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
        // Live tasks are the source of truth for the "task created" indicator. `null` means
        // the reconcile failed — fall back to the audit stamp rather than hide a real task.
        const taskByMessageId = await loadTasksByMessageId(
            userId,
            connection,
            userData,
            projectId,
            auditLookupIds,
            auditById
        )
        const reconcileFailed = taskByMessageId === null
        const messages = rows.map(message => {
            const auditMessageId =
                (message.messageId && auditById[message.messageId] && message.messageId) ||
                (Array.isArray(message.messageIds) ? message.messageIds.find(id => auditById[id]) : '') ||
                ''
            const audit = auditById[auditMessageId]
            const rowMessageIds = [
                message.messageId,
                ...(Array.isArray(message.messageIds) ? message.messageIds : []),
            ].filter(Boolean)
            const taskCreated = reconcileFailed
                ? audit?.taskCreated || null
                : rowMessageIds.map(id => taskByMessageId[id]).find(Boolean) || null
            return {
                ...message,
                auditMessageId,
                needsReply: audit?.needsReply === true,
                hasAudit: !!audit,
                labelKey: audit?.selectedLabelKey || null,
                labelName: audit?.selectedGmailLabelName || null,
                reasoning: audit?.reasoning || '',
                confidence: Number.isFinite(audit?.confidence) ? audit.confidence : null,
                taskCreated,
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
async function draftReply({
    userId,
    projectId,
    connection,
    userData,
    messageId,
    guidance,
    sourceProjectId,
    sourceTaskId,
}) {
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
        groundingContext: await loadReplyGroundingContext({ userId, userData, projectId }),
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

    const draftUrl = draft.webUrl || ''
    const commentResult = await addDraftReplyLinkComment({
        userId,
        userData,
        sourceProjectId,
        sourceTaskId,
        draftUrl,
    })

    return {
        draftUrl,
        subject: draft.targetSubject || context.subject || '',
        goldCost,
        commentId: commentResult?.commentId || null,
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
async function createTaskFromEmail({ userId, projectId, connection, userData, messageId, messageIds, labelName }) {
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
    const configuredLabelProject = auditProjectId
        ? null
        : await resolveConfiguredProjectForEmailLabel({
              userId,
              userData,
              projectId,
              connection,
              audit,
              labelName,
          })
    const configuredLabelProjectId = configuredLabelProject?.projectId || ''
    const labelProjectId = auditProjectId || configuredLabelProjectId
    const targetProjectId =
        labelProjectId && memberProjectIds.includes(labelProjectId) ? labelProjectId : connectionProjectId

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
        selectedProjectId: labelProjectId,
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
        const matched = !!labelProjectId && targetProjectId === labelProjectId
        const selectedLabelName = audit?.selectedGmailLabelName || configuredLabelProject?.gmailLabelName || ''
        await addProjectRoutingReasonComment({
            userData,
            projectId: targetProjectId,
            taskId,
            task: result?.task || null,
            reasoning: matched
                ? audit?.reasoning || `The email is in the ${selectedLabelName || 'configured'} Gmail label.`
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
                selectedLabelKey: audit?.selectedLabelKey || configuredLabelProject?.labelKey || '',
                selectedProjectId: labelProjectId || null,
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
    const {
        action,
        messageIds,
        labelId,
        labelName,
        guidance,
        sourceProjectId,
        sourceTaskId,
        userData: providedUserData,
    } = params
    const { connection, userData } = await resolveConnectionOrThrow(userId, projectId, providedUserData)
    const provider = getProviderModule(connection.provider)

    const messageIdCount = Array.isArray(messageIds) ? messageIds.length : messageIds ? 1 : 0
    console.log(
        `[emailLine] action=${action} provider=${connection.provider} project=${projectId} ` +
            `label=${labelId || '-'} messageIds=${messageIdCount}`
    )

    try {
        switch (action) {
            case 'archive':
                return await provider.archiveMessages(userId, projectId, messageIds)
            case 'markRead':
                return await provider.markMessagesRead(userId, projectId, messageIds)
            case 'archiveAll':
            case 'markAllRead': {
                if (!labelId) throw new Error('labelId is required for sweep actions')
                const sweepResult = await provider.sweepLabel(userId, projectId, labelId, action)
                console.log(
                    `[emailLine] sweep ${action} project=${projectId} label=${labelId} ` +
                        `processed=${sweepResult?.processed ?? 0} remaining=${!!sweepResult?.remaining}`
                )
                return sweepResult
            }
            case 'draftReply':
                return await draftReply({
                    userId,
                    projectId,
                    connection,
                    userData,
                    messageId: Array.isArray(messageIds) ? messageIds[0] : messageIds,
                    guidance,
                    sourceProjectId,
                    sourceTaskId,
                })
            case 'createTask':
                return await createTaskFromEmail({
                    userId,
                    projectId,
                    connection,
                    userData,
                    messageId: Array.isArray(messageIds) ? messageIds[0] : messageIds,
                    messageIds,
                    labelName,
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
