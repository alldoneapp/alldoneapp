const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getUserData } = require('../Users/usersFirestore')
const { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } = require('../Utils/HelperFunctionsCloud')

const deleteChat = async (admin, projectId, chatId) => {
    await admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`).delete()
}

// When an object (task/note) is moved to another project the object document is recreated in the
// target project, but its chat lives in project-scoped collections (chatObjects + chatComments) keyed
// by the OLD project id. Without copying it across, the moved object shows up with an empty chat and the
// original conversation is orphaned (and then deleted by the source object's delete cascade). This mirrors
// the client-side moveChatOnMoveObjectFromProject so assistant-driven moves keep the chat content.
const moveAssistantLastCommentPointer = async (admin, sourceProjectId, targetProjectId, chatId) => {
    try {
        const projectDoc = await admin.firestore().doc(`projects/${sourceProjectId}`).get()
        const userIds = projectDoc.exists ? projectDoc.data().userIds || [] : []
        if (userIds.length === 0) return

        const userDocs = await Promise.all(userIds.map(uid => admin.firestore().doc(`users/${uid}`).get()))
        const updates = []
        userDocs.forEach(userDoc => {
            if (!userDoc.exists) return
            const lastAssistantCommentData = userDoc.data().lastAssistantCommentData || {}
            const allProjectsPointer = lastAssistantCommentData[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]
            // Repoint the global "last assistant comment" jump target at the new project so it survives the
            // source delete cascade (which would otherwise drop it). The per-project pointer is cleaned up by
            // that cascade already, so it does not need handling here.
            if (
                allProjectsPointer &&
                allProjectsPointer.projectId === sourceProjectId &&
                allProjectsPointer.objectId === chatId
            ) {
                updates.push(
                    userDoc.ref.update({
                        [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
                            ...allProjectsPointer,
                            projectId: targetProjectId,
                        },
                    })
                )
            }
        })
        await Promise.all(updates)
    } catch (e) {
        console.warn('moveAssistantLastCommentPointer failed', {
            sourceProjectId,
            targetProjectId,
            chatId,
            error: e.message,
        })
    }
}

const copyChatToOtherProject = async (admin, sourceProjectId, targetProjectId, objectType, chatId) => {
    if (!sourceProjectId || !targetProjectId || !objectType || !chatId) return false
    if (sourceProjectId === targetProjectId) return false

    const firestore = admin.firestore()
    const chatDoc = await firestore.doc(`chatObjects/${sourceProjectId}/chats/${chatId}`).get()
    if (!chatDoc.exists) return false

    const commentsSnapshot = await firestore
        .collection(`chatComments/${sourceProjectId}/${objectType}/${chatId}/comments`)
        .get()

    const batch = new BatchWrapper(firestore)
    batch.set(firestore.doc(`chatObjects/${targetProjectId}/chats/${chatId}`), chatDoc.data())
    commentsSnapshot.forEach(commentDoc => {
        batch.set(
            firestore.doc(`chatComments/${targetProjectId}/${objectType}/${chatId}/comments/${commentDoc.id}`),
            commentDoc.data()
        )
    })
    await batch.commit()

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
            [`lastAssistantCommentData.${projectId}`]: admin.firestore.FieldValue.delete(),
        })
    }
    if (
        lastAssistantCommentData[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]?.projectId === projectId &&
        lastAssistantCommentData[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]?.objectId === chatId
    ) {
        batch.update(admin.firestore().doc(`users/${userId}`), {
            [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: admin.firestore.FieldValue.delete(),
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
