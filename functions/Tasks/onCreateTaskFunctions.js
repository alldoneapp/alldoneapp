const admin = require('firebase-admin')

const { updateGoalDynamicProgress, updateGoalEditionData } = require('../Goals/goalsFirestore')
const { TASKS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked } = require('../Utils/HelperFunctionsCloud')
const { updateContactOpenTasksAmount } = require('../Firestore/contactsFirestore')
const { getNextTaskId } = require('../shared/taskIdGenerator')

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

const generateHumanReadableIdAsync = async (task, projectId) => {
    // Only generate if the task doesn't already have a human readable ID
    if (!task.humanReadableId) {
        try {
            const humanReadableId = await getNextTaskId(projectId)
            console.log('onCreateTask: Generated human readable ID:', humanReadableId, 'for task:', task.id)

            // Update the task document with the human readable ID
            const db = admin.firestore()
            await db.doc(`items/${projectId}/tasks/${task.id}`).update({
                humanReadableId: humanReadableId,
            })
        } catch (error) {
            console.warn('onCreateTask: Failed to generate human readable ID:', error.message)
            // Don't fail the entire onCreate process if ID generation fails
        }
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

    // Generate human readable ID asynchronously (non-blocking)
    promises.push(generateHumanReadableIdAsync(task, projectId))

    await Promise.all(promises)
}

module.exports = {
    onCreateTask,
}
