'use strict'

const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT, getBaseUrl } = require('../Utils/HelperFunctionsCloud')

const COMMENT_MAX_LENGTH = 5000

function normalizeTaskComment(comment) {
    if (typeof comment !== 'string') throw new Error('Task comment must be a string')
    const normalizedComment = comment.trim()
    if (!normalizedComment) throw new Error('Task comment cannot be empty')
    if (normalizedComment.length > COMMENT_MAX_LENGTH) {
        throw new Error(`Task comment cannot exceed ${COMMENT_MAX_LENGTH} characters`)
    }
    return normalizedComment
}

function uniqueStrings(values) {
    return [...new Set((values || []).filter(value => typeof value === 'string' && value.trim()))]
}

class TaskCommentService {
    constructor({ database } = {}) {
        this.database = database || admin.firestore()
    }

    async addComment({ projectId, taskId, task = null, comment, actor, fromAssistant = false }) {
        if (!projectId || !taskId) throw new Error('Project ID and task ID are required to add a comment')

        const commentText = normalizeTaskComment(comment)
        const actorId = actor?.uid || actor?.id || actor?.creatorId
        if (!actorId) throw new Error('A valid comment author is required')

        const taskRef = this.database.doc(`items/${projectId}/tasks/${taskId}`)
        const chatRef = this.database.doc(`chatObjects/${projectId}/chats/${taskId}`)
        const followersRef = this.database.doc(`followers/${projectId}/tasks/${taskId}`)
        const commentId = getId()
        const commentRef = this.database.doc(`chatComments/${projectId}/tasks/${taskId}/comments/${commentId}`)
        const now = Date.now()
        let notificationData = null

        await this.database.runTransaction(async transaction => {
            const [taskSnapshot, chatSnapshot, followersSnapshot] = await Promise.all([
                transaction.get(taskRef),
                transaction.get(chatRef),
                transaction.get(followersRef),
            ])
            if (!taskSnapshot.exists) throw new Error(`Task not found: ${taskId}`)

            const taskData = taskSnapshot.data() || task || {}
            const chatData = chatSnapshot.exists ? chatSnapshot.data() || {} : {}
            const followersData = followersSnapshot.exists ? followersSnapshot.data() || {} : {}
            const existingFollowers = uniqueStrings([
                ...(followersData.usersFollowing || []),
                ...(chatData.usersFollowing || []),
                ...(chatData.followerIds || []),
            ])
            const followers = uniqueStrings([...existingFollowers, taskData.userId, actorId])
            const members = uniqueStrings([...(chatData.members || []), taskData.userId, actorId])
            const usersToNotify = followers.filter(userId => userId !== actorId)
            const isPublicFor = Array.isArray(taskData.isPublicFor)
                ? taskData.isPublicFor
                : [FEED_PUBLIC_FOR_ALL, taskData.userId].filter(Boolean)
            const visibleUsersToNotify = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                ? usersToNotify
                : usersToNotify.filter(userId => isPublicFor.includes(userId))

            const commentData = {
                creatorId: actorId,
                commentText,
                commentType: STAYWARD_COMMENT,
                lastChangeDate: admin.firestore.Timestamp.now(),
                created: now,
                originalContent: commentText,
                fromAssistant: !!fromAssistant,
            }

            transaction.set(commentRef, commentData)
            const taskCommentsData =
                taskData.commentsData && typeof taskData.commentsData === 'object' ? taskData.commentsData : {}
            transaction.update(taskRef, {
                commentsData: {
                    ...taskCommentsData,
                    lastCommentOwnerId: actorId,
                    lastComment: commentText.substring(0, 500),
                    lastCommentType: STAYWARD_COMMENT,
                    amount: (Number(taskCommentsData.amount) || 0) + 1,
                },
            })

            const nextChatData = {
                id: taskId,
                projectId,
                title: taskData.extendedName || taskData.name || 'Task',
                type: 'tasks',
                creatorId: chatData.creatorId || taskData.creatorId || taskData.userId || actorId,
                created: chatData.created || taskData.created || now,
                lastEditionDate: now,
                lastEditorId: actorId,
                isPublicFor,
                hasStar: chatData.hasStar || taskData.hasStar || '#ffffff',
                stickyData: chatData.stickyData || { days: 0, stickyEndDate: 0 },
                usersFollowing: followers,
                followerIds: followers,
                members,
                commentsData: {
                    ...(chatData.commentsData || {}),
                    lastCommentOwnerId: actorId,
                    lastComment: commentText.substring(0, 500),
                    lastCommentType: STAYWARD_COMMENT,
                    amount: (Number(chatData.commentsData?.amount) || 0) + 1,
                },
            }
            if (fromAssistant) {
                nextChatData.assistantId = actorId
                nextChatData.lastAssistantComment = now
            }

            transaction.set(chatRef, nextChatData, { merge: true })
            transaction.set(followersRef, { usersFollowing: followers }, { merge: true })
            notificationData = {
                task: taskData,
                followers: visibleUsersToNotify,
                actorId,
                actorName: actor.displayName || actor.name || 'Assistant',
                commentId,
                commentText,
            }
        })

        let notificationError = null
        try {
            await this.notifyFollowers({ projectId, taskId, ...notificationData, fromAssistant })
        } catch (error) {
            notificationError = error.message
            console.error('TaskCommentService: Comment saved but follower notification failed', {
                projectId,
                taskId,
                commentId,
                error: error.message,
            })
        }

        return {
            success: true,
            commentId,
            commentText,
            creatorId: actorId,
            fromAssistant: !!fromAssistant,
            notifiedFollowers: notificationData?.followers?.length || 0,
            notificationError,
        }
    }

    async notifyFollowers({
        projectId,
        taskId,
        task,
        followers = [],
        actorId,
        actorName,
        commentId,
        commentText,
        fromAssistant,
    }) {
        if (followers.length === 0) return

        const projectSnapshot = await this.database.doc(`projects/${projectId}`).get()
        const projectName = projectSnapshot.exists ? projectSnapshot.data()?.name || '' : ''
        const objectName = task.extendedName || task.name || 'Task'
        const messageTimestamp = Date.now()
        const batch = this.database.batch()

        followers.forEach(userId => {
            batch.set(this.database.doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
                chatId: taskId,
                chatType: 'tasks',
                followed: true,
                date: messageTimestamp,
                creatorId: actorId,
                creatorType: fromAssistant ? 'assistant' : 'user',
            })
        })

        batch.set(
            this.database.doc(`emailNotifications/${taskId}`),
            {
                userIds: followers,
                projectId,
                objectType: 'tasks',
                objectId: taskId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )

        batch.set(this.database.doc(`pushNotifications/${commentId}`), {
            userIds: followers,
            body: `${projectName}\n  ✔ ${objectName}\n ${actorName} commented: ${commentText}`,
            link: `${getBaseUrl()}/projects/${projectId}/tasks/${taskId}/chat`,
            messageTimestamp,
            type: 'Chat Notification',
            chatId: taskId,
            projectId,
            initiatorId: actorId,
        })

        await batch.commit()
    }
}

module.exports = {
    COMMENT_MAX_LENGTH,
    TaskCommentService,
    normalizeTaskComment,
}
