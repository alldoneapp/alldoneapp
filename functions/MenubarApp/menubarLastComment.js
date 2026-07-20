'use strict'

const { cleanTextMetaData, removeFormatTagsFromText } = require('../Utils/parseTextUtils')
const { resolveMenubarRichTextLinks } = require('./menubarRichText')

const ALL_PROJECTS_KEY = 'allProjects'
const SUPPORTED_OBJECT_TYPES = new Set([
    'topics',
    'tasks',
    'notes',
    'goals',
    'skills',
    'users',
    'contacts',
    'assistants',
])

function toMillis(value) {
    if (value === null || value === undefined) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    if (Number.isFinite(value?.seconds)) {
        return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000)
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function isPreferredChatNotification(notification, currentNotification) {
    if (!notification) return false
    if (!currentNotification) return true

    const priorityDifference = Number(!!notification.followed) - Number(!!currentNotification.followed)
    if (priorityDifference !== 0) return priorityDifference > 0
    return toMillis(notification.date) > toMillis(currentNotification.date)
}

function selectPreferredChatNotification(notifications = []) {
    return notifications.reduce(
        (preferred, notification) => (isPreferredChatNotification(notification, preferred) ? notification : preferred),
        null
    )
}

function selectLastCommentSource(userData = {}, notifications = [], activeProjectIds = []) {
    const unreadNotification = selectPreferredChatNotification(notifications)
    if (unreadNotification) return { ...unreadNotification, fromNotification: true }

    const fallback = userData.lastAssistantCommentData?.[ALL_PROJECTS_KEY]
    if (!fallback || !activeProjectIds.includes(fallback.projectId)) return null
    return { ...fallback, fromNotification: false }
}

function buildLastCommentUrl(appBaseUrl, projectId, objectType, objectId) {
    const base = String(appBaseUrl || '').replace(/\/$/, '')
    if (!base || !projectId || !objectId || !SUPPORTED_OBJECT_TYPES.has(objectType)) return null
    const area = objectType === 'topics' ? 'chats' : objectType === 'users' ? 'contacts' : objectType
    return `${base}/projects/${encodeURIComponent(projectId)}/${area}/${encodeURIComponent(objectId)}/chat`
}

async function getProjectNotifications(db, projectId, userId) {
    const snapshot = await db.collection(`chatNotifications/${projectId}/${userId}`).get()
    return snapshot.docs.map(doc => ({ ...doc.data(), commentId: doc.id, projectId }))
}

async function resolveAuthorName(db, projectId, creatorId, creatorType, userId, userData) {
    if (!creatorId) return creatorType === 'assistant' ? 'Assistant' : 'User'
    if (creatorId === userId) return userData.displayName || userData.name || 'You'

    if (creatorType === 'assistant') {
        const projectAssistant = await db.doc(`assistants/${projectId}/items/${creatorId}`).get()
        if (projectAssistant.exists) {
            const data = projectAssistant.data() || {}
            return data.displayName || data.name || 'Assistant'
        }
        const globalAssistant = await db.doc(`assistants/globalProject/items/${creatorId}`).get()
        if (globalAssistant.exists) {
            const data = globalAssistant.data() || {}
            return data.displayName || data.name || 'Assistant'
        }
        return 'Assistant'
    }

    const creator = await db.doc(`users/${creatorId}`).get()
    if (!creator.exists) return 'User'
    const data = creator.data() || {}
    return data.displayName || data.name || data.email || 'User'
}

function isPendingComment(comment = {}) {
    const status = comment.assistantRun?.status
    return (
        comment.isLoading === true ||
        comment.isThinking === true ||
        comment.isPartial === true ||
        status === 'running' ||
        status === 'cancel_requested'
    )
}

function isChatVisibleToUser(chat = {}, userId) {
    const isPublicFor = Array.isArray(chat.isPublicFor) ? chat.isPublicFor : null
    return !isPublicFor || isPublicFor.includes(0) || isPublicFor.includes(userId)
}

async function getMenubarLastComment(
    db,
    userId,
    userData = {},
    activeProjectIds = [],
    appBaseUrl = '',
    knownNotifications = null
) {
    const notifications = Array.isArray(knownNotifications) ? knownNotifications : []
    if (!Array.isArray(knownNotifications)) {
        const batchSize = 8
        for (let index = 0; index < activeProjectIds.length; index += batchSize) {
            const batch = await Promise.all(
                activeProjectIds
                    .slice(index, index + batchSize)
                    .map(projectId => getProjectNotifications(db, projectId, userId))
            )
            batch.forEach(projectNotifications => notifications.push(...projectNotifications))
        }
    }

    const source = selectLastCommentSource(userData, notifications, activeProjectIds)
    if (!source) return null

    const projectId = typeof source.projectId === 'string' ? source.projectId : ''
    const objectId = typeof (source.chatId || source.objectId) === 'string' ? source.chatId || source.objectId : ''
    const objectType =
        typeof (source.chatType || source.objectType) === 'string' ? source.chatType || source.objectType : ''
    if (!activeProjectIds.includes(projectId) || !objectId || !SUPPORTED_OBJECT_TYPES.has(objectType)) return null

    const [projectDoc, chatDoc, commentsSnapshot] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.doc(`chatObjects/${projectId}/chats/${objectId}`).get(),
        db
            .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
            .orderBy('created', 'desc')
            .limit(1)
            .get(),
    ])
    if (!projectDoc.exists || !chatDoc.exists || commentsSnapshot.empty) return null

    const project = projectDoc.data() || {}
    if (!Array.isArray(project.userIds) || !project.userIds.includes(userId)) return null
    const chat = chatDoc.data() || {}
    if (!isChatVisibleToUser(chat, userId)) return null

    const commentDoc = commentsSnapshot.docs[0]
    const comment = commentDoc.data() || {}
    const creatorId = comment.creatorId || source.creatorId || ''
    const creatorType =
        comment.fromAssistant === true || (source.creatorId === creatorId && source.creatorType === 'assistant')
            ? 'assistant'
            : 'user'
    const authorName = await resolveAuthorName(db, projectId, creatorId, creatorType, userId, userData)
    const rawText = typeof comment.commentText === 'string' ? comment.commentText : ''
    const text = cleanTextMetaData(removeFormatTagsFromText(rawText), false).trim()
    const links = await resolveMenubarRichTextLinks(db, rawText, userId, appBaseUrl)
    const followed = source.fromNotification === true && source.followed === true
    const unreadCount = source.fromNotification
        ? new Set(
              notifications
                  .filter(
                      notification =>
                          notification.projectId === projectId &&
                          notification.chatId === objectId &&
                          !!notification.followed === followed
                  )
                  .map(notification => notification.commentId)
                  .filter(Boolean)
          ).size
        : 0

    return {
        projectId,
        projectName: project.name || '',
        objectId,
        objectType,
        objectName: chat.title || '',
        authorName,
        text: text || (isPendingComment(comment) ? '' : 'Comment'),
        richText: rawText,
        links,
        createdAt: toMillis(comment.created || comment.lastChangeDate || source.date),
        pending: isPendingComment(comment),
        unreadCount,
        followed,
        url: buildLastCommentUrl(appBaseUrl, projectId, objectType, objectId),
    }
}

module.exports = {
    getMenubarLastComment,
    __private__: {
        buildLastCommentUrl,
        isChatVisibleToUser,
        isPreferredChatNotification,
        selectLastCommentSource,
        selectPreferredChatNotification,
        toMillis,
    },
}
