const admin = require('firebase-admin')

const { CHATS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { updateEditonDataOfChatParentObject } = require('../Utils/LastObjectEditionHelper')

const onCreateChat = async (projectId, chat) => {
    if (chat.type === 'topics') {
        await createRecord(projectId, chat.id, chat, CHATS_OBJECTS_TYPE, admin.firestore(), true, null)
    } else {
        await updateEditonDataOfChatParentObject(projectId, chat.id, chat.type, chat.lastEditorId)
    }
}

module.exports = { onCreateChat }
