'use strict'

const MAX_BATCH_WRITES = 400

function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function belongsToProject(data, projectId) {
    return data?.projectId === projectId
}

function belongsToChat(snapshot, chatId) {
    if (!chatId) return true
    const data = snapshot.data() || {}
    return data.chatId === chatId || data.objectId === chatId || snapshot.id === chatId
}

function recipientDocs(snapshot, userId, projectId, chatId = null) {
    return (snapshot?.docs || []).filter(document => {
        const data = document.data() || {}
        return (
            belongsToProject(data, projectId) &&
            Array.isArray(data.userIds) &&
            data.userIds.includes(userId) &&
            belongsToChat(document, chatId)
        )
    })
}

async function commitWrites(db, writes) {
    for (let start = 0; start < writes.length; start += MAX_BATCH_WRITES) {
        const batch = db.batch()
        writes.slice(start, start + MAX_BATCH_WRITES).forEach(write => {
            if (write.operation === 'delete') batch.delete(write.ref)
            else batch.set(write.ref, write.data, { merge: true })
        })
        await batch.commit()
    }
}

function removeRecipientWrites(documents, userId, FieldValue) {
    return documents.map(document => {
        const userIds = document.data()?.userIds || []
        if (userIds.length <= 1) return { operation: 'delete', ref: document.ref }
        return {
            operation: 'set',
            ref: document.ref,
            data: { userIds: FieldValue.arrayRemove(userId) },
        }
    })
}

/**
 * Clears the authenticated user's unread state without exposing shared notification side channels
 * to browser queries. The callable wrapper is responsible for authenticating the user and checking
 * project membership before invoking this helper.
 */
async function markChatNotificationsRead({ db, FieldValue, userId, projectId, chatId = null, followedOnly = false }) {
    const normalizedUserId = asTrimmedString(userId)
    const normalizedProjectId = asTrimmedString(projectId)
    const normalizedChatId = asTrimmedString(chatId) || null
    if (!normalizedUserId || !normalizedProjectId) throw new Error('userId and projectId are required')

    let chatQuery = db.collection(`chatNotifications/${normalizedProjectId}/${normalizedUserId}`)
    if (normalizedChatId) chatQuery = chatQuery.where('chatId', '==', normalizedChatId)
    else if (followedOnly) chatQuery = chatQuery.where('followed', '==', true)

    const emailPromise = normalizedChatId
        ? db.doc(`emailNotifications/${normalizedChatId}`).get()
        : db.collection('emailNotifications').where('userIds', 'array-contains', normalizedUserId).get()
    const pushPromise = db.collection('pushNotifications').where('userIds', 'array-contains', normalizedUserId).get()

    const [chatSnapshot, emailSnapshot, pushSnapshot] = await Promise.all([chatQuery.get(), emailPromise, pushPromise])
    const chatDocuments = chatSnapshot.docs || []
    const emailDocuments = normalizedChatId
        ? emailSnapshot.exists &&
          belongsToProject(emailSnapshot.data() || {}, normalizedProjectId) &&
          Array.isArray(emailSnapshot.data()?.userIds) &&
          emailSnapshot.data().userIds.includes(normalizedUserId) &&
          belongsToChat(emailSnapshot, normalizedChatId)
            ? [emailSnapshot]
            : []
        : recipientDocs(emailSnapshot, normalizedUserId, normalizedProjectId)
    const pushDocuments = recipientDocs(pushSnapshot, normalizedUserId, normalizedProjectId, normalizedChatId)

    const writes = [
        ...chatDocuments.map(document => ({ operation: 'delete', ref: document.ref })),
        ...removeRecipientWrites(emailDocuments, normalizedUserId, FieldValue),
        ...removeRecipientWrites(pushDocuments, normalizedUserId, FieldValue),
    ]
    await commitWrites(db, writes)

    return {
        chatNotificationsCleared: chatDocuments.length,
        emailNotificationsCleared: emailDocuments.length,
        pushNotificationsCleared: pushDocuments.length,
    }
}

module.exports = { markChatNotificationsRead }
