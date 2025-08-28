const admin = require('firebase-admin')
const { CHATS_OBJECTS_TYPE, updateRecord } = require('../AlgoliaGlobalSearchHelper')
const { updateEditonDataOfChatParentObject } = require('../Utils/LastObjectEditionHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { difference, isEqual } = require('lodash')
const { getProject } = require('../Firestore/generalFirestoreCloud')
const { deleteChatNotifications } = require('./chatsFirestoreCloud')

const removeNewChatNotificationsWhenChatBecomePrivate = async (projectId, chatId, oldIsPublicFor, newIsPublicFor) => {
    if (!isEqual(oldIsPublicFor, newIsPublicFor) && !newIsPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
        let userThatLostAccess = []
        if (oldIsPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
            const project = await getProject(projectId, admin)
            userThatLostAccess = difference(project.userIds, newIsPublicFor)
        } else {
            userThatLostAccess = difference(oldIsPublicFor, newIsPublicFor)
        }
        const promises = []
        userThatLostAccess.forEach(userId => {
            promises.push(deleteChatNotifications(projectId, userId, chatId))
        })
        await Promise.all(promises)
    }
}

const onUpdateChat = async (projectId, chatId, change) => {
    const oldChat = change.before.data()
    const newChat = change.after.data()

    const promises = []
    if (newChat.type === 'topics') {
        promises.push(updateRecord(projectId, chatId, oldChat, newChat, CHATS_OBJECTS_TYPE, admin.firestore()))
    } else if (oldChat.lastEditionDate !== newChat.lastEditionDate) {
        promises.push(updateEditonDataOfChatParentObject(projectId, newChat.id, newChat.type, newChat.lastEditorId))
    }

    promises.push(
        removeNewChatNotificationsWhenChatBecomePrivate(projectId, newChat.id, oldChat.isPublicFor, newChat.isPublicFor)
    )

    await Promise.all(promises)
}

module.exports = { onUpdateChat }
