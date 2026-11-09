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
const { bumpProjectToolSchemasCacheVersion } = require('../Assistant/toolSchemaCacheVersion')
const {
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForAssistant,
} = require('../Assistant/assistantHeartbeatSchedule')

const HEARTBEAT_SCHEDULE_FIELDS = [
    'heartbeatPrompt',
    'heartbeatIntervalMs',
    'heartbeatAwakeStart',
    'heartbeatAwakeEnd',
    'heartbeatChancePercent',
    'heartbeatChanceNoReplyPercent',
    'isDefault',
    // What a heartbeat runs as a member; a change makes earlier confirmations stale (NV-17).
    'allowedTools',
    'instructions',
    'mcpServers',
]

function heartbeatScheduleSettingsChanged(oldAssistant, newAssistant) {
    return HEARTBEAT_SCHEDULE_FIELDS.some(field => !isEqual(oldAssistant?.[field], newAssistant?.[field]))
}

function heartbeatConfigChanged(oldAssistant, newAssistant) {
    const { HEARTBEAT_CONFIG_FIELDS } = require('../Assistant/heartbeatOptIn')
    return HEARTBEAT_CONFIG_FIELDS.some(field => !isEqual(oldAssistant?.[field], newAssistant?.[field]))
}

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
        const { propagateTemplateAssistantUpdate } = require('./templateSync')
        promises.push(
            propagateTemplateAssistantUpdate({ ...oldAssistant }, { ...newAssistant }).catch(error => {
                console.error('Template assistant propagation failed', { assistantId, error })
                throw error
            })
        )
        if (!oldAssistant.isDefault && newAssistant.isDefault) {
            promises.push(addGlobalAssistantToAllProject(admin, assistantId))
        }
    } else {
        promises.push(tryUpdateAssitantInGuides({ ...oldAssistant }, { ...newAssistant }, projectId))
        if (heartbeatScheduleSettingsChanged(oldAssistant, newAssistant)) {
            // While a project has one member, only that member can have changed what the heartbeat
            // runs, so their confirmation follows the change; in a shared project it goes stale (NV-17).
            const confirm = heartbeatConfigChanged(oldAssistant, newAssistant)
                ? require('../Assistant/heartbeatOptIn').confirmHeartbeatsForSoleMember({
                      db: admin.firestore(),
                      projectId,
                      assistantId,
                  })
                : Promise.resolve()
            promises.push(
                confirm.then(() =>
                    safelySyncHeartbeatSchedules(() => syncHeartbeatSchedulesForAssistant(projectId, assistantId), {
                        source: 'assistant_updated',
                        projectId,
                        assistantId,
                    })
                )
            )
        }
    }
    promises.push(bumpProjectToolSchemasCacheVersion(projectId, 'assistant_updated'))
    await Promise.all(promises)
}

module.exports = { onUpdateAssistant, heartbeatScheduleSettingsChanged, heartbeatConfigChanged }
