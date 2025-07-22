const { updateChatEditionData } = require('../Chats/chatsFirestoreCloud')
const { updateGoalEditionData } = require('../Goals/goalsFirestore')
const { updateNoteEditionData } = require('../Notes/notesFirestoreCloud')
const { updateSkillEditionData } = require('../Skills/skillsFirestore')
const { updateTaskEditionData } = require('../Tasks/tasksFirestoreCloud')
const { updateUserEditionData } = require('../Users/usersFirestore')
const { updateAssistantEditionData } = require('../Firestore/assistantsFirestore')
const { updateContactEditionData } = require('../Firestore/contactsFirestore')

const updateEditonDataOfNoteParentObject = async (projectId, objectId, type, editorId) => {
    if (type === 'topics') {
        await updateChatEditionData(projectId, objectId, editorId)
    } else if (type === 'assistants') {
        await updateAssistantEditionData(projectId, objectId, editorId)
    } else if (type === 'contacts') {
        await updateContactEditionData(projectId, objectId, editorId)
    } else if (type === 'users') {
        await updateUserEditionData(objectId, editorId)
    } else if (type === 'skills') {
        await updateSkillEditionData(projectId, objectId, editorId)
    } else if (type === 'tasks') {
        await updateTaskEditionData(projectId, objectId, editorId)
    } else if (type === 'goals') {
        await updateGoalEditionData(projectId, objectId, editorId)
    }
}

const updateEditonDataOfChatParentObject = async (projectId, objectId, type, editorId) => {
    if (type === 'assistants') {
        await updateAssistantEditionData(projectId, objectId, editorId)
    } else if (type === 'contacts') {
        const promises = []
        promises.push(updateContactEditionData(projectId, objectId, editorId))
        promises.push(updateUserEditionData(objectId, editorId))
        await Promise.all(promises)
    } else if (type === 'skills') {
        await updateSkillEditionData(projectId, objectId, editorId)
    } else if (type === 'tasks') {
        await updateTaskEditionData(projectId, objectId, editorId)
    } else if (type === 'goals') {
        await updateGoalEditionData(projectId, objectId, editorId)
    } else if (type === 'notes') {
        await updateNoteEditionData(projectId, objectId, editorId)
    }
}

module.exports = {
    updateEditonDataOfNoteParentObject,
    updateEditonDataOfChatParentObject,
}
