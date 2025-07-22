const admin = require('firebase-admin')
const moment = require('moment')
const { isEqual } = require('lodash')

const { updateGoalDynamicProgress, updateGoalEditionData } = require('../Goals/goalsFirestore')
const { TASKS_OBJECTS_TYPE, updateRecord, createRecord, deleteRecord } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked, isWorkstream } = require('../Utils/HelperFunctionsCloud')
const { updateTaskEditionData, deleteTaskMetaData } = require('./tasksFirestoreCloud')
const { updateContactOpenTasksAmount } = require('../Firestore/contactsFirestore')
const { getUserWithTaskActive, resetActiveTaskDates, clearUserTaskInFocusIfMatch } = require('../Users/usersFirestore')
const { getActiveTaskRoundedStartAndEndDates } = require('../MyDay/myDayHelperCloud')

const proccessAlgoliaRecord = async (taskId, projectId, oldTask, newTask) => {
    if (oldTask.lockKey === newTask.lockKey) {
        const isLocked = await checkIfObjectIsLocked(projectId, newTask.lockKey, newTask.userId)
        if (!isLocked) {
            await updateRecord(projectId, taskId, oldTask, newTask, TASKS_OBJECTS_TYPE, admin.firestore())
        }
    } else {
        const promises = []
        promises.push(checkIfObjectIsLocked(projectId, oldTask.lockKey, oldTask.userId))
        promises.push(checkIfObjectIsLocked(projectId, newTask.lockKey, newTask.userId))
        const [oldIsLocked, newIsLocked] = await Promise.all(promises)
        if (!oldIsLocked && !newIsLocked) {
            await updateRecord(projectId, taskId, oldTask, newTask, TASKS_OBJECTS_TYPE, admin.firestore())
        } else if (oldIsLocked && !newIsLocked) {
            await createRecord(projectId, taskId, newTask, TASKS_OBJECTS_TYPE, admin.firestore(), false, null)
        } else if (!oldIsLocked && newIsLocked) {
            await deleteRecord(taskId, projectId, TASKS_OBJECTS_TYPE)
        }
    }
}

const proccessGoalDynamicProgress = async (projectId, oldTask, newTask) => {
    const promises = []
    if (
        oldTask.parentId !== newTask.parentId ||
        oldTask.done !== newTask.done ||
        oldTask.parentGoalId !== newTask.parentGoalId
    ) {
        if (oldTask.parentGoalId === newTask.parentGoalId) {
            promises.push(updateGoalDynamicProgress(projectId, newTask.parentGoalId))
        } else {
            promises.push(updateGoalDynamicProgress(projectId, newTask.parentGoalId))
            promises.push(updateGoalDynamicProgress(projectId, oldTask.parentGoalId))
        }
    }
    await Promise.all(promises)
}

const proccessAmountOpenTasksInContactAssignees = async (projectId, oldTask, newTask) => {
    let amountToAddToOldAssignee = 0
    let amountToAddToNewAssignee = 0
    if (oldTask.userId !== newTask.userId && !oldTask.inDone) {
        amountToAddToOldAssignee--
        amountToAddToNewAssignee++
    }
    if (oldTask.inDone !== newTask.inDone) {
        if (oldTask.inDone) {
            amountToAddToNewAssignee++
        } else if (oldTask.userId !== newTask.userId) {
            amountToAddToNewAssignee--
        } else {
            amountToAddToOldAssignee--
        }
    }
    const promises = []
    if (amountToAddToOldAssignee !== 0)
        promises.push(updateContactOpenTasksAmount(projectId, oldTask.userId, amountToAddToOldAssignee))
    if (amountToAddToNewAssignee !== 0)
        promises.push(updateContactOpenTasksAmount(projectId, newTask.userId, amountToAddToNewAssignee))
    await Promise.all(promises)
}

const checkIfNeedToResetActiveTaskDateWhenIfEstimationChanges = async (taskId, oldTask, newTask) => {
    const oldEstimation = oldTask.estimations || {}
    const newEstimation = newTask.estimations || {}

    const currentStepId = newTask.stepHistory[newTask.stepHistory.length - 1]
    const currentStepEstimationChanges = oldEstimation[currentStepId] !== newEstimation[currentStepId]

    const oldObserverEstimation = oldTask.estimationsByObserverIds || {}
    const newObserverEstimation = newTask.estimationsByObserverIds || {}
    const observerEstimationChanges = !isEqual(oldObserverEstimation, newObserverEstimation)

    if (currentStepEstimationChanges || observerEstimationChanges) {
        const users = await getUserWithTaskActive(taskId)
        const userToReset = []

        users.forEach(user => {
            if (currentStepEstimationChanges) {
                if (newTask.currentReviewerId === user.uid || isWorkstream(user.uid)) {
                    userToReset.push(user)
                }
            } else if (observerEstimationChanges) {
                if (oldObserverEstimation[user.uid] !== newObserverEstimation[user.uid]) {
                    userToReset.push(user)
                }
            }
        })

        const serverDateUtc = moment().utc().format('YYYY-MM-DD HH:mm:ss')
        const serverDateUtcValue = moment(serverDateUtc, 'YYYY-MM-DD HH:mm:ss').valueOf()

        const promises = []
        userToReset.forEach(user => {
            const { endDateUtcValue } = getActiveTaskRoundedStartAndEndDates(newTask, user.uid, serverDateUtcValue)
            promises.push(resetActiveTaskDates(user.uid, serverDateUtcValue, endDateUtcValue))
        })
        await Promise.all(promises)
    }
}

const onUpdateTask = async (taskId, projectId, change) => {
    const promises = []

    const oldTask = change.before.data()
    const newTask = change.after.data()

    promises.push(proccessGoalDynamicProgress(projectId, oldTask, newTask))
    promises.push(proccessAlgoliaRecord(taskId, projectId, oldTask, newTask))
    if (oldTask.parentGoalId !== newTask.parentGoalId) {
        if (oldTask.parentGoalId)
            promises.push(updateGoalEditionData(projectId, oldTask.parentGoalId, newTask.lastEditorId))

        if (newTask.parentGoalId)
            promises.push(updateGoalEditionData(projectId, newTask.parentGoalId, newTask.lastEditorId))
    } else if (oldTask.lastEditionDate !== newTask.lastEditionDate && newTask.parentGoalId) {
        promises.push(updateGoalEditionData(projectId, newTask.parentGoalId, newTask.lastEditorId))
    }
    if (newTask.parentId) {
        promises.push(updateTaskEditionData(projectId, newTask.parentId, newTask.lastEditorId))
    }
    promises.push(proccessAmountOpenTasksInContactAssignees(projectId, oldTask, newTask))

    const estimationExtendedInMyDay = newTask.metaData && newTask.metaData.estimationExtendedInMyDay
    if (!estimationExtendedInMyDay) {
        promises.push(checkIfNeedToResetActiveTaskDateWhenIfEstimationChanges(taskId, oldTask, newTask))
    }

    if (newTask.metaData) {
        promises.push(deleteTaskMetaData(projectId, taskId))
    }

    if (newTask.userId !== oldTask.userId || (newTask.isSubtask && !oldTask.isSubtask)) {
        promises.push(clearUserTaskInFocusIfMatch(oldTask.userId, taskId))
    }

    await Promise.all(promises)
}

module.exports = {
    onUpdateTask,
}
