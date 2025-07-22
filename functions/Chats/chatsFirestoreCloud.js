const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getUserData } = require('../Users/usersFirestore')
const { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } = require('../Utils/HelperFunctionsCloud')

const deleteChat = async (admin, projectId, chatId) => {
    await admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`).delete()
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
    getChat,
    updateChatEditionData,
    deleteChatNotifications,
    getChatPushNotifications,
    removeChatPushNotifications,
}
