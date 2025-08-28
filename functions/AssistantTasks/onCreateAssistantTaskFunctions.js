const admin = require('firebase-admin')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { GLOBAL_PROJECT_ID, uploadNewAssistantTask } = require('../Firestore/assistantsFirestore')

const onCreateAssistantTask = async (projectId, assistantId, assistantTask) => {
    if (projectId !== GLOBAL_PROJECT_ID) {
        let promises = []
        promises.push(getProject(projectId, admin))
        promises.push(getTemplateGuideIds(projectId, admin))
        const [project, guideIds] = await Promise.all(promises)

        if (project && project.isTemplate) {
            promises = []
            guideIds.forEach(guideId => {
                assistantTask.id = guideId + assistantTask.id
                promises.push(uploadNewAssistantTask(admin, guideId, guideId + assistantId, assistantTask))
            })
            await Promise.all(promises)
        }
    }
}

module.exports = { onCreateAssistantTask }
