'use strict'

const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

/**
 * Adds a normal, visible assistant-authored comment to a newly created task.
 *
 * This deliberately writes only to the task thread. Rejection learnings are derived later by
 * the weekly comment review, so this path must not update user memory directly.
 */
async function addAssistantTaskComment({ projectId, taskId, assistantId, comment }) {
    const commentText = normalizeText(comment)
    if (!projectId || !taskId || !assistantId || !commentText) return null

    const db = admin.firestore()
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${taskId}`)
    const taskDoc = await taskRef.get()
    if (!taskDoc.exists) return null

    const task = taskDoc.data() || {}
    const chatDoc = await chatRef.get()
    const chat = chatDoc.exists ? chatDoc.data() || {} : {}
    const commentId = getId()
    const now = Date.now()
    const commentsData = {
        lastCommentOwnerId: assistantId,
        lastComment: commentText.substring(0, 500),
        lastCommentType: STAYWARD_COMMENT,
        amount: (Number(task?.commentsData?.amount) || 0) + 1,
    }

    await db.doc(`chatComments/${projectId}/tasks/${taskId}/comments/${commentId}`).set({
        creatorId: assistantId,
        commentText,
        commentType: STAYWARD_COMMENT,
        lastChangeDate: Timestamp.now(),
        created: now,
        originalContent: commentText,
        fromAssistant: true,
    })

    await taskRef.update({ commentsData })

    const chatData = {
        commentsData: {
            ...commentsData,
            amount: (Number(chat?.commentsData?.amount) || 0) + 1,
        },
        lastEditionDate: now,
        lastEditorId: assistantId,
        assistantId,
        members: FieldValue.arrayUnion(assistantId),
    }

    if (chatDoc.exists) {
        await chatRef.update(chatData)
    } else {
        const taskOwnerId = task.userId || task.creatorId || ''
        const followingIds = [taskOwnerId, assistantId].filter(Boolean)
        await chatRef.set({
            id: taskId,
            title: task.extendedName || task.name || '',
            type: 'tasks',
            creatorId: task.creatorId || taskOwnerId,
            created: task.created || now,
            isPublicFor: task.isPublicFor || [0, taskOwnerId].filter(Boolean),
            usersFollowing: FieldValue.arrayUnion(...followingIds),
            followerIds: followingIds,
            hasStar: task.hasStar || '#ffffff',
            stickyData: { days: 0, stickyEndDate: 0 },
            ...chatData,
        })
    }

    return { commentId, commentText }
}

module.exports = { addAssistantTaskComment }
