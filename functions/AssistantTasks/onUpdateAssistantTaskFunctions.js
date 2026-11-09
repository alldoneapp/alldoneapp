const admin = require('firebase-admin')
const { isEqual } = require('lodash')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { GLOBAL_PROJECT_ID, uploadNewAssistantTask } = require('../Firestore/assistantsFirestore')
const { getTaskTemplateState } = require('../Assistants/templateMerge')
const { isGlobalCatalogTaskPath } = require('./globalCatalogTaskPath')

const onUpdateAssistantTask = async (projectId, assistantId, assistantTaskId, change) => {
    if (projectId === GLOBAL_PROJECT_ID) {
        if (!isGlobalCatalogTaskPath(assistantId)) return
        const previousTask = { ...change.before.data(), id: assistantTaskId }
        const currentTask = { ...change.after.data(), id: assistantTaskId }
        // Security audit 2026-11 (NV-22): users switch their own activation of a catalog task on and
        // off constantly. Those keys are local to every copy, so such an update changes nothing in
        // the template and must not rewrite every tenant's derived task and post a sync activity.
        if (isEqual(getTaskTemplateState(previousTask), getTaskTemplateState(currentTask))) return
        const { propagateTemplateTaskChange } = require('../Assistants/templateSync')
        await propagateTemplateTaskChange(
            currentTask.assistantId || previousTask.assistantId,
            previousTask,
            currentTask,
            'update'
        )
    } else {
        const newAssistantTask = change.after.data()
        newAssistantTask.id = assistantTaskId

        let promises = []
        promises.push(getProject(projectId, admin))
        promises.push(getTemplateGuideIds(projectId, admin))
        const [project, guideIds] = await Promise.all(promises)

        if (project && project.isTemplate) {
            promises = []
            guideIds.forEach(guideId => {
                const assistantTask = {
                    ...newAssistantTask,
                    id: guideId + newAssistantTask.id,
                }

                promises.push(uploadNewAssistantTask(admin, guideId, guideId + assistantId, assistantTask))
            })
            await Promise.all(promises)
        }
    }
}

module.exports = { onUpdateAssistantTask }
