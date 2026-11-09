const {
    generateCurrentDateObject,
    generateFeedModel,
    proccessFeed,
    loadFeedObject,
    addPrivacyForFeedObject,
} = require('./globalFeedsHelper')
const { generateGoalObjectModel } = require('./goalsFeedsHelper')
const {
    getTaskNameWithoutMeta,
    FEED_PUBLIC_FOR_ALL,
    CAPACITY_NONE,
    DYNAMIC_PERCENT,
} = require('../Utils/HelperFunctionsCloud')
const { shrinkTagText } = require('../Utils/parseTextUtils')

const {
    FEED_GOAL_CREATED,
    FEED_GOAL_TITLE_CHANGED,
    FEED_GOAL_PROGRESS_CHANGED,
    FEED_GOAL_FOLLOWED,
    FEED_GOAL_ASSIGNEES_CHANGED,
    FEED_GOAL_HIGHLIGHTED_CHANGED,
    FEED_GOAL_DESCRIPTION_CHANGED,
    FEED_GOAL_PRIVACY_CHANGED,
    FEED_GOAL_CAPACITY_CHANGED,
    FEED_GOAL_MILESTONE_CHANGED,
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

    const newPrivacy = isPrivate ? 'Private' : 'Project-wide'
    const oldPrivacy = isPrivate ? 'Project-wide' : 'Private'
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

// The app writes these two from the browser (utils/backends/Goals/goalUpdates.js); the server
// copies exist for the goal tools of assistants and MCP clients, and use the same feed types and
// entry texts so a change reads the same in Updates whoever made it.
async function createGoalTitleChangedFeed(
    projectId,
    oldName,
    newName,
    goalId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const simpleNewName = getTaskNameWithoutMeta(newName)
    const simpleOldName = getTaskNameWithoutMeta(oldName)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed goal title • From ${simpleOldName} to ${simpleNewName}`,
        feedUser,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    goalFeedObject.name = newName

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

async function createGoalProgressChangedFeed(projectId, progress, goalId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_PROGRESS_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed progress to ${progress === DYNAMIC_PERCENT ? 'dynamic' : progress + '%'}`,
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

// A goal's dates as the goal tools of assistants and MCP clients change them (the app writes no entry
// for these). `change` is { field, from, to } with the days already formatted for the reader:
// field 'milestoneDate' and 'startDate' carry days, 'scheduleMode' the old and new mode.
const GOAL_SCHEDULE_MODE_LABELS = { dynamic: 'automatic milestones', fixed: 'a fixed milestone date' }

function describeGoalDateChange({ field, from, to } = {}) {
    if (field === 'milestoneDate') return `changed milestone date • From ${from} to ${to}`
    if (field === 'startDate') return `changed start date • From ${from} to ${to}`
    if (field === 'scheduleMode') {
        const label = mode => GOAL_SCHEDULE_MODE_LABELS[mode] || GOAL_SCHEDULE_MODE_LABELS.fixed
        return `changed scheduling • From ${label(from)} to ${label(to)}`
    }
    return null
}

async function createGoalMilestoneChangedFeed(projectId, change, goalId, batch, feedUser, needGenerateNotification) {
    const entryText = describeGoalDateChange(change)
    if (!entryText) return
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const goalFeedObject = await loadFeedObject(projectId, goalId, 'goals', currentMilliseconds, batch)
    if (!goalFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_MILESTONE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText,
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

module.exports = {
    describeGoalDateChange,
    createGoalMilestoneChangedFeed,
    createGoalCreatedFeed,
    createGoalTitleChangedFeed,
    createGoalProgressChangedFeed,
    createGoalFollowedFeed,
    createGoalAssigeesChangedFeed,
    createGoalHighlightedChangedFeed,
    createGoalDescriptionChangedFeed,
    createGoalPrivacyChangedFeed,
    createGoalCapacityChangedFeed,
}
