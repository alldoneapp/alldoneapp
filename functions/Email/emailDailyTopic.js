'use strict'

const admin = require('firebase-admin')
const moment = require('moment')
const { v4: uuidv4 } = require('uuid')

const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { addTimestampToContextContent } = require('../Assistant/contextTimestampHelper')
const { getUserData } = require('../Users/usersFirestore')
const { buildAttachmentSummaryForComment, buildDailyEmailTitle } = require('./emailChannelHelpers')

function getFirstName(displayName) {
    if (!displayName) return 'User'
    return String(displayName).trim().split(' ')[0] || 'User'
}

async function getOrCreateDailyEmailTopic(userId, projectId, assistantId) {
    const today = moment().format('YYYYMMDD')
    const chatId = `BotChatEmail${today}${userId}`
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)
    const chatDoc = await chatRef.get()

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

        if (Object.keys(patchData).length > 0) {
            await chatRef.update(patchData)
        }

        return { chatId, isNew: false }
    }

    const user = await getUserData(userId)
    const title = buildDailyEmailTitle(getFirstName(user?.displayName || 'User'), moment().format('DD MMM YYYY'))
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
    })

    return { chatId, isNew: true }
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
    const comment = {
        commentText: String(responseText || '').trim(),
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: assistantId,
        fromAssistant: true,
        source: 'email',
        emailReplyMetadata: {
            status: options.status || '',
            subject: options.subject || '',
            toEmail: options.toEmail || '',
            messageId: options.messageId || '',
        },
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

async function getConversationHistory(projectId, chatId, limit = 10, userTimezoneOffset = null) {
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
    getOrCreateDailyEmailTopic,
    storeEmailAssistantMessageInTopic,
    storeEmailUserMessageInTopic,
}
