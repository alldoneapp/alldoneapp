const { updateChatEditionData } = require('../Chats/chatsFirestoreCloud')
const { updateGoalEditionData, resetGoalLastCommentData } = require('../Goals/goalsFirestore')
const { updateNoteEditionData, resetNoteLastCommentData } = require('../Notes/notesFirestoreCloud')
const { updateSkillEditionData, resetSkillLastCommentData } = require('../Skills/skillsFirestore')
const { updateTaskEditionData, resetTaskLastCommentData } = require('../Tasks/tasksFirestoreCloud')
const { updateUserEditionData, resetUserLastCommentData } = require('../Users/usersFirestore')
const { updateAssistantEditionData, resetAssistantLastCommentData } = require('../Firestore/assistantsFirestore')
const { updateContactEditionData, resetContactLastCommentData } = require('../Firestore/contactsFirestore')

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

const resetLastCommentDataOfChatParentObject = async (projectId, objectId, type) => {
    if (type === 'assistants') {
        await resetAssistantLastCommentData(projectId, objectId)
    } else if (type === 'contacts') {
        const promises = []
        promises.push(resetContactLastCommentData(projectId, objectId))
        promises.push(resetUserLastCommentData(projectId, objectId))
        await Promise.all(promises)
    } else if (type === 'skills') {
        await resetSkillLastCommentData(projectId, objectId)
    } else if (type === 'tasks') {
        await resetTaskLastCommentData(projectId, objectId)
    } else if (type === 'goals') {
        await resetGoalLastCommentData(projectId, objectId)
    } else if (type === 'notes') {
        await resetNoteLastCommentData(projectId, objectId)
    }
}

module.exports = {
    updateEditonDataOfNoteParentObject,
    updateEditonDataOfChatParentObject,
    resetLastCommentDataOfChatParentObject,
}
