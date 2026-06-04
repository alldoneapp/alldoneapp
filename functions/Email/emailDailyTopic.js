'use strict'

const admin = require('firebase-admin')
const moment = require('moment')
const { v4: uuidv4 } = require('uuid')

const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { addTimestampToContextContent } = require('../Assistant/contextTimestampHelper')
const { THREAD_CONTEXT_MESSAGE_LIMIT } = require('../Assistant/contextLimits')
const { getUserData } = require('../Users/usersFirestore')
const {
    buildAttachmentSummaryForComment,
    buildDailyEmailParticipantEmails,
    buildDailyEmailParticipantKey,
    buildDailyEmailTitle,
    buildParticipantScopedDailyEmailTitle,
    getEmailParticipantDisplayName,
    normalizeEmailAddress,
    normalizeSafeEmailActionContext,
} = require('./emailChannelHelpers')

const EMAIL_PARTICIPANT_SCOPE_VERSION = 1

function getFirstName(displayName) {
    if (!displayName) return 'User'
    return String(displayName).trim().split(' ')[0] || 'User'
}

async function getOrCreateDailyEmailTopic(userId, projectId, assistantId, options = {}) {
    const today = moment().format('YYYYMMDD')
    const participantEmails = buildDailyEmailParticipantEmails(options.participantEmails || [])
    const participantKey = buildDailyEmailParticipantKey(participantEmails)
    const scopeType = participantEmails.length > 1 ? 'Group' : 'Direct'
    const chatId = `BotChatEmail${today}${userId}${scopeType}${participantKey}`
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)
    const chatDoc = await chatRef.get()
    const participantScopeData = {
        emailParticipantScopeVersion: EMAIL_PARTICIPANT_SCOPE_VERSION,
        emailParticipantKey: participantKey,
        emailParticipantEmails: participantEmails,
        isEmailParticipantScoped: true,
    }

    if (chatDoc.exists) {
        const data = chatDoc.data() || {}
        const patchData = {}

        if (!data.stickyData || data.stickyData.days === undefined) {
            patchData.stickyData = { days: 0, stickyEndDate: 0 }
            patchData.hasStar = data.hasStar || '#ffffff'
        }

        if (data.isAssistantEnabled !== true) {
            patchData.isAssistantEnabled = true
        }

        if (
            data.emailParticipantScopeVersion !== EMAIL_PARTICIPANT_SCOPE_VERSION ||
            data.emailParticipantKey !== participantKey
        ) {
            Object.assign(patchData, participantScopeData)
        }

        if (Object.keys(patchData).length > 0) {
            await chatRef.update(patchData)
        }

        return {
            chatId,
            isNew: false,
            isParticipantScopedTopic: true,
            participantEmails,
            participantKey,
        }
    }

    const user = await getUserData(userId)
    const ownerFirstName = getFirstName(user?.displayName || 'User')
    const ownerEmail = normalizeEmailAddress(options.ownerEmail || participantEmails[0] || user?.email || '')
    const dateLabel = moment().format('DD MMM YYYY')
    const title =
        participantEmails.length > 1
            ? buildParticipantScopedDailyEmailTitle({
                  ownerFirstName,
                  ownerEmail,
                  participantEmails,
                  dateLabel,
              })
            : buildDailyEmailTitle(ownerFirstName, dateLabel)
    const otherParticipantNames = participantEmails
        .filter(email => email !== ownerEmail)
        .map(getEmailParticipantDisplayName)
        .filter(Boolean)
        .sort((first, second) => first.localeCompare(second))
    const now = Date.now()

    await chatRef.set({
        id: chatId,
        title,
        type: 'topics',
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
        assistantId: assistantId || null,
        creatorId: userId,
        created: now,
        lastEditionDate: now,
        lastEditorId: userId,
        usersFollowing: [userId],
        members: [userId],
        hasStar: '#ffffff',
        stickyData: { days: 0, stickyEndDate: 0 },
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentOwnerId: '',
            lastCommentType: '',
        },
        isAssistantEnabled: true,
        ...participantScopeData,
        emailParticipantNames: [ownerFirstName, ...otherParticipantNames, 'Anna'],
        emailOwnerEmail: ownerEmail,
    })

    return {
        chatId,
        isNew: true,
        isParticipantScopedTopic: true,
        participantEmails,
        participantKey,
    }
}

async function storeEmailUserMessageInTopic(projectId, chatId, userId, messageText, options = {}) {
    const commentId = uuidv4()
    const now = Date.now()
    const attachments = Array.isArray(options.attachments) ? options.attachments : []
    const attachmentSummary = buildAttachmentSummaryForComment(attachments)
    const finalText = [String(messageText || '').trim(), attachmentSummary].filter(Boolean).join('\n\n')

    const comment = {
        commentText: finalText,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: userId,
        fromAssistant: false,
        source: 'email',
        emailMetadata: {
            fromEmail: options.fromEmail || '',
            toEmails: Array.isArray(options.toEmails) ? options.toEmails : [],
            ccEmails: Array.isArray(options.ccEmails) ? options.ccEmails : [],
            subject: options.subject || '',
            messageId: options.messageId || '',
            replyTo: options.replyTo || '',
            inReplyTo: options.inReplyTo || '',
            references: options.references || '',
            attachmentCount: attachments.length,
            replyStatus: options.replyStatus || '',
        },
    }

    if (attachments.length > 0) {
        comment.emailAttachments = attachments
    }

    await storeTopicComment(projectId, chatId, commentId, comment, userId, finalText)
    return commentId
}

async function storeEmailAssistantMessageInTopic(projectId, chatId, assistantId, responseText, userId, options = {}) {
    const commentId = uuidv4()
    const now = Date.now()
    const safeActionContext = normalizeSafeEmailActionContext(options.safeActionContext)
    const emailReplyMetadata = {
        status: options.status || '',
        subject: options.subject || '',
        toEmail: options.toEmail || '',
        messageId: options.messageId || '',
    }
    if (safeActionContext) emailReplyMetadata.safeActionContext = safeActionContext

    const comment = {
        commentText: String(responseText || '').trim(),
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: assistantId,
        fromAssistant: true,
        source: 'email',
        emailReplyMetadata,
    }

    await storeTopicComment(projectId, chatId, commentId, comment, assistantId, responseText)
    await updateLastAssistantCommentData(projectId, chatId, assistantId, userId, now)
    return commentId
}

async function storeTopicComment(projectId, chatId, commentId, comment, actorId, commentText) {
    const commentRef = admin.firestore().doc(`chatComments/${projectId}/topics/${chatId}/comments/${commentId}`)
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)

    await Promise.all([
        commentRef.set(comment),
        chatRef.update({
            lastEditionDate: comment.created,
            lastEditorId: actorId,
            'commentsData.lastComment': String(commentText || '').substring(0, 200),
            'commentsData.lastCommentOwnerId': actorId,
            'commentsData.lastCommentType': STAYWARD_COMMENT,
            'commentsData.amount': admin.firestore.FieldValue.increment(1),
        }),
    ])
}

async function updateLastAssistantCommentData(projectId, chatId, assistantId, userId, now) {
    if (!userId) return

    const updateData = {
        objectType: 'topics',
        objectId: chatId,
        creatorId: assistantId,
        creatorType: 'user',
        date: now,
    }

    await admin
        .firestore()
        .doc(`users/${userId}`)
        .update({
            [`lastAssistantCommentData.${projectId}`]: updateData,
            ['lastAssistantCommentData.allProjects']: {
                ...updateData,
                projectId,
            },
        })
}

async function getConversationHistory(
    projectId,
    chatId,
    limit = THREAD_CONTEXT_MESSAGE_LIMIT,
    userTimezoneOffset = null
) {
    const snapshot = await admin
        .firestore()
        .collection(`chatComments/${projectId}/topics/${chatId}/comments`)
        .orderBy('created', 'desc')
        .limit(limit)
        .get()

    const messages = []
    snapshot.docs.reverse().forEach(doc => {
        const data = doc.data() || {}
        const messageTimestamp = Number(data.created || data.lastChangeDate || 0)
        if (!data.commentText) return

        if (data.fromAssistant) {
            messages.push([
                'assistant',
                addTimestampToContextContent(data.commentText, messageTimestamp, userTimezoneOffset),
            ])
            return
        }

        const fileContext = buildFileContextForAssistant(data.emailAttachments)
        const text = fileContext ? `${data.commentText}\n\n${fileContext}` : data.commentText
        messages.push(['user', addTimestampToContextContent(text, messageTimestamp, userTimezoneOffset)])
    })

    return messages
}

async function getLatestSafeEmailActionContext(projectId, chatId, senderEmail = '') {
    const snapshot = await admin
        .firestore()
        .collection(`chatComments/${projectId}/topics/${chatId}/comments`)
        .orderBy('created', 'desc')
        .limit(5)
        .get()
    const latestAssistantComment = snapshot.docs.map(doc => doc.data() || {}).find(data => data.fromAssistant)
    if (!latestAssistantComment) return null

    const normalizedSenderEmail = normalizeEmailAddress(senderEmail)
    const replyToEmail = normalizeEmailAddress(latestAssistantComment.emailReplyMetadata?.toEmail || '')
    if (normalizedSenderEmail && replyToEmail !== normalizedSenderEmail) return null

    return normalizeSafeEmailActionContext(latestAssistantComment.emailReplyMetadata?.safeActionContext)
}

function buildFileContextForAssistant(emailAttachments = []) {
    if (!Array.isArray(emailAttachments) || emailAttachments.length === 0) return ''

    const parts = emailAttachments
        .map(attachment => {
            const extractedText = String(attachment.extractedText || '').trim()
            if (!extractedText) return ''
            const fileName = attachment.fileName || 'attachment'
            const contentType = attachment.contentType || 'unknown'
            return `[FILE: ${fileName}, type=${contentType}]\n${extractedText}`
        })
        .filter(Boolean)

    return parts.join('\n\n')
}

module.exports = {
    getConversationHistory,
    getLatestSafeEmailActionContext,
    getOrCreateDailyEmailTopic,
    storeEmailAssistantMessageInTopic,
    storeEmailUserMessageInTopic,
}
