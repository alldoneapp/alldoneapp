const admin = require('firebase-admin')
const moment = require('moment')
const { isEqual } = require('lodash')
const { google } = require('googleapis')

const { updateGoalDynamicProgress, updateGoalEditionData } = require('../Goals/goalsFirestore')
const { TASKS_OBJECTS_TYPE, updateRecord, createRecord, deleteRecord } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked, isWorkstream } = require('../Utils/HelperFunctionsCloud')
const { updateTaskEditionData, deleteTaskMetaData } = require('./tasksFirestoreCloud')
const { updateContactOpenTasksAmount } = require('../Firestore/contactsFirestore')
const { getUserWithTaskActive, resetActiveTaskDates, clearUserTaskInFocusIfMatch } = require('../Users/usersFirestore')
const { getActiveTaskRoundedStartAndEndDates } = require('../MyDay/myDayHelperCloud')
const { createRecurringTaskInCloudFunction } = require('./recurringTasksCloud')
const { createTaskSomedaySelectedFeed } = require('../Feeds/tasksFeeds')
const { BACKLOG_DATE_NUMERIC } = require('../Utils/HelperFunctionsCloud')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { earnGold } = require('../Gold/goldHelper')

const GMAIL_LABEL_FOLLOW_UP_TASK_ORIGIN = 'gmail_label_follow_up'
const MAX_GOLD_TO_EARN_BY_CHECK_TASKS = 5

const getRewardGoldAmount = (maxGold, rewardKey) => {
    const normalizedMaxGold = Number(maxGold)
    if (!Number.isFinite(normalizedMaxGold) || normalizedMaxGold <= 0) return 0

    if (!rewardKey) {
        return Math.floor(Math.random() * normalizedMaxGold) + 1
    }

    let hash = 0
    for (let i = 0; i < rewardKey.length; i++) {
        hash = (hash * 31 + rewardKey.charCodeAt(i)) % 2147483647
    }

    return (Math.abs(hash) % normalizedMaxGold) + 1
}

const buildTaskProgressReward = (taskId, oldTask = {}, newTask = {}) => {
    if (!taskId) {
        console.log('[gold][fallback] Skipping task reward because taskId is missing')
        return null
    }

    if (newTask.parentId) {
        console.log('[gold][fallback] Skipping task reward for subtask', {
            taskId,
            parentId: newTask.parentId,
        })
        return null
    }

    const oldUserIds = Array.isArray(oldTask.userIds) ? oldTask.userIds : []
    const newUserIds = Array.isArray(newTask.userIds) ? newTask.userIds : []
    const movedForwardInWorkflow = !oldTask.done && !newTask.done && newUserIds.length > oldUserIds.length
    const completedNow = !oldTask.done && newTask.done

    if (!movedForwardInWorkflow && !completedNow) {
        console.log('[gold][fallback] Skipping task reward because task did not advance or complete now', {
            taskId,
            oldDone: !!oldTask.done,
            newDone: !!newTask.done,
            oldUserIdsLength: oldUserIds.length,
            newUserIdsLength: newUserIds.length,
        })
        return null
    }

    const timestamp = Number(newTask.completed)
    const currentReviewerId = newTask.currentReviewerId
    if (!Number.isFinite(timestamp) || currentReviewerId == null) {
        console.log('[gold][fallback] Skipping task reward because completed timestamp or reviewer is invalid', {
            taskId,
            completed: newTask.completed,
            currentReviewerId,
        })
        return null
    }

    const userId = oldUserIds.length > 1 ? oldUserIds[oldUserIds.length - 1] : newTask.userId
    if (typeof userId !== 'string' || userId.trim() === '') {
        console.log('[gold][fallback] Skipping task reward because reward user could not be resolved', {
            taskId,
            taskUserId: newTask.userId,
            oldUserIds,
            newUserIds,
        })
        return null
    }

    const rewardKey = `task_progress:${taskId}:${timestamp}:${currentReviewerId}`
    const rewardMoment = moment(timestamp)

    const reward = {
        gold: getRewardGoldAmount(MAX_GOLD_TO_EARN_BY_CHECK_TASKS, rewardKey),
        rewardKey,
        slimDate: rewardMoment.format('DDMMYYYY'),
        timestamp,
        dayDate: parseInt(rewardMoment.format('YYYYMMDD')),
        userId,
    }

    console.log('[gold][fallback] Built task reward payload', {
        taskId,
        rewardUserId: reward.userId,
        rewardKey: reward.rewardKey,
        gold: reward.gold,
        timestamp: reward.timestamp,
        completedNow,
        movedForwardInWorkflow,
        currentReviewerId,
    })

    return reward
}

const isGmailTaskWithArchiveOnComplete = (gmailData = null) => {
    return (
        gmailData &&
        gmailData.origin === GMAIL_LABEL_FOLLOW_UP_TASK_ORIGIN &&
        typeof gmailData.messageId === 'string' &&
        gmailData.messageId.trim() !== '' &&
        gmailData.archiveOnComplete === true
    )
}

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

async function updateTaskGmailArchiveStatus(projectId, taskId, gmailData, archiveStatus) {
    await admin
        .firestore()
        .doc(`items/${projectId}/tasks/${taskId}`)
        .update({
            gmailData: {
                ...gmailData,
                archiveStatus,
            },
        })
}

const shouldArchiveGmailTask = (oldTask, newTask) => {
    const completedNow = !oldTask.done && newTask.done
    const postponedNow =
        typeof oldTask.dueDate === 'number' && typeof newTask.dueDate === 'number' && newTask.dueDate > oldTask.dueDate

    return completedNow || postponedNow
}

async function archiveGmailTaskIfNeeded(projectId, taskId, oldTask, newTask) {
    if (!shouldArchiveGmailTask(oldTask, newTask)) return

    const gmailData = newTask.gmailData || null
    if (!isGmailTaskWithArchiveOnComplete(gmailData)) return
    if (gmailData.archiveStatus?.state === 'completed') return

    const archiveStatusBase = {
        attemptedAt: Date.now(),
        messageId: gmailData.messageId,
    }

    try {
        const gmail = await getGmailClient(newTask.userId, gmailData.projectId || projectId)
        await gmail.users.messages.modify({
            userId: 'me',
            id: gmailData.messageId,
            requestBody: {
                removeLabelIds: ['INBOX'],
            },
        })

        await updateTaskGmailArchiveStatus(projectId, taskId, gmailData, {
            ...archiveStatusBase,
            state: 'completed',
            completedAt: Date.now(),
            error: '',
        })
    } catch (error) {
        await updateTaskGmailArchiveStatus(projectId, taskId, gmailData, {
            ...archiveStatusBase,
            state: 'failed',
            error: error.message || 'Failed to archive Gmail message.',
        })
    }
}

const awardGoldForTaskProgress = async (projectId, taskId, oldTask, newTask) => {
    const reward = buildTaskProgressReward(taskId, oldTask, newTask)
    if (!reward) return

    console.log('[gold][fallback] Calling earnGold from onUpdateTask fallback', {
        projectId,
        taskId,
        rewardUserId: reward.userId,
        rewardKey: reward.rewardKey,
        gold: reward.gold,
    })

    const result = await earnGold(
        projectId,
        reward.userId,
        reward.gold,
        reward.slimDate,
        reward.timestamp,
        reward.dayDate,
        {
            rewardKey: reward.rewardKey,
            objectId: taskId,
            objectType: 'task',
        }
    )

    console.log('[gold][fallback] earnGold fallback completed', {
        projectId,
        taskId,
        rewardUserId: reward.userId,
        rewardKey: reward.rewardKey,
        success: !!result?.success,
        alreadyProcessed: !!result?.alreadyProcessed,
        amount: result?.amount || 0,
        message: result?.message || '',
    })
}

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

const getTaskNoteTitle = task => {
    const taskName = `${task?.extendedName || task?.name || ''}`.trim()
    if (!task?.calendarData?.start) return taskName

    const { start } = task.calendarData
    const startValue = start.dateTime || start.date
    const startMoment = startValue ? moment(startValue) : null

    if (!startMoment || !startMoment.isValid()) return taskName

    const dateText = startMoment.format('DD.MM.YYYY')
    const timeText = start.dateTime ? startMoment.format('HH:mm') : 'All day'

    return `${dateText} ${timeText} ${taskName}`.trim()
}

const syncLinkedNoteTitle = async (projectId, oldTask, newTask) => {
    if (!newTask.noteId) return

    const oldTitle = getTaskNoteTitle(oldTask)
    const newTitle = getTaskNoteTitle(newTask)
    if (oldTitle === newTitle) return

    await admin.firestore().doc(`noteItems/${projectId}/notes/${newTask.noteId}`).update({
        title: newTitle.toLowerCase(),
        extendedTitle: newTitle,
        lastEditionDate: Date.now(),
        lastEditorId: newTask.lastEditorId,
    })
}

const onUpdateTask = async (taskId, projectId, change) => {
    const promises = []

    const oldTask = change.before.data()
    const newTask = change.after.data()

    console.log(`🚨🚨🚨 CLOUD FUNCTION TRIGGERED: onUpdateTask for task ${taskId} 🚨🚨🚨`)
    console.log(`[HumanReadableID] onUpdateTask triggered for task ${taskId}`)
    console.log(`[HumanReadableID] Old humanReadableId: ${oldTask.humanReadableId}`)
    console.log(`[HumanReadableID] New humanReadableId: ${newTask.humanReadableId}`)
    console.log(`[HumanReadableID] LastEditionDate changed: ${oldTask.lastEditionDate !== newTask.lastEditionDate}`)

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
    promises.push(syncLinkedNoteTitle(projectId, oldTask, newTask))
    promises.push(archiveGmailTaskIfNeeded(projectId, taskId, oldTask, newTask))
    promises.push(awardGoldForTaskProgress(projectId, taskId, oldTask, newTask))

    // Handle recurring task creation when task is completed
    // Skip assistant tasks - they have their own recurring logic in assistantRecurringTasks.js
    const isAssistantTask = newTask.assigneeType === 'assistant' || newTask.assistantId

    if (!isAssistantTask && newTask.recurrence && newTask.recurrence !== 'never') {
        console.log('🔄 RECURRING TASK CHECK:', {
            taskId,
            projectId,
            taskName: newTask.name,
            oldTaskDone: oldTask.done,
            newTaskDone: newTask.done,
            recurrence: newTask.recurrence,
            userIds: newTask.userIds,
            userIdsLength: newTask.userIds ? newTask.userIds.length : 0,
        })

        if (!oldTask.done && newTask.done && newTask.userIds && newTask.userIds.length === 1) {
            console.log('✅ CONDITIONS MET: Creating recurring task for completed task:', {
                taskId,
                projectId,
                recurrence: newTask.recurrence,
                taskName: newTask.name,
                userIds: newTask.userIds,
            })
            promises.push(createRecurringTaskInCloudFunction(projectId, taskId, newTask))
        } else {
            console.log('❌ CONDITIONS NOT MET: Skipping recurring task creation because:', {
                taskId,
                taskName: newTask.name,
                reasons: {
                    taskNotJustCompleted: oldTask.done || !newTask.done,
                    multipleAssignees: !newTask.userIds || newTask.userIds.length > 1,
                    noUserIds: !newTask.userIds,
                },
            })
        }
    }

    // Check if task was randomly selected from Someday
    if (
        oldTask.dueDate === BACKLOG_DATE_NUMERIC &&
        newTask.dueDate !== BACKLOG_DATE_NUMERIC &&
        newTask.randomlySelectedFromSomeday
    ) {
        console.log('🎲 SOMEDAY TASK SELECTED:', {
            taskId,
            projectId,
            taskName: newTask.name,
            oldDueDate: oldTask.dueDate,
            newDueDate: newTask.dueDate,
        })

        const batch = admin.firestore().batch()
        const feedUser = {
            uid: newTask.lastEditorId,
            displayName: newTask.lastEditorName,
        }

        promises.push(createTaskSomedaySelectedFeed(projectId, newTask, taskId, batch, feedUser, true))

        // Commit the batch after all promises resolve
        await Promise.all(promises)
        await batch.commit()

        return
    }

    await Promise.all(promises)
}

module.exports = {
    archiveGmailTaskIfNeeded,
    buildTaskProgressReward,
    isGmailTaskWithArchiveOnComplete,
    onUpdateTask,
    shouldArchiveGmailTask,
}
