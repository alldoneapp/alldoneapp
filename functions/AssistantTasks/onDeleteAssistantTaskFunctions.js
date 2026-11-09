const admin = require('firebase-admin')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { GLOBAL_PROJECT_ID, deleteAssistantTask } = require('../Firestore/assistantsFirestore')
const { isGlobalCatalogTaskPath } = require('./globalCatalogTaskPath')

const deleteAssistantInGuidesWhenDeleteAssisntantInTemplate = async (projectId, assistantId, assistantTaskId) => {
    let promises = []
    promises.push(getProject(projectId, admin))
    promises.push(getTemplateGuideIds(projectId, admin))
    const [project, guideIds] = await Promise.all(promises)

    if (project && project.isTemplate) {
        promises = []
        guideIds.forEach(guideId => {
            promises.push(deleteAssistantTask(admin, guideId, guideId + assistantId, guideId + assistantTaskId))
        })
        await Promise.all(promises)
    }
}

const onDeleteAssistantTask = async (projectId, assistantId, assistantTaskId, deletedAssistantTask) => {
    if (projectId === GLOBAL_PROJECT_ID) {
        if (!isGlobalCatalogTaskPath(assistantId)) return
        const { propagateTemplateTaskChange } = require('../Assistants/templateSync')
        const previousTask = { ...(deletedAssistantTask || {}), id: assistantTaskId }
        await propagateTemplateTaskChange(previousTask.assistantId, previousTask, null, 'delete')
    } else {
        const promises = []
        promises.push(deleteAssistantInGuidesWhenDeleteAssisntantInTemplate(projectId, assistantId, assistantTaskId))
        await Promise.all(promises)
    }
}

module.exports = { onDeleteAssistantTask }
