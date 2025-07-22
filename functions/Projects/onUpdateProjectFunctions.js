const admin = require('firebase-admin')
const firebase_tools = require('firebase-tools')
const { difference } = require('lodash')

const { generateProjectWarnings } = require('../Payment/QuotaWarnings')
const { removeUserDataFromProject } = require('../Users/onKickUserFromProject')
const { getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { deleteTasksFromAssignee } = require('../Tasks/tasksFirestoreCloud')
const { removeObjectFromBacklinks } = require('../Backlinks/backlinksHelper')
const { deleteNote, getNoteByParentId } = require('../Notes/notesFirestoreCloud')
const { getGlobalAssistants } = require('../Firestore/assistantsFirestore')
const { deleteChat } = require('../Chats/chatsFirestoreCloud')
const { startProjectIndexationInAlgolia } = require('../AlgoliaGlobalSearchHelper')
const { setProjectAssistant } = require('./projectsFirestore')

const deleteTasksFromAssistantsInProject = async (projectId, assistantIds) => {
    const promises = []
    assistantIds.forEach(assistantId => {
        promises.push(deleteTasksFromAssignee(projectId, assistantId, admin))
    })
    await Promise.all(promises)
}

const addSomeGlobalAssistantToTemplateGuides = async (guideIds, globalAssistantIds, admin) => {
    const promises = []
    guideIds.forEach(guideId => {
        promises.push(
            admin
                .firestore()
                .doc(`projects/${guideId}`)
                .update({ globalAssistantIds: admin.firestore.FieldValue.arrayUnion(...globalAssistantIds) })
        )
    })
    await Promise.all(promises)
}

const removeSomeGlobalAssistantFromTemplateGuides = async (guideIds, globalAssistantIds, admin) => {
    const promises = []
    guideIds.forEach(guideId => {
        promises.push(
            admin
                .firestore()
                .doc(`projects/${guideId}`)
                .update({ globalAssistantIds: admin.firestore.FieldValue.arrayRemove(...globalAssistantIds) })
        )
    })
    await Promise.all(promises)
}

const removeDeletedGlobalAssistantsFromObjectBacklinks = async (projectId, assistantIds) => {
    const promises = []
    assistantIds.forEach(assistantId => {
        promises.push(removeObjectFromBacklinks(projectId, 'linkedParentAssistantIds', assistantId, admin))
    })
    await Promise.all(promises)
}

const removeDeletedGlobalAssistantNotes = async (projectId, assistantIds) => {
    const globalAssistants = await getGlobalAssistants(admin)
    const assistantsMap = {}
    globalAssistants.forEach(assistant => {
        assistantsMap[assistant.uid] = assistant
    })
    const promisesForDeletedAssistants = []
    const promises = []
    assistantIds.forEach(assistantId => {
        if (assistantsMap[assistantId]) {
            promises.push(deleteNote(projectId, assistantsMap[assistantId].noteIdsByProject[projectId], false, admin))
        } else {
            promisesForDeletedAssistants.push(getNoteByParentId(projectId, assistantId, admin))
        }
    })
    const notesFromDeletedAssistants = await Promise.all(promisesForDeletedAssistants)
    notesFromDeletedAssistants.forEach(note => {
        if (note) promises.push(deleteNote(projectId, note.id, false, admin))
    })
    await Promise.all(promises)
}

const removeDeletedGlobalAssistantChats = async (projectId, assistantIds) => {
    const promises = []
    assistantIds.forEach(assistantId => {
        promises.push(deleteChat(admin, projectId, assistantId))
    })
    await Promise.all(promises)
}

const updateProjectAssistantToTemplateGuides = async (guideIds, assistantId, isGlobalAssistant, admin) => {
    const promises = []
    guideIds.forEach(guideId => {
        promises.push(
            admin
                .firestore()
                .doc(`projects/${guideId}`)
                .update({ assistantId: isGlobalAssistant ? assistantId : guideId + assistantId })
        )
    })
    await Promise.all(promises)
}

const onUpdateProject = async (projectId, oldProject, newProject) => {
    const promises = []
    promises.push(generateProjectWarnings(projectId, oldProject, newProject, admin))

    const removedUserId = difference(oldProject.userIds, newProject.userIds)[0]
    if (removedUserId)
        promises.push(removeUserDataFromProject(projectId, removedUserId, admin, firebase_tools, process, admin))

    const removedGlobalAssistantIds = difference(oldProject.globalAssistantIds, newProject.globalAssistantIds)
    const removedSomeGlobalAssistants = removedGlobalAssistantIds.length > 0

    if (removedSomeGlobalAssistants) {
        promises.push(removeDeletedGlobalAssistantChats(projectId, removedGlobalAssistantIds))
        promises.push(removeDeletedGlobalAssistantNotes(projectId, removedGlobalAssistantIds))
        promises.push(removeDeletedGlobalAssistantsFromObjectBacklinks(projectId, removedGlobalAssistantIds))
        promises.push(deleteTasksFromAssistantsInProject(projectId, removedGlobalAssistantIds))
        if (removedGlobalAssistantIds.includes(newProject.assistantId))
            promises.push(setProjectAssistant(newProject.id, ''))
    }
    if (newProject.isTemplate) {
        const addedGlobalAssistantIds = difference(newProject.globalAssistantIds, oldProject.globalAssistantIds)
        const addedSomeGlobalAssistants = addedGlobalAssistantIds.length > 0
        const updatedProjectAssistant = oldProject.assistantId !== newProject.assistantId
        if (removedSomeGlobalAssistants || addedSomeGlobalAssistants || updatedProjectAssistant) {
            const guideIds = await getTemplateGuideIds(projectId, admin)
            if (removedSomeGlobalAssistants)
                promises.push(removeSomeGlobalAssistantFromTemplateGuides(guideIds, removedGlobalAssistantIds, admin))
            if (addedSomeGlobalAssistants)
                promises.push(addSomeGlobalAssistantToTemplateGuides(guideIds, addedGlobalAssistantIds, admin))
            if (updatedProjectAssistant) {
                const isGlobalAssistant = newProject.globalAssistantIds.includes(newProject.assistantId)
                promises.push(
                    updateProjectAssistantToTemplateGuides(guideIds, newProject.assistantId, isGlobalAssistant, admin)
                )
            }
        }
    }

    if (!newProject.activeFullSearch && !oldProject.active && newProject.active && !newProject.parentTemplateId) {
        promises.push(startProjectIndexationInAlgolia([newProject], null))
    }

    await Promise.all(promises)
}

module.exports = { onUpdateProject }
