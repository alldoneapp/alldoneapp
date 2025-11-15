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
    const startTime = Date.now()
    console.log(`[onUpdateProject] Function triggered for projectId: ${projectId}`)

    // Track which fields changed (ALL fields to diagnose phantom updates)
    const allChangedFields = []
    const allOldFields = Object.keys(oldProject)
    const allNewFields = Object.keys(newProject)
    const allFields = [...new Set([...allOldFields, ...allNewFields])]

    allFields.forEach(field => {
        const oldValue = JSON.stringify(oldProject[field])
        const newValue = JSON.stringify(newProject[field])
        if (oldValue !== newValue) {
            allChangedFields.push(field)
        }
    })

    // Track which relevant fields changed
    const changedFields = []
    const relevantFields = [
        'userIds',
        'globalAssistantIds',
        'assistantId',
        'active',
        'activeFullSearch',
        'monthlyXp',
        'monthlyTraffic',
        'parentTemplateId',
    ]

    relevantFields.forEach(field => {
        const oldValue = JSON.stringify(oldProject[field])
        const newValue = JSON.stringify(newProject[field])
        if (oldValue !== newValue) {
            changedFields.push({
                field,
                oldValue: oldProject[field],
                newValue: newProject[field],
            })
        }
    })

    // Log ALL changed fields to diagnose phantom updates
    if (allChangedFields.length > 0) {
        console.log(`[onUpdateProject] ALL changed fields: ${allChangedFields.join(', ')}`)
    }
    console.log(`[onUpdateProject] Relevant changed fields:`, JSON.stringify(changedFields))

    // Early return if no relevant fields changed
    if (changedFields.length === 0) {
        console.log(`[onUpdateProject] No relevant fields changed, skipping execution for projectId: ${projectId}`)
        return
    }

    const promises = []
    const executionReasons = []

    // Only run quota warnings if quota-related fields changed
    const quotaFieldsChanged = changedFields.some(c => ['monthlyXp', 'monthlyTraffic'].includes(c.field))
    if (quotaFieldsChanged) {
        console.log(`[onUpdateProject] Quota fields changed, generating project warnings`)
        executionReasons.push('quota_check')
        promises.push(generateProjectWarnings(projectId, oldProject, newProject, admin))
    } else {
        console.log(`[onUpdateProject] Quota fields unchanged, skipping generateProjectWarnings`)
    }

    const removedUserId = difference(oldProject.userIds, newProject.userIds)[0]
    if (removedUserId) {
        console.log(`[onUpdateProject] User removed from project: ${removedUserId}`)
        executionReasons.push(`user_removed:${removedUserId}`)
        promises.push(removeUserDataFromProject(projectId, removedUserId, admin, firebase_tools, process, admin))
    }

    const removedGlobalAssistantIds = difference(oldProject.globalAssistantIds, newProject.globalAssistantIds)
    const removedSomeGlobalAssistants = removedGlobalAssistantIds.length > 0

    if (removedSomeGlobalAssistants) {
        console.log(`[onUpdateProject] Global assistants removed: ${removedGlobalAssistantIds.join(', ')}`)
        executionReasons.push(`assistants_removed:${removedGlobalAssistantIds.length}`)

        promises.push(removeDeletedGlobalAssistantChats(projectId, removedGlobalAssistantIds))
        promises.push(removeDeletedGlobalAssistantNotes(projectId, removedGlobalAssistantIds))
        promises.push(removeDeletedGlobalAssistantsFromObjectBacklinks(projectId, removedGlobalAssistantIds))
        promises.push(deleteTasksFromAssistantsInProject(projectId, removedGlobalAssistantIds))

        // FIX: Only update assistantId if it's not already empty (prevents recursive trigger)
        if (removedGlobalAssistantIds.includes(newProject.assistantId) && newProject.assistantId !== '') {
            console.log(
                `[onUpdateProject] Active assistant was removed, clearing assistantId (old: ${newProject.assistantId})`
            )
            executionReasons.push('clear_active_assistant')
            promises.push(setProjectAssistant(newProject.id, ''))
        } else if (removedGlobalAssistantIds.includes(newProject.assistantId)) {
            console.log(`[onUpdateProject] Active assistant was removed but assistantId already empty, skipping update`)
        }
    }

    // DEPRECATED: Template-to-guides cascade feature has been deactivated
    // if (newProject.isTemplate) {
    //     const addedGlobalAssistantIds = difference(newProject.globalAssistantIds, oldProject.globalAssistantIds)
    //     const addedSomeGlobalAssistants = addedGlobalAssistantIds.length > 0
    //     const updatedProjectAssistant = oldProject.assistantId !== newProject.assistantId
    //     if (removedSomeGlobalAssistants || addedSomeGlobalAssistants || updatedProjectAssistant) {
    //         const guideIds = await getTemplateGuideIds(projectId, admin)
    //         if (removedSomeGlobalAssistants)
    //             promises.push(removeSomeGlobalAssistantFromTemplateGuides(guideIds, removedGlobalAssistantIds, admin))
    //         if (addedSomeGlobalAssistants)
    //             promises.push(addSomeGlobalAssistantToTemplateGuides(guideIds, addedGlobalAssistantIds, admin))
    //         if (updatedProjectAssistant) {
    //             const isGlobalAssistant = newProject.globalAssistantIds.includes(newProject.assistantId)
    //             promises.push(
    //                 updateProjectAssistantToTemplateGuides(guideIds, newProject.assistantId, isGlobalAssistant, admin)
    //             )
    //         }
    //     }
    // }

    if (!newProject.activeFullSearch && !oldProject.active && newProject.active && !newProject.parentTemplateId) {
        console.log(`[onUpdateProject] Project activated, starting Algolia indexation`)
        executionReasons.push('algolia_indexation_start')
        promises.push(startProjectIndexationInAlgolia([newProject], null))
    }

    console.log(`[onUpdateProject] Execution reasons: ${executionReasons.join(', ')}`)
    console.log(`[onUpdateProject] Executing ${promises.length} operations for projectId: ${projectId}`)

    await Promise.all(promises)

    const executionTime = Date.now() - startTime
    console.log(`[onUpdateProject] Completed for projectId: ${projectId} in ${executionTime}ms`)
}

module.exports = { onUpdateProject }
