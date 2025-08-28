const { intersection, uniq, isEqual } = require('lodash')

const { FOLLOWER_NOTES_TYPE } = require('../Followers/FollowerConstants')
const { addFollowers } = require('../Followers/followerHelper')
const {
    getMentionedUsersIdsWhenEditText,
    insertFollowersUserToFeedChain,
    cleanFeeds,
    cleanObjectFeeds,
} = require('./globalFeedsHelper')
const { getGlobalState } = require('../GlobalState/globalState')
const {
    createNoteCreatedFeed,
    createNotePrivacyChangedFeed,
    createNoteHighlightedChangedFeed,
    createNoteStickyFeed,
    createNoteUpdatedFeed,
    createNoteOwnerChangedFeed,
    createNoteNameChangedFeed,
} = require('./notesFeeds')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getUserData } = require('../Users/usersFirestore')

async function createNoteFeedsChain(
    projectId,
    noteId,
    note,
    needCleanGlobalFeeds,
    otherFollowersIds,
    needGenerateNotification
) {
    const { appAdmin, feedCreator, project } = getGlobalState()

    const batch = new BatchWrapper(appAdmin.firestore())

    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(note.extendedTitle, ''))

    const followerIds = uniq([...mentionedUserIds, note.userId, feedCreator.uid, ...otherFollowersIds])
    insertFollowersUserToFeedChain(followerIds, noteId, batch)

    await createNoteCreatedFeed(projectId, note, noteId, batch, feedCreator, needGenerateNotification)

    if (note.isPrivate) {
        await createNotePrivacyChangedFeed(
            projectId,
            noteId,
            true,
            note.isPublicFor,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const hasStar = note.hasStar.toLowerCase() !== '#ffffff'
    if (hasStar) {
        await createNoteHighlightedChangedFeed(
            projectId,
            noteId,
            note.hasStar,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (note.stickyData.days > 0) {
        await createNoteStickyFeed(
            projectId,
            note.stickyData.days,
            noteId,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const followData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        followObject: note,
    }

    await addFollowers(projectId, followerIds, followData, batch, needGenerateNotification)

    await batch.commit()

    if (needCleanGlobalFeeds) {
        await cleanFeeds(projectId, noteId, 'notes')
    } else {
        await cleanObjectFeeds(projectId, noteId, 'notes')
    }
}

async function updateNoteFeedsChain(
    projectId,
    noteId,
    note,
    oldNote,
    needCleanGlobalFeeds,
    otherFollowersIds,
    needGenerateNotification
) {
    const { appAdmin, feedCreator, project } = getGlobalState()

    const batch = new BatchWrapper(appAdmin.firestore())

    const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(note.extendedTitle, ''))

    const followerIds = uniq([...mentionedUserIds, note.userId, feedCreator.uid, ...otherFollowersIds])
    insertFollowersUserToFeedChain(followerIds, noteId, batch)

    await createNoteUpdatedFeed(projectId, noteId, batch, feedCreator, needGenerateNotification)

    if (note.userId !== oldNote.userId) {
        const promises = []
        promises.push(getUserData(note.userId))
        promises.push(getUserData(oldNote.userId))
        const [newOwner, oldOwner] = await Promise.all(promises)
        await createNoteOwnerChangedFeed(
            projectId,
            newOwner,
            oldOwner,
            noteId,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (note.extendedTitle !== oldNote.extendedTitle) {
        await createNoteNameChangedFeed(
            projectId,
            oldNote.extendedTitle,
            note.extendedTitle,
            noteId,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (!isEqual(note.isPublicFor, oldNote.isPublicFor)) {
        await createNotePrivacyChangedFeed(
            projectId,
            noteId,
            note.isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
            note.isPublicFor,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (note.hasStar !== oldNote.hasStar) {
        await createNoteHighlightedChangedFeed(
            projectId,
            noteId,
            note.hasStar,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    if (!isEqual(note.stickyData, oldNote.stickyData)) {
        await createNoteStickyFeed(
            projectId,
            note.stickyData.days,
            noteId,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const followData = {
        followObjectsType: FOLLOWER_NOTES_TYPE,
        followObjectId: noteId,
        followObject: note,
    }

    await addFollowers(projectId, followerIds, followData, batch, needGenerateNotification)

    await batch.commit()

    if (needCleanGlobalFeeds) {
        await cleanFeeds(projectId, noteId, 'notes')
    } else {
        await cleanObjectFeeds(projectId, noteId, 'notes')
    }
}

module.exports = { createNoteFeedsChain, updateNoteFeedsChain }
