'use strict'

// The Updates line for the assistant profile (AT-3072). Shared by the server, which writes it
// (assistantProfileFeed.js), and the web client, which renders it (components/Feeds/FeedsObjects/
// AssistantProfileObject.js); dependency-free so the client bundle can import it.
//
// The line replaces the daily message of the old recurring task: the profile changes quietly at
// night, and the user sees one line in Updates the next morning, with a link to what changed. It is
// private to the user (isPublicFor: [uid] on the object and on every entry) because the profile is
// private, and it carries no profile text: the change view reads the revision itself, from the
// owner-only assistantProfiles tree.
//
// It goes into the user's default project, the one project every user has and the one the old
// global description feed used. projectsFeeds/{p}/{day}/{id} is keyed by object id alone, so the id
// is "assistantProfile_<uid>": a fixed id would let two members' lines overwrite each other, and the
// bare user id is already the id of the user's own 'users' feed object (their description, role and
// so on) in the same project, which the profile's object would overwrite on any day both change.

const ASSISTANT_PROFILE_FEED_OBJECT_TYPE = 'assistantProfiles'
const FEED_ASSISTANT_PROFILE_UPDATED = 'FEED_ASSISTANT_PROFILE_UPDATED'
const FEED_ASSISTANT_PROFILE_PAUSED = 'FEED_ASSISTANT_PROFILE_PAUSED'
const FEED_ASSISTANT_PROFILE_TYPES = [FEED_ASSISTANT_PROFILE_UPDATED, FEED_ASSISTANT_PROFILE_PAUSED]
const ASSISTANT_PROFILE_FEED_AUTHOR_ID = 'assistantProfile'
// One unread slot per user and day: a second change the same day replaces the first instead of
// adding to the counter document, which is copied into the user's activity summary.
const ASSISTANT_PROFILE_COUNTER_ID = 'assistant_profile'

const ASSISTANT_PROFILE_ENTRY_TEXTS = {
    [FEED_ASSISTANT_PROFILE_UPDATED]: 'updated your assistant profile',
    [FEED_ASSISTANT_PROFILE_PAUSED]: 'paused your assistant profile: the monthly Gold limit is reached',
}

const safeIdPart = value => String(value).replace(/[^A-Za-z0-9_-]/g, '_')

function getAssistantProfileFeedObjectId(userId) {
    return `assistantProfile_${safeIdPart(userId)}`
}

function buildAssistantProfileFeedId(userId, kind, key) {
    return `${getAssistantProfileFeedObjectId(userId)}_${safeIdPart(kind)}_${safeIdPart(key)}`
}

function buildAssistantProfileUpdatedFeed({ userId, revision, lastChangeDate }) {
    const revisionNumber = Number(revision)
    if (!userId || !Number.isInteger(revisionNumber) || revisionNumber < 1) return null
    return {
        feedId: buildAssistantProfileFeedId(userId, 'r', revisionNumber),
        feed: {
            type: FEED_ASSISTANT_PROFILE_UPDATED,
            lastChangeDate,
            creatorId: ASSISTANT_PROFILE_FEED_AUTHOR_ID,
            objectId: getAssistantProfileFeedObjectId(userId),
            isPublicFor: [userId],
            entryText: ASSISTANT_PROFILE_ENTRY_TEXTS[FEED_ASSISTANT_PROFILE_UPDATED],
            profileRevision: revisionNumber,
        },
    }
}

function buildAssistantProfilePausedFeed({ userId, month, lastChangeDate }) {
    if (!userId || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null
    return {
        feedId: buildAssistantProfileFeedId(userId, 'cap', month),
        feed: {
            type: FEED_ASSISTANT_PROFILE_PAUSED,
            lastChangeDate,
            creatorId: ASSISTANT_PROFILE_FEED_AUTHOR_ID,
            objectId: getAssistantProfileFeedObjectId(userId),
            isPublicFor: [userId],
            entryText: ASSISTANT_PROFILE_ENTRY_TEXTS[FEED_ASSISTANT_PROFILE_PAUSED],
            profileMonth: month,
        },
    }
}

function generateAssistantProfileFeedObjectModel(lastChangeDate, userId) {
    return {
        type: ASSISTANT_PROFILE_FEED_OBJECT_TYPE,
        lastChangeDate,
        name: 'Assistant profile',
        privacy: 'private',
        userId,
        isPrivate: true,
        isPublicFor: [userId],
        isDeleted: false,
    }
}

// What a line points at, validated, because it decides which revision the change view reads.
function getAssistantProfileFeedRevision(feed) {
    if (!feed || feed.type !== FEED_ASSISTANT_PROFILE_UPDATED) return null
    const revision = Number(feed.profileRevision)
    return Number.isInteger(revision) && revision >= 1 ? revision : null
}

module.exports = {
    ASSISTANT_PROFILE_FEED_OBJECT_TYPE,
    FEED_ASSISTANT_PROFILE_UPDATED,
    FEED_ASSISTANT_PROFILE_PAUSED,
    FEED_ASSISTANT_PROFILE_TYPES,
    ASSISTANT_PROFILE_FEED_AUTHOR_ID,
    ASSISTANT_PROFILE_COUNTER_ID,
    ASSISTANT_PROFILE_ENTRY_TEXTS,
    getAssistantProfileFeedObjectId,
    buildAssistantProfileFeedId,
    buildAssistantProfileUpdatedFeed,
    buildAssistantProfilePausedFeed,
    generateAssistantProfileFeedObjectModel,
    getAssistantProfileFeedRevision,
}
