const {
    generateCurrentDateObject,
    generateFeedModel,
    proccessFeed,
    loadFeedObject,
    addPrivacyForFeedObject,
} = require('./globalFeedsHelper')
const { generateNoteObjectModel } = require('./notesFeedsHelper')
const { getTaskNameWithoutMeta, FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const {
    FEED_NOTE_CREATED,
    FEED_NOTE_FOLLOWED,
    FEED_NOTE_PRIVACY_CHANGED,
    FEED_NOTE_HIGHLIGHTED_CHANGED,
    FEED_NOTE_STICKY,
    FEED_NOTE_TITLE_CHANGED,
    FEED_NOTE_OWNER_CHANGED,
    FEED_NOTE_UPDATED,
} = require('./FeedsConstants')

async function createNoteCreatedFeed(projectId, note, noteId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const noteFeedObject = generateNoteObjectModel(currentMilliseconds, note, noteId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: 'created note',
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    batch.feedObjects = { [noteId]: noteFeedObject }

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNoteFollowedFeed(projectId, noteId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the note',
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNotePrivacyChangedFeed(
    projectId,
    noteId,
    isPrivate,
    isPublicFor,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    await addPrivacyForFeedObject(
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
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNoteHighlightedChangedFeed(projectId, noteId, hasStar, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    const highlightedState = hasStar ? 'highlighted' : 'unhighlighted'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_HIGHLIGHTED_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `${highlightedState} note`,
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNoteStickyFeed(projectId, days, noteId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_STICKY,
        lastChangeDate: currentMilliseconds,
        entryText: days > 30 ? `made sticky • Forever` : `made sticky • For ${days} ${days === 1 ? 'day' : 'days'}`,
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNoteNameChangedFeed(
    projectId,
    oldName,
    newName,
    noteId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    const simpleNewName = getTaskNameWithoutMeta(newName)
    const simpleOldName = getTaskNameWithoutMeta(oldName)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_TITLE_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed note title • From ${simpleOldName} to ${simpleNewName}`,
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    noteFeedObject.name = newName

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNoteOwnerChangedFeed(
    projectId,
    newOwner,
    oldOwner,
    noteId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_OWNER_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed note title • From ${simpleOldName} to ${simpleNewName}`,
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    feed.newOwnerId = newOwner.uid
    feed.oldOwnerId = oldOwner.uid

    noteFeedObject.userId = newOwner.uid

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createNoteUpdatedFeed(projectId, noteId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const noteFeedObject = await loadFeedObject(projectId, noteId, 'notes', currentMilliseconds, batch)
    if (!noteFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_NOTE_UPDATED,
        lastChangeDate: currentMilliseconds,
        entryText: 'updated note',
        feedUser,
        objectId: noteId,
        isPublicFor: noteFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        noteId,
        'notes',
        noteFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

module.exports = {
    createNoteCreatedFeed,
    createNoteFollowedFeed,
    createNotePrivacyChangedFeed,
    createNoteHighlightedChangedFeed,
    createNoteStickyFeed,
    createNoteNameChangedFeed,
    createNoteOwnerChangedFeed,
    createNoteUpdatedFeed,
}
