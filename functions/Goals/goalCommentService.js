'use strict'

/**
 * Writes a comment into a goal's thread from the server (update_goal's `comment`, assistants and MCP
 * clients). The goal counterpart of shared/TaskCommentService.js, with the same shape on purpose:
 * the comment, the goal's `commentsData`, the chat object and the followers document are written in
 * one transaction, and the notifications (unread marker, email digest, push) follow it.
 *
 * Two rules come from the task version and matter just as much here. An MCP client's comment is
 * news to the user too, so the actor is notified as well (shared/mcpActor.js). And a comment an
 * assistant writes as part of an update is `silent`: it is in the thread, but marks nothing unread;
 * update_goal decides that exactly as update_task does.
 */

const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT, getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { MCP_CHANNEL, formatActorDisplayName, getActorChannelFields, isMcpActor } = require('../shared/mcpActor')
const { COMMENT_MAX_LENGTH } = require('../shared/TaskCommentService')

function normalizeGoalComment(comment) {
    if (typeof comment !== 'string') throw new Error('The comment must be a string.')
    const normalized = comment.trim()
    if (!normalized) throw new Error('The comment must not be empty.')
    if (normalized.length > COMMENT_MAX_LENGTH) {
        throw new Error(`The comment must not exceed ${COMMENT_MAX_LENGTH} characters.`)
    }
    return normalized
}

const uniqueStrings = values => [...new Set((values || []).filter(value => typeof value === 'string' && value.trim()))]

const nowTimestamp = () => {
    const { Timestamp } = require('firebase-admin/firestore')
    return Timestamp.now()
}

class GoalCommentService {
    constructor({ database, createId = getId, createTimestamp = nowTimestamp, baseUrl } = {}) {
        this.database = database || admin.firestore()
        this.createId = createId
        this.createTimestamp = createTimestamp
        this.baseUrl = baseUrl
    }

    async addComment({
        projectId,
        goalId,
        comment,
        actor,
        fromAssistant = false,
        silent = false,
        requestUserId = null,
    }) {
        if (!projectId || !goalId) throw new Error('Project ID and goal ID are required to add a comment.')
        const commentText = normalizeGoalComment(comment)
        const actorId = actor?.uid || actor?.id || actor?.creatorId
        if (!actorId) throw new Error('A valid comment author is required.')
        const actorChannelFields = getActorChannelFields(actor)
        const notifyActor = isMcpActor(actor)

        const goalRef = this.database.doc(`goals/${projectId}/items/${goalId}`)
        const chatRef = this.database.doc(`chatObjects/${projectId}/chats/${goalId}`)
        const followersRef = this.database.doc(`followers/${projectId}/goals/${goalId}`)
        const commentId = this.createId()
        const commentRef = this.database.doc(`chatComments/${projectId}/goals/${goalId}/comments/${commentId}`)
        const now = Date.now()
        let notificationData = null

        await this.database.runTransaction(async transaction => {
            const [goalSnapshot, chatSnapshot, followersSnapshot] = await Promise.all([
                transaction.get(goalRef),
                transaction.get(chatRef),
                transaction.get(followersRef),
            ])
            if (!goalSnapshot.exists) throw new Error(`Goal not found: ${goalId}`)

            const goalData = goalSnapshot.data() || {}
            const chatData = chatSnapshot.exists ? chatSnapshot.data() || {} : {}
            const followersData = followersSnapshot.exists ? followersSnapshot.data() || {} : {}
            const goalPeople = uniqueStrings([goalData.creatorId, ...(goalData.assigneesIds || [])]).filter(
                id => !id.startsWith('ws@')
            )
            const followers = uniqueStrings([
                ...(followersData.usersFollowing || []),
                ...(chatData.usersFollowing || []),
                ...(chatData.followerIds || []),
                ...goalPeople,
                actorId,
            ])
            const members = uniqueStrings([...(chatData.members || []), ...goalPeople, actorId])
            const isPublicFor = Array.isArray(goalData.isPublicFor) ? goalData.isPublicFor : [FEED_PUBLIC_FOR_ALL]
            const usersToNotify = followers.filter(userId => notifyActor || userId !== actorId)
            const visibleUsersToNotify = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                ? usersToNotify
                : usersToNotify.filter(userId => isPublicFor.includes(userId))

            transaction.set(commentRef, {
                creatorId: actorId,
                commentText,
                commentType: STAYWARD_COMMENT,
                lastChangeDate: this.createTimestamp(),
                created: now,
                originalContent: commentText,
                fromAssistant: !!fromAssistant,
                ...(fromAssistant && requestUserId ? { requestUserId } : {}),
                ...actorChannelFields,
            })

            const goalCommentsData =
                goalData.commentsData && typeof goalData.commentsData === 'object' ? goalData.commentsData : {}
            const lastCommentData = {
                lastCommentOwnerId: actorId,
                lastComment: commentText.substring(0, 500),
                lastCommentType: STAYWARD_COMMENT,
            }
            transaction.update(goalRef, {
                commentsData: {
                    ...goalCommentsData,
                    ...lastCommentData,
                    amount: (Number(goalCommentsData.amount) || 0) + 1,
                },
            })

            const nextChatData = {
                id: goalId,
                projectId,
                title: goalData.extendedName || goalData.name || 'Goal',
                type: 'goals',
                creatorId: chatData.creatorId || goalData.creatorId || actorId,
                created: chatData.created || goalData.created || now,
                lastEditionDate: now,
                lastEditorId: actorId,
                isPublicFor,
                hasStar: chatData.hasStar || goalData.hasStar || '#ffffff',
                stickyData: chatData.stickyData || { days: 0, stickyEndDate: 0 },
                usersFollowing: followers,
                followerIds: followers,
                members,
                commentsData: {
                    ...(chatData.commentsData || {}),
                    ...lastCommentData,
                    amount: (Number(chatData.commentsData?.amount) || 0) + 1,
                },
            }
            if (fromAssistant) {
                nextChatData.assistantId = goalData.assistantId || chatData.assistantId || actorId
                nextChatData.lastAssistantComment = now
            }
            transaction.set(chatRef, nextChatData, { merge: true })
            transaction.set(followersRef, { usersFollowing: followers }, { merge: true })

            notificationData = {
                goal: goalData,
                followers: visibleUsersToNotify,
                actorName: formatActorDisplayName(actor.displayName || actor.name || 'Assistant', actor),
            }
        })

        let notificationError = null
        if (!silent && notificationData.followers.length > 0) {
            try {
                await this.notifyFollowers({
                    projectId,
                    goalId,
                    ...notificationData,
                    actorId,
                    actorChannelFields,
                    commentId,
                    commentText,
                    fromAssistant,
                })
            } catch (error) {
                notificationError = error.message
                console.error('GoalCommentService: comment saved but notifying followers failed', {
                    projectId,
                    goalId,
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
            notifiedFollowers: silent ? 0 : notificationData.followers.length,
            notificationError,
        }
    }

    async notifyFollowers({
        projectId,
        goalId,
        goal,
        followers,
        actorId,
        actorName,
        actorChannelFields = {},
        commentId,
        commentText,
        fromAssistant,
    }) {
        const projectSnapshot = await this.database.doc(`projects/${projectId}`).get()
        const projectName = projectSnapshot.exists ? projectSnapshot.data()?.name || '' : ''
        const objectName = goal.extendedName || goal.name || 'Goal'
        const messageTimestamp = Date.now()
        const batch = this.database.batch()

        followers.forEach(userId => {
            batch.set(this.database.doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
                chatId: goalId,
                chatType: 'goals',
                followed: true,
                date: messageTimestamp,
                creatorId: actorId,
                creatorType: fromAssistant ? 'assistant' : 'user',
                ...actorChannelFields,
            })
        })

        batch.set(
            this.database.doc(`emailNotifications/${goalId}`),
            {
                userIds: followers,
                projectId,
                objectType: 'goals',
                objectId: goalId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )

        batch.set(this.database.doc(`pushNotifications/${commentId}`), {
            userIds: followers,
            body: `${projectName}\n  ✔ ${objectName}\n ${actorName} commented: ${commentText}`,
            link: `${this.baseUrl || getBaseUrl()}/projects/${projectId}/goals/${goalId}/chat`,
            messageTimestamp,
            type: 'Chat Notification',
            chatId: goalId,
            projectId,
            initiatorId: actorId,
            ...(actorChannelFields.via === MCP_CHANNEL ? { initiatorVia: MCP_CHANNEL } : {}),
        })

        await batch.commit()
    }
}

module.exports = { GoalCommentService, normalizeGoalComment }
