const admin = require('firebase-admin')

const { updateGoalDynamicProgress, updateGoalEditionData } = require('../Goals/goalsFirestore')
const { TASKS_OBJECTS_TYPE, createRecord } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked } = require('../Utils/HelperFunctionsCloud')
const { updateContactOpenTasksAmount } = require('../Firestore/contactsFirestore')
const { getNextTaskId } = require('../shared/taskIdGenerator')
const { routeNewTaskToGoal } = require('./taskGoalRouting')
const { routeNewTaskToProject } = require('./taskProjectRouting')
const { enqueueWorkflowAiRunIfNeeded } = require('./workflowAiStep')

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

const generateHumanReadableIdAsync = async (task, projectId, retryCount = 0) => {
    const MAX_RETRIES = 3
    const RETRY_DELAY_MS = 1000

    console.log(
        `[HumanReadableID] generateHumanReadableIdAsync called for task ${task.id}, current humanReadableId: ${task.humanReadableId}`
    )

    // Only generate if the task doesn't already have a human readable ID
    if (!task.humanReadableId) {
        try {
            console.log(`[HumanReadableID] Generating new ID for task ${task.id}, attempt ${retryCount + 1}`)
            const humanReadableId = await getNextTaskId(projectId)
            console.log(`[HumanReadableID] Generated ID: ${humanReadableId} for task ${task.id}`)

            // Use transaction to safely update the task with conflict protection
            const db = admin.firestore()
            const taskRef = db.doc(`items/${projectId}/tasks/${task.id}`)

            await db.runTransaction(async transaction => {
                console.log(`[HumanReadableID] Starting transaction to set ID ${humanReadableId} for task ${task.id}`)
                const taskDoc = await transaction.get(taskRef)

                if (!taskDoc.exists) {
                    console.warn(`[HumanReadableID] Task document no longer exists: ${task.id}`)
                    return
                }

                const currentTask = taskDoc.data()
                console.log(
                    `[HumanReadableID] Current task state - humanReadableId: ${currentTask.humanReadableId}, lastEditionDate: ${currentTask.lastEditionDate}`
                )

                // Only update if the task still doesn't have a human readable ID
                // This prevents overwriting an ID that might have been set during a race condition
                if (!currentTask.humanReadableId) {
                    console.log(`[HumanReadableID] Setting humanReadableId ${humanReadableId} for task ${task.id}`)
                    transaction.update(taskRef, {
                        humanReadableId: humanReadableId,
                    })
                    console.log(`[HumanReadableID] Transaction update queued for task ${task.id}`)
                } else {
                    console.log(
                        `[HumanReadableID] Task ${task.id} already has humanReadableId: ${currentTask.humanReadableId}`
                    )
                }
            })
            console.log(`[HumanReadableID] Transaction completed successfully for task ${task.id}`)
        } catch (error) {
            console.error(
                `[HumanReadableID] Failed to generate human readable ID for task ${task.id}, attempt ${
                    retryCount + 1
                }:`,
                error.message
            )

            // Retry logic for transactional conflicts or temporary failures
            if (
                retryCount < MAX_RETRIES &&
                (error.code === 'aborted' ||
                    error.code === 'deadline-exceeded' ||
                    error.code === 'unavailable' ||
                    error.message.includes('transaction') ||
                    error.message.includes('conflict'))
            ) {
                console.log(`[HumanReadableID] Retrying ID generation for task ${task.id} in ${RETRY_DELAY_MS}ms`)
                setTimeout(() => {
                    generateHumanReadableIdAsync(task, projectId, retryCount + 1)
                }, RETRY_DELAY_MS)
            } else {
                console.error(
                    `[HumanReadableID] Permanent failure for task ${task.id} after ${retryCount + 1} attempts`
                )
            }
        }
    } else {
        console.log(`[HumanReadableID] Task ${task.id} already has humanReadableId: ${task.humanReadableId}`)
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
    console.log(`[HumanReadableID] Starting generateHumanReadableIdAsync for task ${task.id}`)
    promises.push(generateHumanReadableIdAsync(task, projectId))
    if (task.workflowTask === true) {
        promises.push(
            enqueueWorkflowAiRunIfNeeded(projectId, task.id, {}, task).catch(error =>
                console.error('[workflowAiStep] Initial enqueue check failed', {
                    taskId: task.id,
                    error: error.message,
                })
            )
        )
    }

    await Promise.all(promises)

    // Automatic project selection runs LAST and on its own (AT-2306), for two
    // ordering reasons that are invisible until they bite:
    //
    // 1. A routed task is MOVED, which deletes this project's document. Anything
    //    above that is still writing to it would either fail (the human-readable
    //    id `update()`) or leave the moved copy without work that was supposed to
    //    be part of its creation. Once they have finished, the move carries their
    //    result with it (the human-readable id travels on the document) and the
    //    delete cascade cleans this project up (Algolia record, contact count).
    // 2. Goal routing must not run in a project the task is about to leave: goals
    //    are project-local and the move nulls `parentGoalId`, so the assignment
    //    would be undone the moment it is paid for. The moved copy routes its
    //    goal from its own onCreate in the target project instead.
    //
    // A task without an "Automatic" stamp — every task created the normal way —
    // returns 'skipped' before any read, so this is one no-op call for them.
    const projectRouting = await routeNewTaskToProject({ task, projectId }).catch(error => {
        console.error('[taskProjectRouting] Routing failed', { taskId: task.id, error: error.message })
        return { action: 'failed' }
    })
    if (projectRouting?.action !== 'moved') await routeNewTaskToGoal({ task, projectId })

    console.log(`[HumanReadableID] onCreateTask completed for task ${task.id}`)
}

module.exports = {
    onCreateTask,
}
