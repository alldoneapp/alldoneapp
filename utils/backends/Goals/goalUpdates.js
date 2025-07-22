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
    tryAddFollower,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import {
    FEED_GOAL_ASSIGNEES_CHANGED,
    FEED_GOAL_BACKLINK,
    FEED_GOAL_CAPACITY_CHANGED,
    FEED_GOAL_CREATED,
    FEED_GOAL_DELETED,
    FEED_GOAL_DESCRIPTION_CHANGED,
    FEED_GOAL_FOLLOWED,
    FEED_GOAL_HIGHLIGHTED_CHANGED,
    FEED_GOAL_PRIVACY_CHANGED,
    FEED_GOAL_PROGRESS_CHANGED,
    FEED_GOAL_PROJECT_CHANGED,
    FEED_GOAL_TITLE_CHANGED,
    FEED_GOAL_ASSISTANT_CHANGED,
    FEED_GOAL_UNFOLLOWED,
    FEED_PUBLIC_FOR_ALL,
} from '../../../components/Feeds/Utils/FeedsConstants'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../HelperFunctions'
import { CAPACITY_NONE, DYNAMIC_PERCENT } from '../../../components/GoalsView/GoalsHelper'
import { FOLLOWER_GOALS_TYPE } from '../../../components/Followers/FollowerConstants'
import { isWorkstream } from '../../../components/Workstreams/WorkstreamHelper'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

//COMMON

export function generateGoalObjectModel(currentMilliseconds, goal = {}, goalId) {
    return {
        type: 'goal',
        lastChangeDate: currentMilliseconds,
        goalId: goalId,
        name: goal?.extendedName || goal?.name || 'Goal Name...',
        isDeleted: false,
        isPublicFor: goal?.isPublicFor ? goal?.isPublicFor : [FEED_PUBLIC_FOR_ALL],
        lockKey: goal.lockKey ? goal.lockKey : '',
        ownerId: goal.ownerId ? goal.ownerId : '',
        assistantId: goal.assistantId ? goal.assistantId : '',
    }
}

function updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, params, batch) {
    storeOldFeeds(projectId, currentDateFormated, goalId, goalFeedObject, feedId, feed)

    const loggedUserId = store.getState().loggedUser.uid
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[goalId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [goalId]: [loggedUserId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, goalId, 'goals')
        cleanInnerFeeds(projectId, loggedUserId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${goalId}`)
    batch.set(feedObjectRef, goalFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'goals', goalId, goalFeedObject, batch)
    processLocalFeeds(projectId, goalFeedObject, goalId, feed, feedId, params)
}

//UPDATES

export async function createGoalCreatedFeed(projectId, goal, milestoneDate, goalId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const goalFeedObject = generateGoalObjectModel(currentMilliseconds, goal, goalId)

    /*const milestone =
        milestoneDate === 'Someday' ? 'Someday' : `${moment(milestoneDate).format(getDateFormat())} milestone`
*/
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_CREATED,
        lastChangeDate: currentMilliseconds,
        //entryText: `created goal for ${milestone}`,
        entryText: `created goal`,
        feedCreator,
        objectId: goalId,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [goalId]: goalFeedObject }

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalNameChangedFeed(projectId, oldName, newName, goalId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewName = TasksHelper.getTaskNameWithoutMeta(newName)
    const simpleOldName = TasksHelper.getTaskNameWithoutMeta(oldName)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed goal title • From ${simpleOldName} to ${simpleNewName}`,
        feedCreator,
        objectId: goalId,
    })

    goalFeedObject.name = newName
    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalAssistantChangedFeed(projectId, assistantId, goalId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed goal assistant`,
        feedCreator,
        objectId: goalId,
    })

    goalFeedObject.assistantId = assistantId
    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalDeletedFeed(projectId, goalId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_DELETED,
        lastChangeDate: currentMilliseconds,
        entryText: 'deleted the goal',
        feedCreator,
        objectId: goalId,
    })

    goalFeedObject.isDeleted = true
    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalCapacityChangedFeed(
    projectId,
    goalId,
    capacityOwnerId,
    oldCapacity,
    newCapacity,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_CAPACITY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: goalId,
    })

    feed.capacityUserId = capacityOwnerId
    feed.oldCapacity = oldCapacity ? oldCapacity : CAPACITY_NONE
    feed.newCapacity = newCapacity
    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalHighlightedChangedFeed(projectId, goalId, hasStar, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const highlightedState = hasStar ? 'highlighted' : 'unhighlighted'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} goal`,
        feedCreator,
        objectId: goalId,
    })

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalPrivacyChangedFeed(projectId, goalId, goal, isPublicFor, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isPrivate = !isPublicFor.includes(FEED_PUBLIC_FOR_ALL)

    addPrivacyForFeedObject(projectId, isPrivate, goalFeedObject, goalId, 'goals', isPublicFor)

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedCreator,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    // Start following all user with privacy access
    const followGoalData = {
        followObjectsType: FOLLOWER_GOALS_TYPE,
        followObjectId: goalId,
        feedCreator: store.getState().loggedUser,
        followObject: goal,
    }
    if (isPrivate) {
        for (let i = 0; i < isPublicFor.length; i++) {
            if (!isWorkstream(isPublicFor[i])) {
                followGoalData.feedCreator = { uid: isPublicFor[i] }
                await tryAddFollower(projectId, followGoalData, batch)
            }
        }
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalAssigeesChangedFeed(
    projectId,
    oldAssigneesIds,
    newAssigneesIds,
    goalId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_ASSIGNEES_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: goalId,
    })
    feed.oldAssigneesIds = oldAssigneesIds
    feed.newAssigneesIds = newAssigneesIds

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalProjectChangedFeed(
    projectId,
    goalId,
    changeDirection,
    projectName,
    projectColor,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_PROJECT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: goalId,
    })
    feed.projectName = projectName
    feed.projectColor = projectColor
    feed.changeDirection = changeDirection

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalProgressChangedFeed(projectId, progress, goalId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_PROGRESS_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed progress to ${progress === DYNAMIC_PERCENT ? 'dynamic' : progress + '%'}`,
        feedCreator,
        objectId: goalId,
    })

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalFollowedFeed(projectId, goalId, userFollowingId, externalBatch, creator) {
    const feedCreator =
        creator && creator?.displayName ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the goal',
        feedCreator,
        objectId: goalId,
    })

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalUnfollowedFeed(projectId, goalId, externalBatch, creator) {
    const feedCreator = creator ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the goal',
        feedCreator,
        objectId: goalId,
    })

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createGoalDescriptionChangedFeed(
    projectId,
    oldDescription,
    newDescription,
    goalId,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(newDescription, true), 50)
    const simpleOldDesc = shrinkTagText(TasksHelper.getTaskNameWithoutMeta(oldDescription, true), 50)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed goal description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedCreator,
        objectId: goalId,
        isPublicFor: goalFeedObject.isPublicFor,
    })

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkGoalFeed(projectId, objectId, objectType, goalId, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const goalFeedObject = await loadFeedObject(
        projectId,
        goalId,
        'goals',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_GOAL_BACKLINK,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: goalId,
    })
    feed.linkTag = objectLink

    updateGoalFeedObject(projectId, currentDateFormated, goalId, goalFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'goals', goalId, batch, feedId, feed, goalFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'goals', goalId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}
