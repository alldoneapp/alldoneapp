'use strict'

// Writes the private Updates line of the assistant profile (see assistantProfileFeedModel.js): one
// line per changed version, and one when the monthly Gold limit pauses it. Same documents and shapes
// as the wiki's line (KnowledgeBase/knowledgeWikiFeed.js), with one audience, the user:
//   projectsFeeds/{p}/{day}/assistantProfile_{uid}        the day's object, private to the user
//   feedsObjectsLastStates/{p}/assistantProfiles/{id}     its last state (the rules read its isPublicFor)
//   feedsStore/{p}/all/{feedId} and the user's "followed" copy
//   feedsCount/{p}/{uid}/followed                         one unread slot per day, replaced, not added
// The access-projection triggers on feedsStore and projectsFeeds add the readerIds the Updates
// queries filter on, exactly as for every other server-written feed.

const moment = require('moment')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const {
    ASSISTANT_PROFILE_COUNTER_ID,
    ASSISTANT_PROFILE_FEED_OBJECT_TYPE,
    buildAssistantProfilePausedFeed,
    buildAssistantProfileUpdatedFeed,
    generateAssistantProfileFeedObjectModel,
    getAssistantProfileFeedObjectId,
} = require('./assistantProfileFeedModel')

// Cloud Functions run in UTC, and that is the day the client falls back to when it looks the object
// up (utils/backends/Feeds/feedObjectDate.js).
const getFeedDay = lastChangeDate => moment.utc(lastChangeDate).format('DDMMYYYY')

// The user's default project, if they are still a member of it. No such project: no line.
async function resolveFeedProjectId(db, userId, userData) {
    const projectId = typeof userData?.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (!projectId) return null
    const snapshot = await db.doc(`projects/${projectId}`).get()
    const userIds = snapshot.exists && Array.isArray(snapshot.data()?.userIds) ? snapshot.data().userIds : []
    return userIds.includes(userId) ? projectId : null
}

async function publishAssistantProfileFeed({ db, userId, userData, revision = null, pausedMonth = null, now }) {
    const built = Number.isInteger(revision)
        ? buildAssistantProfileUpdatedFeed({ userId, revision, lastChangeDate: now })
        : buildAssistantProfilePausedFeed({ userId, month: pausedMonth, lastChangeDate: now })
    if (!built) return { published: false, reason: 'invalid' }

    const projectId = await resolveFeedProjectId(db, userId, userData)
    if (!projectId) return { published: false, reason: 'no-default-project' }

    const { feedId, feed } = built
    const dateFormated = getFeedDay(feed.lastChangeDate)
    const objectId = getAssistantProfileFeedObjectId(userId)
    const feedObject = generateAssistantProfileFeedObjectModel(feed.lastChangeDate, userId)
    const batch = new BatchWrapper(db)
    batch.set(db.doc(`projectsFeeds/${projectId}/${dateFormated}/${objectId}`), feedObject, { merge: true })
    batch.set(
        db.doc(`feedsObjectsLastStates/${projectId}/${ASSISTANT_PROFILE_FEED_OBJECT_TYPE}/${objectId}`),
        feedObject,
        { merge: true }
    )
    batch.set(db.doc(`feedsStore/${projectId}/all/${feedId}`), feed, { merge: true })
    batch.set(db.doc(`feedsStore/${projectId}/${userId}/feeds/followed/${feedId}`), feed, { merge: true })
    batch.set(
        db.doc(`feedsCount/${projectId}/${userId}/followed`),
        {
            [ASSISTANT_PROFILE_FEED_OBJECT_TYPE]: {
                [objectId]: { [ASSISTANT_PROFILE_COUNTER_ID]: { dateFormated, feed } },
            },
        },
        { merge: true }
    )
    await batch.commit()
    return { published: true, projectId, feedId }
}

module.exports = {
    resolveFeedProjectId,
    publishAssistantProfileFeed,
}
