const admin = require('firebase-admin')

const { updateGoalDynamicProgress, updateGoalEditionData } = require('../Goals/goalsFirestore')
const { TASKS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked } = require('../Utils/HelperFunctionsCloud')
const { updateContactOpenTasksAmount } = require('../Firestore/contactsFirestore')

const proccessAlgoliaRecord = async (task, projectId) => {
    const isLocked = await checkIfObjectIsLocked(projectId, task.lockKey, task.userId)
    if (!isLocked) {
        await createRecord(
            projectId,
            task.id,
            task,
            TASKS_OBJECTS_TYPE,
            admin.firestore(),
            task.isSubtask ? task.parentDone : task.done,
            null
        )
    }
}

const onCreateTask = async (task, projectId) => {
    const promises = []
    if (!task.parentId && task.parentGoalId) {
        promises.push(updateGoalDynamicProgress(projectId, task.parentGoalId))
    }
    if (task.parentGoalId) promises.push(updateGoalEditionData(projectId, task.parentGoalId, task.lastEditorId))
    promises.push(proccessAlgoliaRecord(task, projectId))
    if (!task.inDone) promises.push(updateContactOpenTasksAmount(projectId, task.userId, 1))
    await Promise.all(promises)
}

module.exports = {
    onCreateTask,
}
