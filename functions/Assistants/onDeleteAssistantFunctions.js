const admin = require('firebase-admin')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { deleteAssistant, GLOBAL_PROJECT_ID, deleteAssistantTasks } = require('../Firestore/assistantsFirestore')
const { deleteTasksFromAssignee } = require('../Tasks/tasksFirestoreCloud')
const { deleteRecord, ASSISTANTS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteNote } = require('../Notes/notesFirestoreCloud')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')

const deleteAssistantInGuidesWhenDeleteAssisntantInTemplate = async (projectId, assistantId) => {
    let promises = []
    promises.push(getProject(projectId, admin))
    promises.push(getTemplateGuideIds(projectId, admin))
    const [project, guideIds] = await Promise.all(promises)

    if (project && project.isTemplate) {
        promises = []
        guideIds.forEach(guideId => {
            promises.push(deleteAssistant(admin, guideId, guideId + assistantId))
        })
        await Promise.all(promises)
    }
}

const onDeleteAssistant = async (projectId, assistant) => {
    const promises = []
    promises.push(deleteChat(admin, projectId, assistant.uid))
    if (assistant.noteIdsByProject[projectId])
        promises.push(deleteNote(projectId, assistant.noteIdsByProject[projectId], false, admin))
    promises.push(deleteAssistantTasks(admin, projectId, assistant.uid))
    promises.push(deleteRecord(assistant.uid, projectId, ASSISTANTS_OBJECTS_TYPE))
    promises.push(removeObjectFromBacklinks(projectId, 'linkedParentAssistantIds', assistant.uid, admin))
    if (projectId !== GLOBAL_PROJECT_ID) {
        promises.push(deleteAssistantInGuidesWhenDeleteAssisntantInTemplate(projectId, assistant.uid))
        promises.push(deleteTasksFromAssignee(projectId, assistant.uid, admin))
    }
    await Promise.all(promises)
}

module.exports = { onDeleteAssistant }
