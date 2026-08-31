'use strict'

const PUBLIC_FOR_ALL = 0
const ALLOWED_OBJECT_TYPES = new Set(['tasks', 'notes', 'goals', 'skills', 'contacts', 'topics'])

class ProjectMoveChatError extends Error {
    constructor(code, message) {
        super(message)
        this.name = 'ProjectMoveChatError'
        this.code = code
    }
}

function buildMovedTopicChatData(chatData, targetUserIds, actorId, followerIds) {
    const allowedUserIds = new Set(targetUserIds)
    const movedChat = { ...chatData, usersFollowing: followerIds }
    delete movedChat.movingToOtherProjectId

    if (Array.isArray(movedChat.members)) {
        movedChat.members = movedChat.members.filter(userId => allowedUserIds.has(userId))
    }

    const isPublicFor = Array.isArray(movedChat.isPublicFor) ? movedChat.isPublicFor : []
    if (!isPublicFor.includes(PUBLIC_FOR_ALL)) {
        movedChat.isPublicFor = isPublicFor.filter(userId => allowedUserIds.has(userId))
        if (allowedUserIds.has(actorId) && !movedChat.isPublicFor.includes(actorId)) {
            movedChat.isPublicFor.push(actorId)
        }
    }

    return movedChat
}

async function copyProjectMoveChat({
    adminRef,
    actorId,
    sourceProjectId,
    targetProjectId,
    objectType,
    objectId,
    copyChat = require('./chatsFirestoreCloud').copyChatToOtherProject,
}) {
    if (!sourceProjectId || !targetProjectId || !objectType || !objectId) {
        throw new ProjectMoveChatError('invalid-argument', 'Project ids, object type and object id are required')
    }
    if (!ALLOWED_OBJECT_TYPES.has(objectType)) {
        throw new ProjectMoveChatError('invalid-argument', 'Unsupported object type')
    }
    if (sourceProjectId === targetProjectId) return { copied: false, reason: 'same-project' }

    const database = adminRef.firestore()
    const sourceChatRef = database.doc(`chatObjects/${sourceProjectId}/chats/${objectId}`)
    const [targetProjectDoc, sourceChatDoc] = await Promise.all([
        database.doc(`projects/${targetProjectId}`).get(),
        sourceChatRef.get(),
    ])
    if (!sourceChatDoc.exists) return { copied: false, reason: 'no-chat' }

    const sourceChat = sourceChatDoc.data() || {}
    const isPublicFor = Array.isArray(sourceChat.isPublicFor) ? sourceChat.isPublicFor : []
    if (!isPublicFor.includes(PUBLIC_FOR_ALL) && !isPublicFor.includes(actorId)) {
        throw new ProjectMoveChatError('permission-denied', 'No write access to the source conversation')
    }

    let chatData = { ...sourceChat }
    delete chatData.movingToOtherProjectId
    let followerIds = []
    if (objectType === 'topics') {
        const targetUserIds = targetProjectDoc.exists ? targetProjectDoc.data()?.userIds || [] : []
        const allowedUserIds = new Set(targetUserIds)
        const sourceFollowers = await database.doc(`followers/${sourceProjectId}/topics/${objectId}`).get()
        const sourceFollowerIds = sourceFollowers.exists
            ? sourceFollowers.data()?.usersFollowing || []
            : sourceChat.usersFollowing || []
        followerIds = sourceFollowerIds.filter(userId => allowedUserIds.has(userId))
        if (allowedUserIds.has(actorId) && !followerIds.includes(actorId)) followerIds.push(actorId)
        chatData = buildMovedTopicChatData(sourceChat, targetUserIds, actorId, followerIds)
    }

    await copyChat(adminRef, sourceProjectId, targetProjectId, objectType, objectId, { chatData })
    await sourceChatRef.update({ movingToOtherProjectId: targetProjectId })
    await sourceChatRef.delete()

    if (objectType === 'topics') {
        const writes = [
            database.doc(`followers/${targetProjectId}/topics/${objectId}`).set({ usersFollowing: followerIds }),
            ...followerIds.map(userId =>
                database
                    .doc(`usersFollowing/${targetProjectId}/entries/${userId}`)
                    .set({ topics: { [objectId]: true } }, { merge: true })
            ),
        ]
        await Promise.all(writes)
    }

    return { copied: true, followerCount: followerIds.length }
}

module.exports = {
    ProjectMoveChatError,
    buildMovedTopicChatData,
    copyProjectMoveChat,
}
