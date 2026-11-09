'use strict'

/**
 * Writes a comment into the thread of a goal, a contact or an artifact from the server (the
 * `comment` of update_goal, update_contact and update_artifact, for assistants and MCP clients).
 * The counterpart of shared/TaskCommentService.js for the other object types, with the same shape
 * on purpose: the comment, the object's `commentsData`, the chat object and the followers document
 * are written in one transaction, and the notifications (unread marker, email digest, push) follow.
 *
 * Two rules come from the task version and matter just as much here. An MCP client's comment is
 * news to the user too, so the actor is notified as well (shared/mcpActor.js). And a comment an
 * assistant writes as part of an update is `silent`: it is in the thread but marks nothing unread;
 * the calling tool decides that exactly as update_task does.
 *
 * Adding a type means one entry in OBJECT_COMMENT_TYPES. The object's own people (creator,
 * assignees, owner) follow its thread; the `ws@` workstream placeholder is never a person.
 */

const { filterToProjectMembers } = require('./projectMemberRecipients')
const admin = require('firebase-admin')

const { getId } = require('../Firestore/generalFirestoreCloud')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT, getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { MCP_CHANNEL, formatActorDisplayName, getActorChannelFields, isMcpActor } = require('./mcpActor')

const COMMENT_MAX_LENGTH = 5000

// Not `filter(Boolean)`: FEED_PUBLIC_FOR_ALL is 0, and dropping it would make the thread private.
const withoutEmpty = values => values.filter(value => value !== undefined && value !== null && value !== '')

const OBJECT_COMMENT_TYPES = Object.freeze({
    goals: {
        docPath: (projectId, id) => `goals/${projectId}/items/${id}`,
        title: data => data.extendedName || data.name || 'Goal',
        people: data => [data.creatorId, ...(Array.isArray(data.assigneesIds) ? data.assigneesIds : [])],
        defaultIsPublicFor: () => [FEED_PUBLIC_FOR_ALL],
        label: 'Goal',
    },
    contacts: {
        docPath: (projectId, id) => `projectsContacts/${projectId}/contacts/${id}`,
        title: data => data.displayName || 'Contact',
        people: data => [data.recorderUserId],
        defaultIsPublicFor: data => withoutEmpty([FEED_PUBLIC_FOR_ALL, data.recorderUserId]),
        label: 'Contact',
    },
    artifacts: {
        docPath: (projectId, id) => `artifactItems/${projectId}/artifacts/${id}`,
        title: data => data.title || 'Artifact',
        people: data => [data.userId, data.creatorId],
        defaultIsPublicFor: data => withoutEmpty([FEED_PUBLIC_FOR_ALL, data.userId]),
        label: 'Artifact',
    },
})

function normalizeObjectComment(comment) {
    if (typeof comment !== 'string') throw new Error('The comment must be a string.')
    const normalized = comment.trim()
    if (!normalized) throw new Error('The comment must not be empty.')
    if (normalized.length > COMMENT_MAX_LENGTH) {
        throw new Error(`The comment must not exceed ${COMMENT_MAX_LENGTH} characters.`)
    }
    return normalized
}

const uniqueStrings = values => [...new Set((values || []).filter(value => typeof value === 'string' && value.trim()))]
const isPerson = id => typeof id === 'string' && !!id && !id.startsWith('ws@')

const nowTimestamp = () => {
    const { Timestamp } = require('firebase-admin/firestore')
    return Timestamp.now()
}

class ObjectCommentService {
    constructor({ database, createId = getId, createTimestamp = nowTimestamp, baseUrl } = {}) {
        this.database = database || admin.firestore()
        this.createId = createId
        this.createTimestamp = createTimestamp
        this.baseUrl = baseUrl
    }

    async addComment({
        objectType,
        projectId,
        objectId,
        comment,
        actor,
        fromAssistant = false,
        silent = false,
        requestUserId = null,
    }) {
        const config = OBJECT_COMMENT_TYPES[objectType]
        if (!config) throw new Error(`Comments are not supported for "${objectType}".`)
        if (!projectId || !objectId) throw new Error('Project ID and object ID are required to add a comment.')
        const commentText = normalizeObjectComment(comment)
        const actorId = actor?.uid || actor?.id || actor?.creatorId
        if (!actorId) throw new Error('A valid comment author is required.')
        const actorChannelFields = getActorChannelFields(actor)
        const notifyActor = isMcpActor(actor)

        const objectRef = this.database.doc(config.docPath(projectId, objectId))
        const chatRef = this.database.doc(`chatObjects/${projectId}/chats/${objectId}`)
        const followersRef = this.database.doc(`followers/${projectId}/${objectType}/${objectId}`)
        const commentId = this.createId()
        const commentRef = this.database.doc(
            `chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`
        )
        const now = Date.now()
        let notificationData = null

        await this.database.runTransaction(async transaction => {
            const [objectSnapshot, chatSnapshot, followersSnapshot] = await Promise.all([
                transaction.get(objectRef),
                transaction.get(chatRef),
                transaction.get(followersRef),
            ])
            if (!objectSnapshot.exists) throw new Error(`${config.label} not found: ${objectId}`)

            const objectData = objectSnapshot.data() || {}
            const chatData = chatSnapshot.exists ? chatSnapshot.data() || {} : {}
            const followersData = followersSnapshot.exists ? followersSnapshot.data() || {} : {}
            const objectPeople = uniqueStrings(config.people(objectData)).filter(isPerson)
            const followers = uniqueStrings([
                ...(followersData.usersFollowing || []),
                ...(chatData.usersFollowing || []),
                ...(chatData.followerIds || []),
                ...objectPeople,
                actorId,
            ])
            const members = uniqueStrings([...(chatData.members || []), ...objectPeople, actorId])
            const isPublicFor = Array.isArray(objectData.isPublicFor)
                ? objectData.isPublicFor
                : config.defaultIsPublicFor(objectData)
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

            const objectCommentsData =
                objectData.commentsData && typeof objectData.commentsData === 'object' ? objectData.commentsData : {}
            const lastCommentData = {
                lastCommentOwnerId: actorId,
                lastComment: commentText.substring(0, 500),
                lastCommentType: STAYWARD_COMMENT,
            }
            transaction.update(objectRef, {
                commentsData: {
                    ...objectCommentsData,
                    ...lastCommentData,
                    amount: (Number(objectCommentsData.amount) || 0) + 1,
                },
            })

            const nextChatData = {
                id: objectId,
                projectId,
                title: config.title(objectData),
                type: objectType,
                creatorId: chatData.creatorId || objectPeople[0] || actorId,
                created: chatData.created || objectData.created || now,
                lastEditionDate: now,
                lastEditorId: actorId,
                isPublicFor,
                hasStar: chatData.hasStar || objectData.hasStar || '#ffffff',
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
                nextChatData.assistantId = objectData.assistantId || chatData.assistantId || actorId
                nextChatData.lastAssistantComment = now
            }
            transaction.set(chatRef, nextChatData, { merge: true })
            transaction.set(followersRef, { usersFollowing: followers }, { merge: true })

            notificationData = {
                objectName: config.title(objectData),
                followers: visibleUsersToNotify,
                actorName: formatActorDisplayName(actor.displayName || actor.name || 'Assistant', actor),
            }
        })

        let notificationError = null
        let notifiedCount = 0
        if (!silent && notificationData.followers.length > 0) {
            try {
                notifiedCount = await this.notifyFollowers({
                    objectType,
                    projectId,
                    objectId,
                    ...notificationData,
                    actorId,
                    actorChannelFields,
                    commentId,
                    commentText,
                    fromAssistant,
                })
            } catch (error) {
                notificationError = error.message
                console.error('ObjectCommentService: comment saved but notifying followers failed', {
                    objectType,
                    projectId,
                    objectId,
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
            notifiedFollowers: silent ? 0 : notifiedCount || 0,
            notificationError,
        }
    }

    async notifyFollowers({
        objectType,
        projectId,
        objectId,
        objectName,
        followers,
        actorId,
        actorName,
        actorChannelFields = {},
        commentId,
        commentText,
        fromAssistant,
    }) {
        const projectSnapshot = await this.database.doc(`projects/${projectId}`).get()
        const projectData = projectSnapshot.exists ? projectSnapshot.data() || {} : {}
        const projectName = projectData.name || ''
        // Security audit 2026-11 (#11): follower lists are member-writable and outlive membership.
        const recipients = filterToProjectMembers(followers, projectData)
        if (recipients.length === 0) return 0
        const messageTimestamp = Date.now()
        const batch = this.database.batch()

        recipients.forEach(userId => {
            batch.set(this.database.doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
                chatId: objectId,
                chatType: objectType,
                followed: true,
                date: messageTimestamp,
                creatorId: actorId,
                creatorType: fromAssistant ? 'assistant' : 'user',
                ...actorChannelFields,
            })
        })

        batch.set(
            this.database.doc(`emailNotifications/${objectId}`),
            {
                userIds: recipients,
                projectId,
                objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )

        // Same text and link shape as the app's own comment notification (chatsComments.js).
        batch.set(this.database.doc(`pushNotifications/${commentId}`), {
            userIds: recipients,
            body: `${projectName}\n  ✔ ${objectName}\n ${actorName} commented: ${commentText}`,
            link: `${this.baseUrl || getBaseUrl()}/projects/${projectId}/${objectType}/${objectId}/chat`,
            messageTimestamp,
            type: 'Chat Notification',
            chatId: objectId,
            projectId,
            initiatorId: actorId,
            ...(actorChannelFields.via === MCP_CHANNEL ? { initiatorVia: MCP_CHANNEL } : {}),
        })

        await batch.commit()
        return recipients.length
    }
}

module.exports = { COMMENT_MAX_LENGTH, OBJECT_COMMENT_TYPES, ObjectCommentService, normalizeObjectComment }
