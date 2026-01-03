const admin = require('firebase-admin')

const { createAssistantUpdatesChain } = require('../Feeds/assistantsFeedsChains')
const { logEvent } = require('../GAnalytics/GAnalytics')

const GLOBAL_PROJECT_ID = 'globalProject'

//ACCESS FUNCTIONS

const getAssistantData = async (appAdmin, projectId, assistantId) => {
    if (!assistantId) return null
    const assistant = (await appAdmin.firestore().doc(`assistants/${projectId}/items/${assistantId}`).get()).data()
    if (assistant) assistant.uid = assistantId
    return assistant
}

const getDefaultAssistantData = async appAdmin => {
    console.log('Debug: appAdmin type:', typeof appAdmin)
    console.log('Debug: appAdmin keys:', Object.keys(appAdmin))
    console.log('Debug: appAdmin firestore type:', typeof appAdmin.firestore)

    const assistantDoc = (
        await appAdmin
            .firestore()
            .collection(`assistants/${GLOBAL_PROJECT_ID}/items`)
            .where('isDefault', '==', true)
            .get()
    ).docs[0]
    return assistantDoc ? { ...assistantDoc.data(), uid: assistantDoc.id } : null
}

const getGlobalAssistantProjects = async (assistantId, appAdmin) => {
    const projectDocs = (
        await appAdmin
            .firestore()
            .collection(`projects`)
            .where('globalAssistantIds', 'array-contains', assistantId)
            .get()
    ).docs
    const projects = []
    projectDocs.forEach(doc => {
        projects.push({ ...doc.data(), id: doc.id })
    })
    return projects
}

async function getGlobalAssistants(appAdmin) {
    const assistantDocs = (await appAdmin.firestore().collection(`assistants/${GLOBAL_PROJECT_ID}/items`).get()).docs
    const assistants = []
    assistantDocs.forEach(doc => {
        const assistant = doc.data()
        assistant.uid = doc.id
        assistants.push(assistant)
    })
    return assistants
}

async function getProjectAssistants(appAdmin, projectId) {
    const assistantDocs = (await appAdmin.firestore().collection(`/assistants/${projectId}/items`).get()).docs
    const assistants = []
    assistantDocs.forEach(doc => {
        assistants.push({ uid: doc.id, ...doc.data() })
    })
    return assistants
}

//EDTION AND ADITION FUNCTIONS

const updateAssistantEditionData = async (projectId, assistantId, editorId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`assistants/${projectId}/items/${assistantId}`)
            const assistantDoc = await transaction.get(ref)
            if (assistantDoc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

async function uploadNewAssistant(appAdmin, projectId, assistant, generateFeed) {
    const assistantCopy = { ...assistant }
    delete assistantCopy.uid

    const promises = []

    promises.push(appAdmin.firestore().doc(`assistants/${projectId}/items/${assistant.uid}`).set(assistantCopy))
    if (generateFeed) promises.push(createAssistantUpdatesChain(projectId, assistant, false, false))
    promises.push(logEvent('', 'new_assistant', { id: assistant.uid }))
    await Promise.all(promises)
}

const updateAssistantData = async (appAdmin, projectId, assistantId, data) => {
    await appAdmin.firestore().doc(`assistants/${projectId}/items/${assistantId}`).update(data)
}

const uploadNewAssistantTask = async (appAdmin, projectId, assistantId, assistantTask) => {
    const assistantTaskId = assistantTask.id
    delete assistantTask.id
    await appAdmin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${assistantTaskId}`).set(assistantTask)
}

const deleteAssistant = async (appAdmin, projectId, assistantId) => {
    await appAdmin.firestore().doc(`assistants/${projectId}/items/${assistantId}`).delete()
}

const deleteAssistantTask = async (appAdmin, projectId, assistantId, assistantTaskId) => {
    await appAdmin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${assistantTaskId}`).delete()
}

const deleteAssistantTasks = async (appAdmin, projectId, assistantId) => {
    const taskDocs = (await appAdmin.firestore().collection(`assistantTasks/${projectId}/${assistantId}`).get()).docs
    const promises = []
    taskDocs.forEach(doc => {
        promises.push(deleteAssistantTask(appAdmin, projectId, assistantId, doc.id))
    })
    await Promise.all(promises)
}

const updateAssistantLastCommentData = async (projectId, assistantId, lastComment, lastCommentType) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`assistants/${projectId}/items/${assistantId}`)
            const assistantDoc = await transaction.get(ref)
            if (assistantDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: lastCommentType,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

const resetAssistantLastCommentData = async (projectId, assistantId) => {
    try {
        await admin.firestore().runTransaction(async transaction => {
            const ref = admin.firestore().doc(`assistants/${projectId}/items/${assistantId}`)
            const assistantDoc = await transaction.get(ref)
            if (assistantDoc.exists)
                transaction.update(ref, {
                    [`commentsData.lastComment`]: null,
                    [`commentsData.lastCommentType`]: null,
                    [`commentsData.amount`]: 0,
                })
        })
    } catch (e) {
        console.log('Transaction failure:', e)
    }
}

async function addGlobalAssistantToAllProject(appAdmin, assistantId) {
    const projectDocs = (await appAdmin.firestore().collection(`projects`).get()).docs

    const promises = []
    projectDocs.forEach(doc => {
        promises.push(
            appAdmin
                .firestore()
                .doc(`projects/${doc.id}`)
                .update({ globalAssistantIds: appAdmin.firestore.FieldValue.arrayUnion(assistantId) })
        )
    })
    await Promise.all(promises)
}

module.exports = {
    getAssistantData,
    uploadNewAssistant,
    deleteAssistant,
    getGlobalAssistantProjects,
    uploadNewAssistantTask,
    deleteAssistantTask,
    deleteAssistantTasks,
    addGlobalAssistantToAllProject,
    getDefaultAssistantData,
    GLOBAL_PROJECT_ID,
    getGlobalAssistants,
    updateAssistantData,
    getProjectAssistants,
    updateAssistantEditionData,
    updateAssistantLastCommentData,
    resetAssistantLastCommentData,
}
