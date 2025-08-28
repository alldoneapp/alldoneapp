const { intersection, uniq, isEqual } = require('lodash')

const { FOLLOWER_GOALS_TYPE } = require('../Followers/FollowerConstants')
const { addFollowers } = require('../Followers/followerHelper')
const {
    getMentionedUsersIdsWhenEditText,
    insertFollowersUserToFeedChain,
    cleanFeeds,
    cleanObjectFeeds,
} = require('./globalFeedsHelper')
const { getGlobalState } = require('../GlobalState/globalState')
const {
    createGoalCreatedFeed,
    createGoalAssigeesChangedFeed,
    createGoalHighlightedChangedFeed,
    createGoalDescriptionChangedFeed,
    createGoalPrivacyChangedFeed,
    createGoalCapacityChangedFeed,
} = require('./goalsFeeds')
const { FEED_PUBLIC_FOR_ALL, CAPACITY_NONE } = require('../Utils/HelperFunctionsCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

async function createGoalUpdatesChain(projectId, goal, needCleanGlobalFeeds, needGenerateNotification) {
    const { appAdmin, feedCreator, project } = getGlobalState()

    const batch = new BatchWrapper(appAdmin.firestore())

    const fullText = goal.extendedName + ' ' + goal.description
    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

    const followerIds = uniq([...mentionedUserIds, ...goal.assigneesIds, feedCreator.uid])
    insertFollowersUserToFeedChain(followerIds, goal.id, batch)

    await createGoalCreatedFeed(projectId, goal, goal.id, batch, feedCreator, needGenerateNotification)

    if (!isEqual(goal.isPublicFor, [FEED_PUBLIC_FOR_ALL])) {
        await createGoalPrivacyChangedFeed(
            projectId,
            goal.id,
            goal.isPublicFor,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (goal.assigneesIds.length > 0) {
        await createGoalAssigeesChangedFeed(
            projectId,
            [],
            goal.assigneesIds,
            goal.id,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (goal.hasStar !== '#FFFFFF') {
        await createGoalHighlightedChangedFeed(
            projectId,
            goal.id,
            goal.hasStar,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (goal.description.trim() !== '') {
        await createGoalDescriptionChangedFeed(
            projectId,
            '',
            goal.description,
            goal.id,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    for (let i = 0; i < goal.assigneesIds.length; i++) {
        const assigneeId = goal.assigneesIds[i]
        const newCapacity = goal.assigneesCapacity[assigneeId]
        if (newCapacity && newCapacity !== CAPACITY_NONE) {
            await createGoalCapacityChangedFeed(
                projectId,
                goal.id,
                assigneeId,
                CAPACITY_NONE,
                newCapacity,
                batch,
                feedCreator,
                needGenerateNotification
            )
        }
    }

    const followData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goal.id,
        followObject: goal,
    }
    await addFollowers(projectId, followerIds, followData, batch, needGenerateNotification)

    await batch.commit()

    if (needCleanGlobalFeeds) {
        await cleanFeeds(projectId, goal.id, 'goals')
    } else {
        await cleanObjectFeeds(projectId, goal.id, 'goals')
    }
}

module.exports = { createGoalUpdatesChain }
