const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getUserData } = require('../Users/usersFirestore')
const { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } = require('../Utils/HelperFunctionsCloud')
const { FieldValue } = require('firebase-admin/firestore')
const { withoutAccessProjection } = require('../shared/objectAccessProjection')

const deleteChat = async (admin, projectId, chatId) => {
    await admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`).delete()
}

// When an object (task/note) is moved to another project the object document is recreated in the
// target project, but its chat lives in project-scoped collections (chatObjects + chatComments) keyed
// by the OLD project id. Without copying it across, the moved object shows up with an empty chat and the
// original conversation is orphaned (and then deleted by the source object's delete cascade). The Admin SDK
// preserves original comment authors while omitting server-owned access projections so the destination
// trigger can rebuild them against the target project's membership.
const moveAssistantLastCommentPointer = async (admin, sourceProjectId, targetProjectId, chatId) => {
    const { movedAssistantPointerUpdates } = require('./movedAssistantPointers')
    const db = admin.firestore()
    const [source, target] = await Promise.all([
        db.doc(`projects/${sourceProjectId}`).get(),
        db.doc(`projects/${targetProjectId}`).get(),
    ])
    const targetMembers = new Set(target.data()?.userIds || [])
    const userIds = (source.data()?.userIds || []).filter(id => targetMembers.has(id))
    await Promise.all(
        userIds.map(userId =>
            db.runTransaction(async transaction => {
                const ref = db.doc(`users/${userId}`)
                const user = await transaction.get(ref)
                if (!user.exists) return
                const updates = movedAssistantPointerUpdates(
                    user.data(),
                    sourceProjectId,
                    targetProjectId,
                    chatId,
                    FieldValue.delete()
                )
                if (Object.keys(updates).length) transaction.update(ref, updates)
            })
        )
    )
}

const copyChatToOtherProject = async (admin, sourceProjectId, targetProjectId, objectType, chatId, options = {}) => {
    if (!sourceProjectId || !targetProjectId || !objectType || !chatId) return false
    if (sourceProjectId === targetProjectId) return false

    const firestore = admin.firestore()
    const chatDoc = await firestore.doc(`chatObjects/${sourceProjectId}/chats/${chatId}`).get()
    if (!chatDoc.exists) return false

    const commentsSnapshot = await firestore
        .collection(`chatComments/${sourceProjectId}/${objectType}/${chatId}/comments`)
        .get()

    const batch = new BatchWrapper(firestore)
    batch.set(
        firestore.doc(`chatObjects/${targetProjectId}/chats/${chatId}`),
        withoutAccessProjection(options.chatData || chatDoc.data()),
        { merge: true }
    )
    const runComments = []
    commentsSnapshot.forEach(commentDoc => {
        const comment = commentDoc.data()
        const run = comment.assistantRun
        if (
            run?.kind === 'chat' &&
            run.runId &&
            (comment.isLoading || comment.isThinking || ['running', 'cancel_requested'].includes(run.status))
        ) {
            runComments.push({ commentId: commentDoc.id, runId: run.runId })
            return
        }
        batch.set(
            firestore.doc(`chatComments/${targetProjectId}/${objectType}/${chatId}/comments/${commentDoc.id}`),
            commentDoc.data()
        )
    })
    await batch.commit()
    const { moveAssistantRunComment } = require('../Assistant/assistantRunLocation')
    for (const run of runComments) {
        await moveAssistantRunComment(firestore, {
            sourceProjectId,
            targetProjectId,
            objectType,
            objectId: chatId,
            ...run,
        })
    }

    await moveAssistantLastCommentPointer(admin, sourceProjectId, targetProjectId, chatId)

    return true
}

const getChat = async (projectId, chatId) => {
    const doc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    return doc.data()
}

const updateChatEditionData = async (projectId, chatId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`)
            const chatDoc = await transaction.get(ref)
            if (chatDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const convertDocsInObjects = docs => {
    const objects = []
    docs.forEach(doc => {
        objects.push({ ...doc.data(), id: doc.id })
    })
    return objects
}

const getChatNotifcations = async (projectId, userId, chatId, getOnlyDocs) => {
    const docs = (
        await admin
            .firestore()
            .collection(`chatNotifications/${projectId}/${userId}`)
            .where('chatId', '==', chatId)
            .get()
    ).docs
    return getOnlyDocs ? docs : convertDocsInObjects(docs)
}

const deleteChatNotifcation = (projectId, userId, commentId, batch) => {
    batch.delete(admin.firestore().doc(`chatNotifications/${projectId}/${userId}/${commentId}`))
}

const removeSingleChatNotification = async (projectId, userId, commentId) => {
    if (!projectId || !userId || !commentId) return

    await admin.firestore().doc(`chatNotifications/${projectId}/${userId}/${commentId}`).delete()
}

const deleteChatNotifications = async (projectId, userId, chatId) => {
    const promises = []
    promises.push(getChatNotifcations(projectId, userId, chatId, true))
    promises.push(getUserData(userId))
    const [notificationDocs, user] = await Promise.all(promises)

    const { lastAssistantCommentData } = user

    const batch = new BatchWrapper(admin.firestore())

    if (lastAssistantCommentData[projectId]?.objectId === chatId) {
        batch.update(admin.firestore().doc(`users/${userId}`), {
            [`lastAssistantCommentData.${projectId}`]: FieldValue.delete(),
        })
    }
    if (
        lastAssistantCommentData[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]?.projectId === projectId &&
        lastAssistantCommentData[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]?.objectId === chatId
    ) {
        batch.update(admin.firestore().doc(`users/${userId}`), {
            [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: FieldValue.delete(),
        })
    }

    notificationDocs.forEach(doc => {
        deleteChatNotifcation(projectId, userId, doc.id, batch)
    })
    await batch.commit()
}

const getChatPushNotifications = async () => {
    const docs = (await admin.firestore().collection(`pushNotifications`).orderBy('messageTimestamp', 'asc').get()).docs
    return convertDocsInObjects(docs)
}

const removeChatPushNotifications = async notifications => {
    const promises = []
    notifications.forEach(notification => {
        promises.push(admin.firestore().doc(`pushNotifications/${notification.id}`).delete())
    })
    await Promise.all(promises)
}

module.exports = {
    deleteChat,
    copyChatToOtherProject,
    getChat,
    updateChatEditionData,
    deleteChatNotifications,
    removeSingleChatNotification,
    getChatPushNotifications,
    removeChatPushNotifications,
}
