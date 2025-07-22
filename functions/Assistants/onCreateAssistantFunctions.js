const admin = require('firebase-admin')
const moment = require('moment')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const { uploadNewAssistant, GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const { createRecord, ASSISTANTS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')

const processNewAssistantInTemplate = async (projectId, assistant) => {
    if (projectId !== GLOBAL_PROJECT_ID) {
        let promises = []
        promises.push(getProject(projectId, admin))
        promises.push(getTemplateGuideIds(projectId, admin))
        const [project, guideIds] = await Promise.all(promises)

        if (project && project.isTemplate) {
            promises = []
            guideIds.forEach(guideId => {
                const date = moment().valueOf()

                const newAssistant = {
                    ...assistant,
                    uid: guideId + assistant.uid,
                    lastEditorId: project.creatorId,
                    lastEditionDate: date,
                    creatorId: project.creatorId,
                    createdDate: date,
                    lastVisitBoard: {},
                    fromTemplate: true,
                }

                promises.push(uploadNewAssistant(admin, guideId, newAssistant, false))
            })
            await Promise.all(promises)
        }
    }
}

const onCreateAssistant = async (projectId, assistant) => {
    const promises = []
    promises.push(processNewAssistantInTemplate(projectId, assistant))
    promises.push(
        createRecord(projectId, assistant.uid, assistant, ASSISTANTS_OBJECTS_TYPE, admin.firestore(), false, null)
    )
    await Promise.all(promises)
}

module.exports = { onCreateAssistant }
