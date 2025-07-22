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
    FEED_NOTE_BACKLINK,
    FEED_NOTE_CREATED,
    FEED_NOTE_DELETED,
    FEED_NOTE_EDITING,
    FEED_NOTE_FOLLOWED,
    FEED_NOTE_HIGHLIGHTED_CHANGED,
    FEED_NOTE_OWNER_CHANGED,
    FEED_NOTE_PRIVACY_CHANGED,
    FEED_NOTE_PROJECT_CHANGED_FROM,
    FEED_NOTE_PROJECT_CHANGED_TO,
    FEED_NOTE_STICKY,
    FEED_NOTE_TITLE_CHANGED,
    FEED_NOTE_UNFOLLOWED,
    FEED_PUBLIC_FOR_ALL,
    FEED_NOTE_ASSISTANT_CHANGED,
} from '../../../components/Feeds/Utils/FeedsConstants'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../HelperFunctions'
import { FOLLOWER_NOTES_TYPE } from '../../../components/Followers/FollowerConstants'

//COMMON

export function generateNoteObjectModel(currentMilliseconds, note = {}, noteId) {
    return {
        type: 'note',
        lastChangeDate: currentMilliseconds,
        noteId: noteId,
        name: note.extendedTitle ? note.extendedTitle : note.title,
        privacy: note.isPrivate ? note.userId : 'public',
        isPublicFor: note.isPublicFor ? note.isPublicFor : note.isPrivate ? [note.userId] : [FEED_PUBLIC_FOR_ALL],
        userId: note.userId,
        isDeleted: false,
        assistantId: note.assistantId || '',
    }
}

function updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, params, batch) {
    storeOldFeeds(projectId, currentDateFormated, noteId, noteFeedObject, feedId, feed)

    const loggedUserId = store.getState().loggedUser.uid
    if (!batch.feedChainFollowersIds || !batch.feedChainFollowersIds[noteId]) {
        batch.feedChainFollowersIds = { ...batch.feedChainFollowersIds, [noteId]: [loggedUserId] }
    }

    if (!batch.feedsCleaned) {
        batch.feedsCleaned = true
        const projectUsersIds = getProjectUsersIds(projectId)
        cleanStoreFeeds(projectId, projectUsersIds)
        cleanInnerFeeds(projectId, noteId, 'notes')
        cleanInnerFeeds(projectId, loggedUserId, 'users')
        cleanNewFeeds(projectId, projectUsersIds)
    }

    const feedObjectRef = getDb().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${noteId}`)
    batch.set(feedObjectRef, noteFeedObject, { merge: true })

    setFeedObjectLastState(projectId, 'notes', noteId, noteFeedObject, batch)
    processLocalFeeds(projectId, noteFeedObject, noteId, feed, feedId, params)
}

//UPDATES

export async function createNoteCreatedFeed(projectId, note, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const noteFeedObject = generateNoteObjectModel(currentMilliseconds, note, noteId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: 'created note',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    batch.feedObjects = { [noteId]: noteFeedObject }

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteFollowedFeed(projectId, noteId, userFollowingId, externalBatch, creator) {
    const feedCreator =
        creator && creator?.displayName ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the note',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteUnfollowedFeed(projectId, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : TasksHelper.getUserInProject(projectId, userFollowingId)
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_UNFOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'stopped following the note',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteNameChangedFeed(projectId, oldName, newName, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )
    const simpleNewName = TasksHelper.getTaskNameWithoutMeta(newName)
    const simpleOldName = TasksHelper.getTaskNameWithoutMeta(oldName)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed note title • From ${simpleOldName} to ${simpleNewName}`,
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    noteFeedObject.name = newName
    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteAssistantChangedFeed(projectId, assistantId, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_ASSISTANT_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed note assistant`,
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    noteFeedObject.assistantId = assistantId
    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteHighlightedChangedFeed(projectId, noteId, hasStar, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const highlightedState = hasStar ? 'highlighted' : 'unhighlighted'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} note`,
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNotePrivacyChangedFeed(projectId, noteId, isPrivate, isPublicFor, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    addPrivacyForFeedObject(
        projectId,
        isPrivate,
        noteFeedObject,
        noteId,
        'notes',
        isPublicFor || isPrivate ? [noteFeedObject.userId] : [FEED_PUBLIC_FOR_ALL]
    )

    const newPrivacy = isPrivate ? 'Private' : 'Public'
    const oldPrivacy = isPrivate ? 'Public' : 'Private'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_PRIVACY_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed privacy • From ${oldPrivacy} to ${newPrivacy}`,
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    // Start following all user with privacy access
    const followNoteData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        feedCreator: store.getState().loggedUser,
    }
    if (isPrivate) {
        for (let i = 0; i < isPublicFor.length; i++) {
            followNoteData.feedCreator = { uid: isPublicFor[i] }
            await tryAddFollower(projectId, followNoteData, batch)
        }
    }

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteOwnerChangedFeed(projectId, newOwner, oldOwner, note, externalBatch, creator) {
    const noteId = note.id
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_OWNER_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })
    feed.newOwnerId = newOwner.uid
    feed.oldOwnerId = oldOwner.uid

    noteFeedObject.userId = newOwner.uid
    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    // add followers
    const followData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        followObject: note,
        feedCreator: feedCreator,
    }
    await tryAddFollower(projectId, followData, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteDeletedFeed(projectId, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_DELETED,
        lastChangeDate: currentMilliseconds,
        entryText: 'deleted the note',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    noteFeedObject.isDeleted = true
    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteProjectChangedFeed(
    projectId,
    noteId,
    changeDirection,
    projectName,
    projectColor,
    externalBatch,
    creator
) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: changeDirection === 'to' ? FEED_NOTE_PROJECT_CHANGED_TO : FEED_NOTE_PROJECT_CHANGED_FROM,
        lastChangeDate: currentMilliseconds,
        entryText: '',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })
    feed.projectName = projectName
    feed.projectColor = projectColor
    feed.changeDirection = changeDirection

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteStickyFeed(projectId, days, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_STICKY,
        lastChangeDate: currentMilliseconds,
        entryText: days > 30 ? `made sticky • Forever` : `made sticky • For ${days} ${days === 1 ? 'day' : 'days'}`,
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createNoteEditingFeed(projectId, noteId, externalBatch, creator) {
    const feedCreator = creator ? creator : store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_EDITING,
        lastChangeDate: currentMilliseconds,
        entryText: 'started editing',
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch, true)

    if (!externalBatch) {
        batch.commit()
    }
}

export async function createBacklinkNoteFeed(projectId, objectId, objectType, noteId, externalBatch) {
    const objectLink = `${window.location.origin}/projects/${projectId}/${objectType}s/${objectId}/properties`

    const feedCreator = store.getState().loggedUser
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    const noteFeedObject = await loadFeedObject(
        projectId,
        noteId,
        'notes',
        currentDateFormated,
        currentMilliseconds,
        batch
    )

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_BACKLINK,
        lastChangeDate: currentMilliseconds,
        entryText: `added a backlink ${objectType} • `,
        feedCreator,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })
    feed.linkTag = objectLink

    updateNoteFeedObject(projectId, currentDateFormated, noteId, noteFeedObject, feed, feedId, null, batch)

    await increaseFeedCount(currentDateFormated, [], projectId, 'notes', noteId, batch, feedId, feed, noteFeedObject, {
        creatorName: HelperFunctions.getFirstName(feedCreator.displayName),
        creatorPhotoURL: feedCreator.photoURL,
    })

    globalInnerFeedsGenerator(projectId, 'notes', noteId, feed, feedId, feedCreator.uid, batch)

    if (!externalBatch) {
        batch.commit()
    }
}
