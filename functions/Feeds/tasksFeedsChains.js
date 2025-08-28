const { intersection, uniq } = require('lodash')

const { FOLLOWER_TASKS_TYPE } = require('../Followers/FollowerConstants')
const { addFollowers } = require('../Followers/followerHelper')
const {
    getMentionedUsersIdsWhenEditText,
    insertFollowersUserToFeedChain,
    cleanFeeds,
    cleanObjectFeeds,
} = require('./globalFeedsHelper')
const { getGlobalState } = require('../GlobalState/globalState')
const {
    createTaskCreatedFeed,
    createTaskPrivacyChangedFeed,
    createTaskDescriptionChangedFeed,
    createTaskDueDateChangedFeed,
    createTaskParentGoalChangedFeed,
    createTaskHighlightedChangedFeed,
    createTaskRecurrenceChangedFeed,
    createTaskAssigneeEstimationChangedFeed,
} = require('./tasksFeeds')
const { RECURRENCE_NEVER, OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

async function createTaskFeedChain(projectId, taskId, task, needCleanGlobalFeeds, needGenerateNotification) {
    const { appAdmin, feedCreator, project } = getGlobalState()

    const batch = new BatchWrapper(appAdmin.firestore())

    const fullText = task.extendedName + ' ' + task.description
    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

    const followerIds = uniq([...mentionedUserIds, task.userId, feedCreator.uid])
    insertFollowersUserToFeedChain(followerIds, taskId, batch)

    if (feedCreator.uid === task.userId) {
        await createTaskCreatedFeed(projectId, task, taskId, batch, feedCreator, needGenerateNotification)
    } else {
        //await createTaskToAnotherUserFeed(projectId, task, taskId, assignee, batch, feedCreator)
    }

    if (task.isPrivate) {
        await createTaskPrivacyChangedFeed(
            projectId,
            taskId,
            task.isPrivate,
            task.isPublicFor,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    //await registerTaskObservedFeeds(projectId, { ...task, id: taskId }, null, batch)

    if (task.description.trim()) {
        await createTaskDescriptionChangedFeed(
            projectId,
            '',
            task.description,
            taskId,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const todayDate = Date.now()
    if (todayDate < task.dueDate) {
        await createTaskDueDateChangedFeed(
            projectId,
            task.dueDate,
            todayDate,
            taskId,
            batch,
            task.dueDate === Number.MAX_SAFE_INTEGER,
            false,
            false,
            feedCreator,
            needGenerateNotification
        )
    }

    if (task.parentGoalId) {
        await createTaskParentGoalChangedFeed(
            projectId,
            task.parentGoalId,
            null,
            taskId,
            false,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (task.hasStar.toLowerCase() !== '#ffffff') {
        await createTaskHighlightedChangedFeed(
            projectId,
            taskId,
            task.hasStar,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (task.recurrence !== RECURRENCE_NEVER) {
        await createTaskRecurrenceChangedFeed(
            projectId,
            taskId,
            RECURRENCE_NEVER,
            task.recurrence,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (task.estimations[OPEN_STEP] !== 0) {
        await createTaskAssigneeEstimationChangedFeed(
            projectId,
            taskId,
            0,
            task.estimations[OPEN_STEP],
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const followData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
    }

    await addFollowers(projectId, followerIds, followData, batch, needGenerateNotification)

    await batch.commit()

    if (needCleanGlobalFeeds) {
        await cleanFeeds(projectId, taskId, 'tasks')
    } else {
        await cleanObjectFeeds(projectId, taskId, 'tasks')
    }
}

module.exports = { createTaskFeedChain }
