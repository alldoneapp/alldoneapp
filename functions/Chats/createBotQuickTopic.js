'use strict'

const { buildObjectAccessProjection } = require('../shared/objectAccessProjection')

const PUBLIC_FOR_ALL = 0
const MAX_TITLE_PREFIX_LENGTH = 500

class BotQuickTopicError extends Error {
    constructor(code, message) {
        super(message)
        this.name = 'BotQuickTopicError'
        this.code = code
    }
}

const isValidDocumentId = value =>
    typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/')

function validateQuickTopicRequest({ actorId, projectId, chatId, assistantId, quickDateId, titlePrefix }) {
    if (![actorId, projectId, chatId, assistantId].every(isValidDocumentId)) {
        throw new BotQuickTopicError('invalid-argument', 'Project, chat, assistant and actor ids are required')
    }
    if (typeof quickDateId !== 'string' || !/^\d{8}$/.test(quickDateId)) {
        throw new BotQuickTopicError('invalid-argument', 'A YYYYMMDD quick-topic date is required')
    }
    if (typeof titlePrefix !== 'string' || !titlePrefix.trim() || titlePrefix.trim().length > MAX_TITLE_PREFIX_LENGTH) {
        throw new BotQuickTopicError('invalid-argument', 'A valid quick-topic title is required')
    }
}

async function createBotQuickTopic({
    db,
    actorId,
    projectId,
    chatId,
    assistantId,
    quickDateId,
    titlePrefix,
    isAssistantEnabled,
    now = Date.now(),
}) {
    validateQuickTopicRequest({ actorId, projectId, chatId, assistantId, quickDateId, titlePrefix })

    const projectRef = db.doc(`projects/${projectId}`)
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${chatId}`)
    const [projectDoc, existingChat] = await Promise.all([projectRef.get(), chatRef.get()])
    const projectUserIds =
        projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []

    if (!projectUserIds.includes(actorId)) {
        throw new BotQuickTopicError('permission-denied', 'No access to project')
    }
    if (existingChat.exists) {
        const existingData = existingChat.data() || {}
        if (existingData.creatorId !== actorId || existingData.type !== 'topics') {
            throw new BotQuickTopicError('already-exists', 'The chat id is already in use')
        }
        return {
            projectId,
            chatId,
            assistantId: existingData.assistantId || assistantId,
            isPublicFor: existingData.isPublicFor || [PUBLIC_FOR_ALL],
            title: existingData.title,
        }
    }

    const countSnapshot = await db
        .collection(`chatObjects/${projectId}/chats`)
        .where('quickDateId', '==', quickDateId)
        .count()
        .get()
    const count = countSnapshot.data()?.count
    const quickTopicNumber = Number.isSafeInteger(count) && count >= 0 ? count + 1 : 1
    const title = `${titlePrefix.trim()} ${quickTopicNumber}`
    const usersFollowing = [actorId]
    const baseChat = {
        id: chatId,
        title,
        type: 'topics',
        members: [actorId],
        lastEditionDate: now,
        lastEditorId: actorId,
        commentsData: null,
        hasStar: '#ffffff',
        creatorId: actorId,
        isPublicFor: [PUBLIC_FOR_ALL],
        created: now,
        usersFollowing,
        quickDateId,
        assistantId,
        stickyData: { days: 0, stickyEndDate: 0 },
        ...(isAssistantEnabled ? { isAssistantEnabled: true } : {}),
    }
    const chat = {
        ...baseChat,
        ...buildObjectAccessProjection(baseChat, projectUserIds, null, 'usersFollowing'),
    }

    const batch = db.batch()
    batch.create(chatRef, chat)
    batch.set(db.doc(`followers/${projectId}/topics/${chatId}`), { usersFollowing })
    batch.set(db.doc(`usersFollowing/${projectId}/entries/${actorId}`), { topics: { [chatId]: true } }, { merge: true })
    batch.update(projectRef, { lastChatActionDate: now })
    await batch.commit()

    return {
        projectId,
        chatId,
        assistantId,
        isPublicFor: [PUBLIC_FOR_ALL],
        title,
    }
}

module.exports = {
    BotQuickTopicError,
    createBotQuickTopic,
    validateQuickTopicRequest,
}
