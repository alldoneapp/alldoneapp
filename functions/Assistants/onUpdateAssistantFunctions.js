const admin = require('firebase-admin')
const moment = require('moment')
const { isEqual } = require('lodash')

const { getProject, getTemplateGuideIds } = require('../Firestore/generalFirestoreCloud')
const {
    uploadNewAssistant,
    GLOBAL_PROJECT_ID,
    addGlobalAssistantToAllProject,
} = require('../Firestore/assistantsFirestore')
const { updateRecord, ASSISTANTS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')

const tryUpdateAssitantInGuides = async (oldAssistant, newAssistant, projectId) => {
    delete oldAssistant.lastEditorId
    delete oldAssistant.lastEditionDate
    delete oldAssistant.creatorId
    delete oldAssistant.createdDate
    delete oldAssistant.lastVisitBoard

    delete newAssistant.lastEditorId
    delete newAssistant.lastEditionDate
    delete newAssistant.creatorId
    delete newAssistant.createdDate
    delete newAssistant.lastVisitBoard

    const needUpdateGuides = !isEqual(oldAssistant, newAssistant)

    if (needUpdateGuides) {
        let promises = []
        promises.push(getProject(projectId, admin))
        promises.push(getTemplateGuideIds(projectId, admin))
        const [project, guideIds] = await Promise.all(promises)

        if (project && project.isTemplate) {
            promises = []
            guideIds.forEach(guideId => {
                const date = moment().valueOf()

                const assistant = {
                    ...newAssistant,
                    uid: guideId + newAssistant.uid,
                    lastEditorId: project.creatorId,
                    lastEditionDate: date,
                    creatorId: project.creatorId,
                    createdDate: date,
                    lastVisitBoard: {},
                    fromTemplate: true,
                }

                promises.push(uploadNewAssistant(admin, guideId, assistant, false))
            })
            await Promise.all(promises)
        }
    }
}

const onUpdateAssistant = async (projectId, assistantId, change) => {
    const oldAssistant = change.before.data()
    oldAssistant.uid = assistantId

    const newAssistant = change.after.data()
    newAssistant.uid = assistantId

    const promises = []
    promises.push(
        updateRecord(projectId, assistantId, oldAssistant, newAssistant, ASSISTANTS_OBJECTS_TYPE, admin.firestore())
    )
    if (projectId === GLOBAL_PROJECT_ID) {
        if (!oldAssistant.isDefault && newAssistant.isDefault) {
            promises.push(addGlobalAssistantToAllProject(admin, assistantId))
        }
    } else {
        promises.push(tryUpdateAssitantInGuides({ ...oldAssistant }, { ...newAssistant }, projectId))
    }
    await Promise.all(promises)
}

module.exports = { onUpdateAssistant }
