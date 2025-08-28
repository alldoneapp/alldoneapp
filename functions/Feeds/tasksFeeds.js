const moment = require('moment')
const {
    generateCurrentDateObject,
    generateFeedModel,
    loadFeedObject,
    addPrivacyForFeedObject,
    getDateFormat,
    getEstimationType,
    getEstimationResume,
    getEstimationRealValue,
    getDoneTimeValue,
    proccessFeed,
} = require('./globalFeedsHelper')
const {
    FEED_TASK_CREATED,
    FEED_TASK_FOLLOWED,
    FEED_TASK_PRIVACY_CHANGED,
    FEED_TASK_DESCRIPTION,
    FEED_TASK_DUE_DATE_CHANGED,
    FEED_TASK_PARENT_GOAL,
    FEED_TASK_HIGHLIGHTED_CHANGED,
    FEED_TASK_RECURRENCE_CHANGED,
    FEED_TASK_ASSIGNEE_ESTIMATION_CHANGED,
} = require('./FeedsConstants')
const { generateTaskObjectModel, updateTasksFeedsAmountOfSubtasks } = require('./tasksFeedsHelper')
const {
    getTaskNameWithoutMeta,
    RECURRENCE_MAP,
    ESTIMATION_TYPE_TIME,
    TIME_TEXT_DEFAULT_MINI,
    ESTIMATION_TYPE_POINTS,
} = require('../Utils/HelperFunctionsCloud')
const { shrinkTagText } = require('../Utils/parseTextUtils')

async function createTaskCreatedFeed(
    projectId,
    task,
    taskId,
    batch,
    feedUser,
    needGenerateNotification,
    contextOverrides = {}
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = generateTaskObjectModel(currentMilliseconds, task, taskId)

    const isSubtask = task.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'created subtask' : 'created task',
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    batch.feedObjects = { [taskId]: taskFeedObject }

    taskFeedObject.parentName = task.parentName ? task.parentName : ''

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification,
        contextOverrides
    )

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, 1, batch)
    }
}

async function createTaskFollowedFeed(
    projectId,
    taskId,
    batch,
    feedUser,
    needGenerateNotification,
    contextOverrides = {}
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'started following the subtask' : 'started following the task',
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification,
        contextOverrides
    )
}

async function createTaskPrivacyChangedFeed(
    projectId,
    taskId,
    isPrivate,
    isPublicFor,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    await addPrivacyForFeedObject(
        projectId,
        isPrivate,
        taskFeedObject,
        taskId,
        'tasks',
        isPrivate ? (isPublicFor ? isPublicFor : [taskFeedObject.userId]) : [FEED_PUBLIC_FOR_ALL]
    )

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createTaskDescriptionChangedFeed(
    projectId,
    oldDescription,
    newDescription,
    taskId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const simpleNewDesc = shrinkTagText(getTaskNameWithoutMeta(newDescription, true), 50)
    const simpleOldDesc = shrinkTagText(getTaskNameWithoutMeta(oldDescription, true), 50)

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_DESCRIPTION,
        lastChangeDate: currentMilliseconds,
        entryText: `changed ${isSubtask ? 'subtask' : 'task'} description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createTaskDueDateChangedFeed(
    projectId,
    newDueDate,
    oldDueDate,
    taskId,
    batch,
    newInBacklog,
    oldInBacklog,
    isObservedTask,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const isSubtask = taskFeedObject.parentId ? true : false

    const oldDueDateFormated = moment(oldDueDate).format(getDateFormat())
    const newDueDateFormated = moment(newDueDate).format(getDateFormat())

    let entryText = ''
    if (isSubtask) {
        entryText = 'turned subtask into task • By '
        entryText += newInBacklog ? `sending it to Someday` : `changing Reminder to  ${newDueDateFormated}`
    } else {
        entryText = isObservedTask ? 'changed observer reminder • From ' : 'changed reminder • From '
        entryText += newInBacklog
            ? `${oldDueDateFormated} to Someday`
            : oldInBacklog
            ? `Someday to ${newDueDateFormated}`
            : `${oldDueDateFormated} to ${newDueDateFormated}`
    }

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_DUE_DATE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    const { parentId } = taskFeedObject
    taskFeedObject.parentId = null

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, parentId, taskId, currentDateFormated, -1, batch)
    }
}

async function createTaskParentGoalChangedFeed(
    projectId,
    newParentGoalId,
    oldParentGoalId,
    taskId,
    turnedToTask,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_PARENT_GOAL,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    feed.newParentGoalId = newParentGoalId
    feed.oldParentGoalId = oldParentGoalId
    feed.isSubtask = isSubtask
    feed.turnedToTask = turnedToTask

    const { parentId } = taskFeedObject
    if (turnedToTask) {
        taskFeedObject.parentId = null
    }

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, parentId, taskId, currentDateFormated, -1, batch)
    }
}

async function createTaskHighlightedChangedFeed(projectId, taskId, hasStar, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const isSubtask = taskFeedObject.parentId ? true : false
    const highlightedState = hasStar ? 'highlighted' : 'unhighlighted'

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} ${isSubtask ? 'subtask' : 'task'}`,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createTaskRecurrenceChangedFeed(
    projectId,
    taskId,
    oldRecurrenceType,
    newRecurrenceType,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const isSubtask = taskFeedObject.parentId ? true : false
    const newRecurrenceText = RECURRENCE_MAP[newRecurrenceType].large
    const oldRecurrenceText = RECURRENCE_MAP[oldRecurrenceType].large
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_RECURRENCE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask
            ? `turned subtask into task • By changing Recurrence from ${oldRecurrenceText} to ${newRecurrenceText}`
            : `changed recurrence • From ${oldRecurrenceText} to ${newRecurrenceText}`,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    const { parentId } = taskFeedObject
    taskFeedObject.parentId = null
    taskFeedObject.recurrence = newRecurrenceType

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, parentId, taskId, currentDateFormated, -1, batch)
    }
}

async function createTaskAssigneeEstimationChangedFeed(
    projectId,
    taskId,
    oldEstimation,
    newEstimation,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const taskFeedObject = await loadFeedObject(projectId, taskId, 'tasks', currentMilliseconds, batch)
    if (!taskFeedObject) return

    const estimationType = getEstimationType(projectId)
    let oldEstimationText = ''
    let newEstimationText = ''

    if (estimationType === ESTIMATION_TYPE_TIME) {
        oldEstimationText = getDoneTimeValue(oldEstimation, TIME_TEXT_DEFAULT_MINI)
        newEstimationText = getDoneTimeValue(newEstimation, TIME_TEXT_DEFAULT_MINI)
    } else {
        oldEstimationText = getEstimationResume(
            projectId,
            getEstimationRealValue(projectId, oldEstimation, ESTIMATION_TYPE_POINTS),
            ESTIMATION_TYPE_POINTS
        )
        oldEstimationText = `${oldEstimationText.value} ${oldEstimationText.text}`

        newEstimationText = getEstimationResume(
            projectId,
            getEstimationRealValue(projectId, newEstimation, ESTIMATION_TYPE_POINTS),
            ESTIMATION_TYPE_POINTS
        )
        newEstimationText = `${newEstimationText.value} ${newEstimationText.text}`
    }

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_ASSIGNEE_ESTIMATION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed estimation • From ${oldEstimationText} to ${newEstimationText}`,
        feedUser,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.assigneeEstimation = newEstimation

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        taskId,
        'tasks',
        taskFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

module.exports = {
    createTaskCreatedFeed,
    createTaskFollowedFeed,
    createTaskPrivacyChangedFeed,
    createTaskDescriptionChangedFeed,
    createTaskDueDateChangedFeed,
    createTaskParentGoalChangedFeed,
    createTaskHighlightedChangedFeed,
    createTaskRecurrenceChangedFeed,
    createTaskAssigneeEstimationChangedFeed,
}
