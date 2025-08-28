import store from '.././../../redux/store'
import {
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
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import {
    FEED_USER_ALL_MEMBERS_FOLLOWING,
    FEED_USER_BACKLINK,
    FEED_USER_ASSISTANT_CHANGED,
    FEED_USER_COMPANY_CHANGED,
    FEED_USER_DESCRIPTION_CHANGED,
    FEED_USER_FOLLOWED,
    FEED_USER_FOLLOWING_ALL_MEMBERS,
    FEED_USER_HIGHLIGHT_CHANGED,
    FEED_USER_JOINED,
    FEED_USER_PRIVACY_CHANGED,
    FEED_USER_ROLE_CHANGED,
    FEED_USER_UNFOLLOWED,
    FEED_USER_WORKFLOW_CHANGED_DESC,
} from '../../../components/Feeds/Utils/FeedsConstants'
import HelperFunctions from '../../HelperFunctions'

//COMMON

export function generateUserObjectModel(currentMilliseconds, userId, assistantId) {
    return {
        type: 'user',
        lastChangeDate: currentMilliseconds,
        userId: userId,
        assistantId,
    }
}

function updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, params, batch) {
    storeOldFeeds(projectId, currentDateFormated, userId, userFeedObject, feedId, feed)

    const loggedUserId = store.getState().loggedUser.uid
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[userId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [userId]: [loggedUserId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, userId, 'users')
        if (userId !== loggedUserId) {
            cleanInnerFeeds(projectId, loggedUserId, 'users')
        }
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${userId}`)
    batch.set(feedObjectRef, userFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'users', userId, userFeedObject, batch)
    processLocalFeeds(projectId, userFeedObject, userId, feed, feedId, params)
}

//UPDATES

export async function createUserJoinedFeed(projectId, externalBatch, creator, project) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const { uid: creatorId } = creator
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_JOINED,
        lastChangeDate: currentMilliseconds,
        entryText: 'joined to project',
        feedCreator,
        objectId: creatorId,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    globalInnerFeedsGenerator(projectId, 'users', creatorId, feed, feedId, feedCreator.uid, batch)

    let usersToNotifyIds = project ? project.userIds : []

    const userFeedObject = generateUserObjectModel(currentMilliseconds, creatorId, feedCreator.assistantId)
    batch.feedObjects = { [creatorId]: userFeedObject }

    updateUserFeedObject(projectId, currentDateFormated, creatorId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        usersToNotifyIds,
        projectId,
        'users',
        creatorId,
        batch,
        feedId,
        feed,
        userFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserRoleChangedFeed(projectId, user, userId, newRole, oldRole, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldRole = oldRole && oldRole !== 'Role unknown' ? oldRole : 'Unknown'
    const parsedNewRole = newRole && newRole !== 'Role unknown' ? newRole : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_ROLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed role • From ${parsedOldRole} to ${parsedNewRole}`,
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createWorkflowStepFeed(
    projectId,
    reviewerUserId,
    targetUserId,
    description,
    feedType,
    oldReviewerUid,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        targetUserId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: targetUserId,
    })

    feed.reviewerUserId = reviewerUserId
    feed.description = description
    if (oldReviewerUid) {
        feed.oldReviewerUid = oldReviewerUid
    }

    globalInnerFeedsGenerator(projectId, 'users', targetUserId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, targetUserId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'users',
        targetUserId,
        batch,
        feedId,
        feed,
        userFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createWorkflowStepFeedChangeTitle(
    projectId,
    reviewerUserId,
    targetUserId,
    oldDescription,
    newDescription,
    externalBatch
) {
    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        targetUserId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_WORKFLOW_CHANGED_DESC,
        lastChangeDate: currentMilliseconds,
        entryText: `edited ${oldDescription} • Changed titlte to ${newDescription}`,
        feedCreator,
        objectId: targetUserId,
    })

    globalInnerFeedsGenerator(projectId, 'users', targetUserId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, targetUserId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        [],
        projectId,
        'users',
        targetUserId,
        batch,
        feedId,
        feed,
        userFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createBacklinkUserFeed(projectId, objectId, objectType, userId, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_BACKLINK,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: userId,
    })

    feed.linkTag = objectLink

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserCompanyChangedFeed(
    projectId,
    user,
    userId,
    newCompany,
    oldCompany,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldCompany = oldCompany && oldCompany !== 'Company unknown' ? oldCompany : 'Unknown'
    const parsedNewCompany = newCompany && newCompany !== 'Company unknown' ? newCompany : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_COMPANY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed company • From ${parsedOldCompany} to ${parsedNewCompany}`,
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserHighlightChangedFeed(projectId, user, userId, highlightColor, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const isHighlighted = highlightColor.toLowerCase() !== '#ffffff'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_HIGHLIGHT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${isHighlighted ? 'highlighted' : 'unhighlighted'} user ${user.displayName}`,
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserPrivacyChangedFeed(
    projectId,
    user,
    userId,
    isPrivate,
    isPublicFor,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    // addPrivacyForFeedObject(
    //     projectId,
    //     isPrivate,
    //     userFeedObject,
    //     userId,
    //     'users',
    //     isPublicFor || isPrivate ? [userFeedObject.userId] : [FEED_PUBLIC_FOR_ALL]
    // )

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedCreator,
        objectId: userId,
        // isPublicFor: userFeedObject.isPublicFor,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserDescriptionChangedFeed(
    projectId,
    user,
    userId,
    newDescription,
    oldDescription,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const parsedOldDescription = oldDescription && oldDescription !== 'Description unknown' ? oldDescription : 'Unknown'
    const parsedNewDescription = newDescription && newDescription !== 'Description unknown' ? newDescription : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed description • From ${parsedOldDescription} to ${parsedNewDescription}`,
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserAssistantChangedFeed(projectId, assistantId, userId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed user assistant`,
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    userFeedObject.assistantId = assistantId
    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        await batch.commit()
    }
}

export async function createUserFollowedFeed(
    projectId,
    user,
    userId,
    userFollowingId,
    externalBatch,
    creator,
    project
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the user',
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    let usersToNotifyIds = project ? project.userIds : []

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        usersToNotifyIds,
        projectId,
        'users',
        userId,
        batch,
        feedId,
        feed,
        userFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createUserUnfollowedFeed(projectId, user, userId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the user',
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'users', userId, batch, feedId, feed, userFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createUserFollowingAllMembersFeed(projectId, userId, externalBatch, creator, usersToNotifyIds) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_FOLLOWING_ALL_MEMBERS,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        usersToNotifyIds ? usersToNotifyIds : [],
        projectId,
        'users',
        userId,
        batch,
        feedId,
        feed,
        userFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createUserAllMembersFollowingFeed(projectId, userId, externalBatch, creator, usersToNotifyIds) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const userFeedObject = await loadFeedObject(
        projectId,
        userId,
        'users',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_ALL_MEMBERS_FOLLOWING,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: userId,
    })

    globalInnerFeedsGenerator(projectId, 'users', userId, feed, feedId, feedCreator.uid, batch)

    updateUserFeedObject(projectId, currentDateFormated, userId, userFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(
        currentDateFormated,
        usersToNotifyIds ? usersToNotifyIds : [],
        projectId,
        'users',
        userId,
        batch,
        feedId,
        feed,
        userFeedObject,
        {
            creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
            creatorPhotoURL: feedCreator.photoURL,
        }
    )

    if (!externalBatch) {
        batch.commit()
    }
}
