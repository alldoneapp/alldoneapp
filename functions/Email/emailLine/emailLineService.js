'use strict'

const admin = require('firebase-admin')
const { resolveEmailConnection } = require('../../Integrations/providerConnections')
const gmailEmailLine = require('./gmailEmailLine')
const microsoftEmailLine = require('./microsoftEmailLine')
const { EmailLineAuthError, isAuthError } = require('./emailLineErrors')
const { composeReply, REPLY_MODEL_KEY } = require('./replyComposer')
const { detectNeedsReply, NEEDS_REPLY_MODEL_KEY } = require('./needsReplyDetector')

const GOLD_SOURCE_DRAFT_REPLY = 'email_draft_reply'
const GOLD_SOURCE_NEEDS_REPLY = 'email_needs_reply'
const NEEDS_REPLY_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes
const NEEDS_REPLY_SCAN_LIMIT = 15
const SCANNED_IDS_CAP = 300

function emailLineStateRef(userId, projectId) {
    return admin.firestore().doc(`users/${userId}/emailLineState/${projectId}`)
}

function getProviderModule(provider) {
    return provider === 'microsoft' ? microsoftEmailLine : gmailEmailLine
}

async function loadUserData(userId, providedUserData) {
    if (providedUserData) return providedUserData
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    return userDoc.exists ? userDoc.data() || {} : {}
}

function resolveProvider(userData, projectId) {
    const connection = userData?.apisConnected?.[projectId] || {}
    return resolveEmailConnection(connection)
}

// On-demand needs-reply scan, piggybacked on the summary. Cooldown + per-message
// idempotency prevent re-charging; insufficient Gold skips the scan silently.
// Never throws — a scan failure must not break the summary.
async function runNeedsReplyScan(userId, projectId, connection) {
    try {
        const stateRef = emailLineStateRef(userId, projectId)
        const stateSnap = await stateRef.get()
        const state = stateSnap.exists ? stateSnap.data() || {} : {}
        const now = Date.now()
        const cachedFlags = state.needsReplyByMessageId || {}
        const scannedIds = Array.isArray(state.scannedMessageIds) ? state.scannedMessageIds : []

        if (state.lastNeedsReplyScanAt && now - state.lastNeedsReplyScanAt < NEEDS_REPLY_COOLDOWN_MS) {
            return { needsReplyByMessageId: cachedFlags, scannedAt: state.lastNeedsReplyScanAt }
        }

        const provider = getProviderModule(connection.provider)
        const messages = await provider.getUnreadInboxMessages(userId, projectId, NEEDS_REPLY_SCAN_LIMIT)
        const currentIds = new Set(messages.map(message => message.messageId))
        const scannedSet = new Set(scannedIds)
        const toScan = messages.filter(message => !scannedSet.has(message.messageId))

        // Carry forward previous flags only for messages still unread.
        const mergedFlags = {}
        Object.keys(cachedFlags).forEach(id => {
            if (currentIds.has(id)) mergedFlags[id] = true
        })

        if (toScan.length === 0) {
            await stateRef.set({ needsReplyByMessageId: mergedFlags, lastNeedsReplyScanAt: now }, { merge: true })
            return { needsReplyByMessageId: mergedFlags, scannedAt: now }
        }

        const { flagsByMessageId, totalTokens } = await detectNeedsReply(toScan)

        const { deductGold } = require('../../Gold/goldHelper')
        const { calculateGoldCostFromTokens } = require('../../Assistant/assistantHelper')
        const goldCost = calculateGoldCostFromTokens(totalTokens, NEEDS_REPLY_MODEL_KEY)
        if (goldCost > 0) {
            const goldResult = await deductGold(userId, goldCost, {
                source: GOLD_SOURCE_NEEDS_REPLY,
                projectId,
                channel: connection.provider,
            })
            if (!goldResult.success) {
                // Don't persist the scan (so it retries later); return what we have.
                return {
                    needsReplyByMessageId: mergedFlags,
                    scannedAt: state.lastNeedsReplyScanAt || now,
                    skipped: 'no_gold',
                }
            }
        }

        Object.keys(flagsByMessageId).forEach(id => {
            if (flagsByMessageId[id]) mergedFlags[id] = true
        })

        const updatedScanned = [...scannedIds, ...toScan.map(message => message.messageId)].slice(-SCANNED_IDS_CAP)
        await stateRef.set(
            {
                needsReplyByMessageId: mergedFlags,
                scannedMessageIds: updatedScanned,
                lastNeedsReplyScanAt: now,
            },
            { merge: true }
        )
        return { needsReplyByMessageId: mergedFlags, scannedAt: now }
    } catch (error) {
        console.warn('[emailLine] needs-reply scan failed:', error?.message || error)
        return { needsReplyByMessageId: {}, scannedAt: Date.now(), skipped: 'error' }
    }
}

async function readNeedsReplyFlags(userId, projectId) {
    try {
        const stateSnap = await emailLineStateRef(userId, projectId).get()
        return stateSnap.exists ? stateSnap.data()?.needsReplyByMessageId || {} : {}
    } catch (error) {
        return {}
    }
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
    const inboxZero = labels.every(label => label.unreadCount === 0)

    let needsReply = { needsReplyByMessageId: {} }
    if (includeNeedsReply) {
        needsReply = await runNeedsReplyScan(userId, projectId, connection)
    }
    const needsReplyByMessageId = needsReply.needsReplyByMessageId || {}

    return {
        provider: connection.provider,
        emailAddress: summary.emailAddress || connection.emailAddress || '',
        labels,
        needsReplyCount: Object.keys(needsReplyByMessageId).length,
        needsReplyByMessageId,
        needsReplyScanSkipped: needsReply.skipped || null,
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

// Returns { messages, nextPageToken }
async function listEmailLineMessages(userId, projectId, labelId, options = {}) {
    const { pageToken, userData: providedUserData } = options
    const { connection } = await resolveConnectionOrThrow(userId, projectId, providedUserData)
    const provider = getProviderModule(connection.provider)
    try {
        const [result, needsReplyFlags] = await Promise.all([
            provider.listMessagesForLabel(userId, projectId, labelId, {
                pageToken,
                emailAddress: connection.emailAddress,
            }),
            readNeedsReplyFlags(userId, projectId),
        ])
        const messages = (result?.messages || []).map(message => ({
            ...message,
            needsReply: !!needsReplyFlags[message.messageId],
        }))
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
        projectId,
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

// Handles archive / markRead / archiveAll / markAllRead / draftReply.
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
    getProviderModule,
    GOLD_SOURCE_DRAFT_REPLY,
}
