import moment from 'moment'

import {
    FEED_PUBLIC_FOR_ALL,
    FEED_TASK_ASSIGNEE_CHANGED,
    FEED_TASK_ASSIGNEE_ESTIMATION_CHANGED,
    FEED_TASK_BACKLINK,
    FEED_TASK_CHECKED_DONE,
    FEED_TASK_CREATED,
    FEED_TASK_DELETED,
    FEED_TASK_DESCRIPTION,
    FEED_TASK_DUE_DATE_CHANGED,
    FEED_TASK_FOCUS_CHANGED,
    FEED_TASK_ASSISTANT_CHANGED,
    FEED_TASK_FOLLOWED,
    FEED_TASK_HIGHLIGHTED_CHANGED,
    FEED_TASK_MOVED_IN_WORKFLOW,
    FEED_TASK_OBSERVED,
    FEED_TASK_PARENT_GOAL,
    FEED_TASK_PRIVACY_CHANGED,
    FEED_TASK_PROJECT_CHANGED_FROM,
    FEED_TASK_PROJECT_CHANGED_TO,
    FEED_TASK_RECURRENCE_CHANGED,
    FEED_TASK_REVIEWER_ESTIMATION_CHANGED,
    FEED_TASK_SUBTASK_PROMOTED,
    FEED_TASK_TITLE_CHANGED,
    FEED_TASK_TO_ANOTHER_USER,
    FEED_TASK_UNCHECKED_DONE,
    FEED_TASK_UNFOLLOWED,
    FEED_TASK_UNOBSERVED,
    FEED_TASK_OBSERVER_ESTIMATION_CHANGED,
} from '../../../components/Feeds/Utils/FeedsConstants'
import TasksHelper, { DONE_STEP, OPEN_STEP, RECURRENCE_MAP } from '../../../components/TaskListView/Utils/TasksHelper'
import HelperFunctions, { chronoEntriesOrder } from '../../HelperFunctions'
import store from '.././../../redux/store'
import {
    addPrivacyForFeedObject,
    cleanInnerFeeds,
    cleanNewFeeds,
    cleanStoreFeeds,
    generateCurrentDateObject,
    generateFeedModel,
    getDb,
    getProjectUsersIds,
    globalInnerFeedsGenerator,
    increaseFeedCount,
    loadFeedObject,
    processLocalFeeds,
    setFeedObjectLastState,
    storeOldFeeds,
    updateTasksFeedsAmountOfSubtasks,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { getDateFormat } from '../../../components/UIComponents/FloatModals/DateFormatPickerModal'
import {
    ESTIMATION_TYPE_POINTS,
    ESTIMATION_TYPE_TIME,
    TIME_TEXT_DEFAULT_MINI,
    getDoneTimeValue,
    getEstimationRealValue,
    getEstimationTypeByProjectId,
    getEstimationTypeResume,
} from '../../EstimationHelper'
import { getUserPresentationData } from '../../../components/ContactsView/Utils/ContactsHelper'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

//COMMON

export function generateTaskObjectModel(currentMilliseconds, task = {}, taskId) {
    return {
        type: 'task',
        parentId: task.parentId ? task.parentId : '',
        subtaskIds: task.subtaskIds ? task.subtaskIds : [],
        lastChangeDate: currentMilliseconds,
        taskId: taskId,
        name: task.extendedName ? task.extendedName : task.name,
        assigneeEstimation: task.estimations[OPEN_STEP],
        recurrence: task.recurrence,
        isDone: task.done,
        isDeleted: false,
        privacy: task.isPrivate ? task.userId : 'public',
        linkBack: task.linkBack ? task.linkBack : '',
        comments: task.comments ? task.comments : [],
        userId: task.userId || task.userIds[0],
        genericData: task.genericData ? task.genericData : null,
        isPublicFor: task.isPublicFor ? task.isPublicFor : task.isPrivate ? [task.userId] : [FEED_PUBLIC_FOR_ALL],
        lockKey: task.lockKey ? task.lockKey : '',
        assistantId: task.assistantId ? task.assistantId : '',
    }
}

function updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, params, batch) {
    storeOldFeeds(projectId, currentDateFormated, taskId, taskFeedObject, feedId, feed)

    const loggedUserId = store.getState().loggedUser.uid
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[taskId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [taskId]: [loggedUserId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, taskId, 'tasks')
        cleanInnerFeeds(projectId, loggedUserId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${taskId}`)
    batch.set(feedObjectRef, taskFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'tasks', taskId, taskFeedObject, batch)
    processLocalFeeds(projectId, taskFeedObject, taskId, feed, feedId, params)
}

//UPDATES

export async function createTaskCreatedFeed(projectId, task, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const taskFeedObject = generateTaskObjectModel(currentMilliseconds, task, taskId)

    const isSubtask = task.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'created subtask' : 'created task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [taskId]: taskFeedObject }

    taskFeedObject.parentName = task.parentName ? task.parentName : ''
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, 1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskToAnotherUserFeed(projectId, task, taskId, assignee, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const taskFeedObject = generateTaskObjectModel(currentMilliseconds, task, taskId)

    const isSubtask = task.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_TO_ANOTHER_USER,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })
    feed.assigneeId = assignee.uid

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [taskId]: taskFeedObject }

    taskFeedObject.parentName = task.parentName ? task.parentName : ''
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
        assigneeName: !!assignee.temperature
            ? assignee.displayName
            : HelperFunctions.getFirstName(assignee.displayName),
        assigneeAvatarURL: assignee.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, 1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskDeletedFeed(projectId, task, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_DELETED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'deleted subtask' : 'deleted task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.isDeleted = true
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (task.subtaskIds && task.subtaskIds.length > 0) {
        const subtaskIds = task.subtaskIds

        for (let i = 0; i < subtaskIds.length; i++) {
            const subTaskId = subtaskIds[i]
            const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${subTaskId}`)
            const taskChanges = { isDeleted: true }
            batch.set(feedObjectRef, taskChanges, { merge: true })
            setFeedObjectLastState(projectId, 'tasks', subTaskId, taskChanges, batch)
        }
    }

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskNameChangedFeed(projectId, task, oldName, newName, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewName = TasksHelper.getTaskNameWithoutMeta(newName)
    const simpleOldName = TasksHelper.getTaskNameWithoutMeta(oldName)

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed ${isSubtask ? 'subtask' : 'task'} title • From ${simpleOldName} to ${simpleNewName}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.name = newName
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskAssistantChanged(projectId, assistantId, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed ${isSubtask ? 'subtask' : 'task'} assistant`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.assistantId = assistantId
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskDescriptionChangedFeed(
    projectId,
    task,
    oldDescription,
    newDescription,
    taskId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(newDescription, true), 50)
    const simpleOldDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(oldDescription, true), 50)

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_DESCRIPTION,
        lastChangeDate: currentMilliseconds,
        entryText: `changed ${isSubtask ? 'subtask' : 'task'} description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskDueDateChangedFeed(
    projectId,
    task,
    newDueDate,
    oldDueDate,
    taskId,
    externalBatch,
    creator,
    newInBacklog,
    oldInBacklog,
    isObservedTask
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

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
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.parentId = null
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskParentGoalChangedFeed(
    projectId,
    task,
    newParentGoalId,
    oldParentGoalId,
    taskId,
    turnedToTask,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_PARENT_GOAL,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    feed.newParentGoalId = newParentGoalId
    feed.oldParentGoalId = oldParentGoalId
    feed.isSubtask = isSubtask
    feed.turnedToTask = turnedToTask

    if (turnedToTask) {
        taskFeedObject.parentId = null
    }
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskAssigneeChangedFeed(
    projectId,
    task,
    newAssignee,
    oldAssignee,
    taskId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_ASSIGNEE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })
    feed.newAssigneeId = newAssignee.uid
    feed.oldAssigneeId = oldAssignee.uid

    if (isSubtask) {
        feed.isSubtask = isSubtask
    }

    taskFeedObject.parentId = null
    taskFeedObject.userId = newAssignee.uid
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
        oldAssigneeName: HelperFunctions.getFirstName(oldAssignee.displayName),
        oldAssigneeAvatarURL: oldAssignee.photoURL,
        newAssigneeName: HelperFunctions.getFirstName(newAssignee.displayName),
        newAssigneeAvatarURL: newAssignee.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskAssigneeEstimationChangedFeed(
    projectId,
    taskId,
    oldEstimation,
    newEstimation,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const estimationType = getEstimationTypeByProjectId(projectId)
    let oldEstimationText = ''
    let newEstimationText = ''

    if (estimationType === ESTIMATION_TYPE_TIME) {
        oldEstimationText = getDoneTimeValue(oldEstimation, TIME_TEXT_DEFAULT_MINI)
        newEstimationText = getDoneTimeValue(newEstimation, TIME_TEXT_DEFAULT_MINI)
    } else {
        oldEstimationText = getEstimationTypeResume(
            getEstimationRealValue(projectId, oldEstimation, ESTIMATION_TYPE_POINTS),
            ESTIMATION_TYPE_POINTS
        )
        oldEstimationText = `${oldEstimationText.value} ${oldEstimationText.text}`

        newEstimationText = getEstimationTypeResume(
            getEstimationRealValue(projectId, newEstimation, ESTIMATION_TYPE_POINTS),
            ESTIMATION_TYPE_POINTS
        )
        newEstimationText = `${newEstimationText.value} ${newEstimationText.text}`
    }

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_ASSIGNEE_ESTIMATION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed estimation • From ${oldEstimationText} to ${newEstimationText}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.assigneeEstimation = newEstimation

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskObserverEstimationChangedFeed(
    projectId,
    taskId,
    oldEstimation,
    newEstimation,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const estimationType = getEstimationTypeByProjectId(projectId)
    let oldEstimationText = ''
    let newEstimationText = ''

    if (estimationType === ESTIMATION_TYPE_TIME) {
        oldEstimationText = getDoneTimeValue(oldEstimation, TIME_TEXT_DEFAULT_MINI)
        newEstimationText = getDoneTimeValue(newEstimation, TIME_TEXT_DEFAULT_MINI)
    } else {
        oldEstimationText = getEstimationTypeResume(
            getEstimationRealValue(projectId, oldEstimation, ESTIMATION_TYPE_POINTS),
            ESTIMATION_TYPE_POINTS
        )
        oldEstimationText = `${oldEstimationText.value} ${oldEstimationText.text}`

        newEstimationText = getEstimationTypeResume(
            getEstimationRealValue(projectId, newEstimation, ESTIMATION_TYPE_POINTS),
            ESTIMATION_TYPE_POINTS
        )
        newEstimationText = `${newEstimationText.value} ${newEstimationText.text}`
    }

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_OBSERVER_ESTIMATION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed observer estimation • From ${oldEstimationText} to ${newEstimationText}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskRecurrenceChangedFeed(
    projectId,
    task,
    taskId,
    oldRecurrenceType,
    newRecurrenceType,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const newRecurrenceText = RECURRENCE_MAP[newRecurrenceType].large
    const oldRecurrenceText = RECURRENCE_MAP[oldRecurrenceType].large
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_RECURRENCE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask
            ? `turned subtask into task • By changing Recurrence from ${oldRecurrenceText} to ${newRecurrenceText}`
            : `changed recurrence • From ${oldRecurrenceText} to ${newRecurrenceText}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.recurrence = newRecurrenceType
    taskFeedObject.parentId = null

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskProjectChangedFeed(
    projectId,
    task,
    taskId,
    changeDirection,
    projectName,
    projectColor,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: changeDirection === 'to' ? FEED_TASK_PROJECT_CHANGED_TO : FEED_TASK_PROJECT_CHANGED_FROM,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })
    feed.projectName = projectName
    feed.projectColor = projectColor
    feed.changeDirection = changeDirection

    if (isSubtask) {
        feed.isSubtask = isSubtask
    }

    taskFeedObject.parentId = null
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskPrivacyChangedFeed(projectId, taskId, isPrivate, isPublicFor, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    addPrivacyForFeedObject(
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
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskHighlightedChangedFeed(projectId, task, taskId, hasStar, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const highlightedState = hasStar ? 'highlighted' : 'unhighlighted'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} ${isSubtask ? 'subtask' : 'task'}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskFocusChangedFeed(projectId, taskId, inFocus, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const focusState = inFocus ? 'focus' : 'unfocus'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_FOCUS_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${focusState} the task`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskMovedInWorkflowFeed(
    projectId,
    task,
    taskId,
    workflow,
    targetStepId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    let toStepDescription = ''
    let fromStepDescription = ''
    let isForward = 'empty'
    let fromStepAvatarURL = ''
    let toStepAvatarURL = ''
    let fromStepUserId = ''
    let toStepUserId = ''

    if (targetStepId === 'open') {
        toStepDescription = 'Open'
        isForward = false
        const user = TasksHelper.getTaskOwner(task.userId, projectId)
        toStepAvatarURL = user.photoURL
        toStepUserId = user.uid
    } else if (targetStepId === 'done') {
        toStepDescription = 'Done'
        isForward = true
    } else {
        const { description, reviewerUid } = workflow[targetStepId]
        const reviewerData = getUserPresentationData(reviewerUid)
        toStepDescription = description
        toStepAvatarURL = reviewerData.photoURL
        toStepUserId = reviewerUid
    }

    const currentStepId = task.stepHistory[task.stepHistory.length - 1]
    if (currentStepId === OPEN_STEP) {
        fromStepDescription = 'Open'
        isForward = true
        const user = TasksHelper.getTaskOwner(task.userId, projectId)
        fromStepAvatarURL = user.photoURL
        fromStepUserId = user.uid
    } else if (currentStepId === DONE_STEP) {
        fromStepDescription = 'Done'
        isForward = false
    } else {
        const { description, reviewerUid } = workflow[currentStepId]
        const reviewerData = getUserPresentationData(reviewerUid)
        fromStepDescription = description
        fromStepAvatarURL = reviewerData.photoURL
        fromStepUserId = reviewerUid
        const workflowEntries = Object.entries(workflow).sort(chronoEntriesOrder)
        if (isForward === 'empty') {
            for (let i = 0; workflowEntries.length; i++) {
                if (workflowEntries[i][0] === targetStepId) {
                    isForward = false
                    break
                } else if (workflowEntries[i][0] === currentStepId) {
                    isForward = true
                    break
                }
            }
        }
    }

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_MOVED_IN_WORKFLOW,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })
    feed.fromStepUserId = fromStepUserId
    feed.toStepUserId = toStepUserId
    feed.fromStepDescription = fromStepDescription
    feed.toStepDescription = toStepDescription
    feed.isForward = isForward
    if (isSubtask) {
        feed.isSubtask = isSubtask
    }

    taskFeedObject.isDone = targetStepId === 'done'
    taskFeedObject.inWorkflow = !taskFeedObject.isDone && targetStepId !== 'open'
    taskFeedObject.parentId = null
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
        fromStepAvatarURL,
        toStepAvatarURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (isSubtask) {
        await updateTasksFeedsAmountOfSubtasks(projectId, task.parentId, taskId, currentDateFormated, -1, batch)
    }

    if (task.subtaskIds && task.subtaskIds.length > 0) {
        const taskChanges = { inWorkflow: taskFeedObject.inWorkflow }
        task.subtaskIds.forEach(subtaskId => {
            const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${subtaskId}`)
            batch.set(feedObjectRef, taskChanges, { merge: true })
            setFeedObjectLastState(projectId, 'tasks', subtaskId, taskChanges, batch)
        })
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskReviewerEstimationChangedFeed(
    projectId,
    task,
    taskId,
    oldEstimation,
    newEstimation,
    stepId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const taskAssignee = TasksHelper.getTaskOwner(task.userId, projectId)
    const stepDescription = taskAssignee.workflow[projectId][stepId].description
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_REVIEWER_ESTIMATION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed ${stepDescription} Workflow step estimation • From ${oldEstimation} to ${newEstimation}`,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskCheckedDoneFeed(projectId, task, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_CHECKED_DONE,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'checked subtask as Done' : 'checked task as Done',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.isDone = true
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskUncheckedDoneFeed(projectId, task, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_UNCHECKED_DONE,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'changed subtask to Open' : 'changed task to Open',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.isDone = true
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createSubtaskPromotedFeed(projectId, task, taskId, parentId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_SUBTASK_PROMOTED,
        lastChangeDate: currentMilliseconds,
        entryText: 'turned into task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    taskFeedObject.parentId = null
    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    await updateTasksFeedsAmountOfSubtasks(projectId, parentId, taskId, currentDateFormated, -1, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskFollowedFeed(projectId, taskId, userFollowingId, externalBatch, creator) {
    const feedCreator = creator
        ? creator
        : TasksHelper.getUserInProject(projectId, userFollowingId) || store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'started following the subtask' : 'started following the task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskUnfollowedFeed(projectId, taskId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'stopped following the subtask' : 'stopped following the task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskObservedFeed(projectId, taskId, userObservingId, externalBatch) {
    const feedCreator = TasksHelper.getUserInProject(projectId, userObservingId) || store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_OBSERVED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'started observing the subtask' : 'started observing the task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createTaskUnObservedFeed(projectId, taskId, userObservingId, externalBatch) {
    const feedCreator = TasksHelper.getUserInProject(projectId, userObservingId) || store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isSubtask = taskFeedObject.parentId ? true : false

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_UNOBSERVED,
        lastChangeDate: currentMilliseconds,
        entryText: isSubtask ? 'stopped observing the subtask' : 'stopped observing the task',
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkTaskFeed(projectId, objectId, objectType, taskId, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const taskFeedObject = await loadFeedObject(
        projectId,
        taskId,
        'tasks',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_TASK_BACKLINK,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: taskId,
        isPublicFor: taskFeedObject.isPublicFor,
    })
    feed.linkTag = objectLink

    updateTaskFeedObject(projectId, currentDateFormated, taskId, taskFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'tasks', taskId, batch, feedId, feed, taskFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'tasks', taskId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}
