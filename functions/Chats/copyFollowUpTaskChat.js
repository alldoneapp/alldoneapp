'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { withoutAccessProjection } = require('../shared/objectAccessProjection')
const { canAccessObject } = require('../shared/privacyAccess')

class FollowUpTaskChatError extends Error {
    constructor(code, message) {
        super(message)
        this.name = 'FollowUpTaskChatError'
        this.code = code
    }
}

const getCommentTimestamp = comment => {
    const value = comment?.lastChangeDate || comment?.created || 0
    if (typeof value === 'number') return value
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.seconds === 'number') return value.seconds * 1000 + (value.nanoseconds || 0) / 1000000
    return 0
}

const isGeneratedFollowUpComment = comment => {
    return String(comment?.commentText || '')
        .toLowerCase()
        .includes('follow up task created')
}

function buildCommentsData(comments) {
    if (comments.length === 0) return null

    const lastComment = comments.reduce((latest, comment) => {
        return getCommentTimestamp(comment) >= getCommentTimestamp(latest) ? comment : latest
    })

    return {
        lastComment: lastComment.commentText || '',
        lastCommentType: STAYWARD_COMMENT,
        amount: comments.length,
        lastCommentOwnerId: lastComment.creatorId || '',
    }
}

async function copyFollowUpTaskChat({
    adminRef,
    actorId,
    projectId,
    sourceTaskId,
    targetTaskId,
    batchFactory = database => new BatchWrapper(database),
}) {
    if (!actorId || !projectId || !sourceTaskId || !targetTaskId) {
        throw new FollowUpTaskChatError('invalid-argument', 'Project, source task and target task are required')
    }
    if (sourceTaskId === targetTaskId) {
        throw new FollowUpTaskChatError('invalid-argument', 'Source and target task must be different')
    }

    const database = adminRef.firestore()
    const sourceTaskRef = database.doc(`items/${projectId}/tasks/${sourceTaskId}`)
    const targetTaskRef = database.doc(`items/${projectId}/tasks/${targetTaskId}`)
    const sourceChatRef = database.doc(`chatObjects/${projectId}/chats/${sourceTaskId}`)
    const [sourceTaskDoc, targetTaskDoc, sourceChatDoc] = await Promise.all([
        sourceTaskRef.get(),
        targetTaskRef.get(),
        sourceChatRef.get(),
    ])

    if (!sourceTaskDoc.exists || !targetTaskDoc.exists) {
        throw new FollowUpTaskChatError('not-found', 'Source or target task does not exist')
    }

    const sourceTask = sourceTaskDoc.data() || {}
    const targetTask = targetTaskDoc.data() || {}
    if (!canAccessObject(sourceTask, actorId) || !canAccessObject(targetTask, actorId)) {
        throw new FollowUpTaskChatError('permission-denied', 'No access to the source or target task')
    }
    if (targetTask.creatorId !== actorId || targetTask.followUpSourceTaskId !== sourceTaskId) {
        throw new FollowUpTaskChatError('permission-denied', "Target task is not this user's follow-up task")
    }

    if (!sourceChatDoc.exists) return { copied: false, reason: 'no-chat', commentCount: 0 }

    const sourceChat = sourceChatDoc.data() || {}
    if (!canAccessObject(sourceChat, actorId)) {
        throw new FollowUpTaskChatError('permission-denied', 'No access to the source conversation')
    }

    const commentDocs = await database.collection(`chatComments/${projectId}/tasks/${sourceTaskId}/comments`).get()
    const comments = commentDocs.docs
        .map(doc => ({ id: doc.id, data: doc.data() || {} }))
        .filter(comment => !isGeneratedFollowUpComment(comment.data))
    const commentsData = buildCommentsData(comments.map(comment => comment.data))
    const targetChatRef = database.doc(`chatObjects/${projectId}/chats/${targetTaskId}`)
    const batch = batchFactory(database)

    comments.forEach(comment => {
        batch.set(database.doc(`chatComments/${projectId}/tasks/${targetTaskId}/comments/${comment.id}`), comment.data)
    })
    batch.set(
        targetChatRef,
        withoutAccessProjection({
            ...sourceChat,
            id: targetTaskId,
            title: targetTask.extendedName || targetTask.name || sourceChat.title || '',
            creatorId: targetTask.creatorId,
            isPublicFor: targetTask.isPublicFor,
            commentsData,
        })
    )
    batch.update(targetTaskRef, { commentsData })
    await batch.commit()

    return { copied: true, commentCount: comments.length }
}

module.exports = {
    FollowUpTaskChatError,
    buildCommentsData,
    copyFollowUpTaskChat,
    isGeneratedFollowUpComment,
}
