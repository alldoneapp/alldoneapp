const admin = require('firebase-admin')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { GLOBAL_PROJECT_ID, uploadNewAssistantTask } = require('../Firestore/assistantsFirestore')

const onUpdateAssistantTask = async (projectId, assistantId, assistantTaskId, change) => {
    if (projectId === GLOBAL_PROJECT_ID) {
        const { propagateTemplateTaskChange } = require('../Assistants/templateSync')
        const previousTask = { ...change.before.data(), id: assistantTaskId }
        const currentTask = { ...change.after.data(), id: assistantTaskId }
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
