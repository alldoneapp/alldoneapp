const admin = require('firebase-admin')
const firebase_tools = require('firebase-tools')

const { CHATS_OBJECTS_TYPE, deleteRecord } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFollowData } = require('../Followers/followersFirestoreCloud')
const { deleteNote } = require('../Notes/notesFirestoreCloud')
const { recursiveDeleteHelper } = require('../Utils/HelperFunctionsCloud')
const {
    updateEditonDataOfChatParentObject,
    resetLastCommentDataOfChatParentObject,
} = require('../Utils/LastObjectEditionHelper')
const { deleteChatNotifications } = require('./chatsFirestoreCloud')

const removeNewChatNotifications = async (projectId, chatId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`projects/${projectId}`)
            const projectDoc = await transaction.get(ref)
            if (projectDoc.exists) {
                const project = projectDoc.data()
                const promises = []
                project.userIds.forEach(userId => {
                    promises.push(deleteChatNotifications(projectId, userId, chatId))
                })
                await Promise.all(promises)
            }
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const onDeleteChat = async (projectId, chat) => {
    const { type, id: chatId, noteId } = chat

    const promises = []
    promises.push(
        recursiveDeleteHelper(firebase_tools, process.env.GCLOUD_PROJECT, `chatComments/${projectId}/${type}/${chatId}`)
    )
    promises.push(removeObjectFollowData(projectId, 'topics', chatId, admin))
    if (noteId) promises.push(deleteNote(projectId, noteId, '', admin))
    if (chat.type === 'topics') {
        promises.push(deleteRecord(chatId, projectId, CHATS_OBJECTS_TYPE))
    } else {
        promises.push(updateEditonDataOfChatParentObject(projectId, chat.id, chat.type, chat.lastEditorId))
        promises.push(resetLastCommentDataOfChatParentObject(projectId, chat.id, chat.type))
    }
    promises.push(removeNewChatNotifications(projectId, chatId))
    await Promise.all(promises)
}

module.exports = { onDeleteChat }
