const admin = require('firebase-admin')
const firebase_tools = require('firebase-tools')

const { removeAlgoliaRecordsInProject } = require('../AlgoliaGlobalSearchHelper')
const { recursiveDeleteHelper } = require('../Utils/HelperFunctionsCloud')

const removeProjectData = async (projectId, admin, firebase_tools, process) => {
    const basePaths = [
        'assistantTasks',
        'assistants',
        'chatComments',
        'chatNotifications',
        'chatObjects',
        'events',
        'feedsCount',
        'feedsObjectsLastStates',
        'feedsStore',
        'followers',
        'goals',
        'goalsMilestones',
        'invoiceData',
        'items',
        'noteItems',
        'noteItemsDailyVersions',
        'noteItemsVersions',
        'projectsContacts',
        'projectsFeeds',
        'projectsInnerFeeds',
        'projectsInvitation',
        'projectsWorkstreams',
        'skills',
        'skillsDefaultPrivacy',
        'statistics',
        'tagsColors',
        'usersFollowing',
    ]

    const deletePromises = []

    basePaths.forEach(basePath => {
        const path = `${basePath}/${projectId}`
        deletePromises.push(recursiveDeleteHelper(firebase_tools, process.env.GCLOUD_PROJECT, path))
    })

    const getPromises = []
    getPromises.push(admin.firestore().collection(`notesDeleted`).where('projectId', '==', projectId).get())
    getPromises.push(admin.firestore().collection(`stickyNotesData`).where('projectId', '==', projectId).get())
    const [notesDeletedDocs, stickyNotesDataDocs] = await Promise.all(getPromises)

    notesDeletedDocs.forEach(doc => {
        deletePromises.push(admin.firestore().doc(`notesDeleted/${doc.id}`).delete())
    })

    stickyNotesDataDocs.forEach(doc => {
        deletePromises.push(admin.firestore().doc(`stickyNotesData/${doc.id}`).delete())
    })

    await Promise.all(deletePromises)
}

const onDeleteProject = async projectId => {
    const promises = []
    promises.push(removeProjectData(projectId, admin, firebase_tools, process))
    promises.push(removeAlgoliaRecordsInProject(projectId))
    await Promise.all(promises)
}

module.exports = { onDeleteProject }
