'use strict'

const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT, getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { Timestamp } = require('firebase-admin/firestore')
const { getEmailIdentity, matchesEmailThread } = require('../Email/emailThreadIdentity')
const { canAccessObject } = require('./privacyAccess')
const { buildEmailTaskUpdate } = require('../Email/emailTaskContentUpdate')
const { resolveEmailThreadTask } = require('../Email/emailThreadTaskStore')

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

    async addComment({
        projectId,
        taskId,
        task = null,
        comment,
        actor,
        fromAssistant = false,
        silent = false,
        commentId: suppliedCommentId = null,
        gmailData = null,
        linkEmail = false,
        emailContinuation = null,
    }) {
        if (!projectId || !taskId) throw new Error('Project ID and task ID are required to add a comment')
        if (emailContinuation && !gmailData) throw new Error('Email continuation requires email metadata')

        const commentText = normalizeTaskComment(comment)
        const actorId = actor?.uid || actor?.id || actor?.creatorId
        if (!actorId) throw new Error('A valid comment author is required')

        const taskRef = this.database.doc(`items/${projectId}/tasks/${taskId}`)
        const chatRef = this.database.doc(`chatObjects/${projectId}/chats/${taskId}`)
        const followersRef = this.database.doc(`followers/${projectId}/tasks/${taskId}`)
        const commentId = suppliedCommentId || getId()
        const commentRef = this.database.doc(`chatComments/${projectId}/tasks/${taskId}/comments/${commentId}`)
        const now = Date.now()
        let notificationData = null
        let existing = false
        let updatedTaskName = null

        await this.database.runTransaction(async transaction => {
            notificationData = null
            existing = false
            const [taskSnapshot, chatSnapshot, followersSnapshot, commentSnapshot] = await Promise.all([
                transaction.get(taskRef),
                transaction.get(chatRef),
                transaction.get(followersRef),
                suppliedCommentId ? transaction.get(commentRef) : Promise.resolve(null),
            ])
            if (!taskSnapshot.exists) throw new Error(`Task not found: ${taskId}`)
            updatedTaskName = taskSnapshot.data()?.name || null
            if (commentSnapshot?.exists) {
                existing = true
                return
            }

            const taskData = taskSnapshot.data() || task || {}
            if (gmailData) {
                const identity = getEmailIdentity(gmailData.accountUserId, gmailData)
                if (!identity || !matchesEmailThread(taskData.gmailData, identity)) {
                    throw new Error('Email comment does not match the task account and thread')
                }
                if (emailContinuation) {
                    if (!canAccessObject(taskData, identity.ownerId))
                        throw new Error('Email task is no longer readable')
                    const selected = await resolveEmailThreadTask({
                        database: this.database,
                        identity,
                        projectIds: emailContinuation.projectIds,
                        transaction,
                    })
                    if (selected?.taskId !== taskId || selected?.projectId !== projectId) {
                        throw new Error('Email thread selection changed; retry processing')
                    }
                    if (
                        [taskData.gmailData.messageId, ...(taskData.gmailData.messageIds || [])].includes(
                            identity.messageId
                        )
                    ) {
                        existing = true
                        return
                    }
                }
            }
            const contentUpdate = emailContinuation
                ? buildEmailTaskUpdate(taskData, emailContinuation.plan, gmailData, actorId, now)
                : {}
            updatedTaskName = contentUpdate.name || taskData.name || null
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
                lastChangeDate: Timestamp.now(),
                created: now,
                originalContent: commentText,
                fromAssistant: !!fromAssistant,
                ...(gmailData ? { gmailData } : {}),
            }

            transaction.set(commentRef, commentData)
            if (emailContinuation) {
                const identity = getEmailIdentity(gmailData.accountUserId, gmailData)
                transaction.set(
                    this.database.doc(`users/${identity.ownerId}/emailThreadTasks/message_${identity.messageKey}`),
                    {
                        projectId,
                        taskId,
                    }
                )
            }
            const taskCommentsData =
                taskData.commentsData && typeof taskData.commentsData === 'object' ? taskData.commentsData : {}
            transaction.update(taskRef, {
                ...contentUpdate,
                ...(linkEmail && gmailData?.messageId
                    ? {
                          gmailData: {
                              ...(taskData.gmailData || {}),
                              ...(contentUpdate.gmailData || {}),
                              messageIds: uniqueStrings([
                                  ...(taskData.gmailData?.messageIds || []),
                                  taskData.gmailData?.messageId,
                                  gmailData.messageId,
                              ]),
                              archiveStatus: null,
                          },
                      }
                    : {}),
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
                title: contentUpdate.extendedName || taskData.extendedName || taskData.name || 'Task',
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

        // A silent comment still writes the comment + task/chat metadata above, so it shows
        // up as a normal entry in the task's feed/chat history. It only skips notifyFollowers,
        // which is the sole source of the chatNotifications unread markers (plus push/email).
        // This keeps assistant-authored update_task comments from marking threads as unread.
        let notificationError = null
        if (!silent && !existing) {
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
        }

        return {
            success: true,
            commentId,
            commentText,
            creatorId: actorId,
            fromAssistant: !!fromAssistant,
            silent: !!silent,
            notifiedFollowers: silent ? 0 : notificationData?.followers?.length || 0,
            notificationError,
            ...(suppliedCommentId ? { existing } : {}),
            ...(emailContinuation ? { taskName: updatedTaskName } : {}),
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
