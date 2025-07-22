const {
    generateCurrentDateObject,
    generateFeedModel,
    proccessFeed,
    loadFeedObject,
    addPrivacyForFeedObject,
} = require('./globalFeedsHelper')
const { generateGoalObjectModel } = require('./goalsFeedsHelper')
const { getTaskNameWithoutMeta, FEED_PUBLIC_FOR_ALL, CAPACITY_NONE } = require('../Utils/HelperFunctionsCloud')
const { shrinkTagText } = require('../Utils/parseTextUtils')

const {
    FEED_GOAL_CREATED,
    FEED_GOAL_FOLLOWED,
    FEED_GOAL_ASSIGNEES_CHANGED,
    FEED_GOAL_HIGHLIGHTED_CHANGED,
    FEED_GOAL_DESCRIPTION_CHANGED,
    FEED_GOAL_PRIVACY_CHANGED,
    FEED_GOAL_CAPACITY_CHANGED,
} = require('./FeedsConstants')

async function createGoalCreatedFeed(projectId, goal, goalId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const goalFeedObject = generateGoalObjectModel(currentMilliseconds, goal, goalId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: `created goal`,
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    batch.feedObjects = { [goalId]: goalFeedObject }

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createGoalFollowedFeed(projectId, goalId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the goal',
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createGoalAssigeesChangedFeed(
    projectId,
    oldAssigneesIds,
    newAssigneesIds,
    goalId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_ASSIGNEES_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })
    feed.oldAssigneesIds = oldAssigneesIds
    feed.newAssigneesIds = newAssigneesIds

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createGoalHighlightedChangedFeed(projectId, goalId, hasStar, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const highlightedState = hasStar ? 'highlighted' : 'unhighlighted'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} goal`,
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createGoalDescriptionChangedFeed(
    projectId,
    oldDescription,
    newDescription,
    goalId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const simpleNewDesc = shrinkTagText(getTaskNameWithoutMeta(newDescription, true), 50)
    const simpleOldDesc = shrinkTagText(getTaskNameWithoutMeta(oldDescription, true), 50)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed goal description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createGoalPrivacyChangedFeed(projectId, goalId, isPublicFor, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const isPrivate = !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)

    await addPrivacyForFeedObject(projectId, isPrivate, goalFeedObject, goalId, 'goals', isPublicFor)

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createGoalCapacityChangedFeed(
    projectId,
    goalId,
    capacityOwnerId,
    oldCapacity,
    newCapacity,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_CAPACITY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })
    feed.capacityUserId = capacityOwnerId
    feed.oldCapacity = oldCapacity ? oldCapacity : CAPACITY_NONE
    feed.newCapacity = newCapacity

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        goalId,
        'goals',
        goalFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

module.exports = {
    createGoalCreatedFeed,
    createGoalFollowedFeed,
    createGoalAssigeesChangedFeed,
    createGoalHighlightedChangedFeed,
    createGoalDescriptionChangedFeed,
    createGoalPrivacyChangedFeed,
    createGoalCapacityChangedFeed,
}
