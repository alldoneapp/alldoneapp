'use strict'

/**
 * Updates-feed entries for things that have no feed object of their own (a milestone, an OKR) and
 * are therefore listed on their project's feed object, as "<actor> <entryText>" lines.
 *
 * The project's feed object is always visible to the whole project, but such a thing can be
 * private: an OKR can be private to its owner, and in a guide project every member has their own
 * milestones. The entry then carries the narrower `isPublicFor`, from which the access projection
 * derives its readerIds, the unread counters go only to that audience (increaseFeedCount reads the
 * entry's isPublicFor), and the entry is written only into the followed stores of followers who
 * may read it. A member who may not read it therefore finds nothing of it anywhere, not even a
 * document they cannot open.
 *
 * Callers load the feed global state first (loadFeedsStateForContactWrite), like every other
 * server feed writer.
 */

const { uniq } = require('lodash')

const {
    generateCurrentDateObject,
    generateFeedModel,
    proccessFeed,
    loadFeedObject,
    getObjectFollowersIds,
} = require('./globalFeedsHelper')
const { generateProjectObjectModel } = require('./projectsFeeds')

const FEED_PUBLIC_FOR_ALL = 0

const isProjectWide = isPublicFor =>
    !Array.isArray(isPublicFor) || isPublicFor.length === 0 || isPublicFor.includes(FEED_PUBLIC_FOR_ALL)

// The followers of the project's feed object who may read this entry. Read once per batch, because
// one tool call can write several entries on the same project.
async function setEntryFollowers(projectId, isPublicFor, feedUser, batch) {
    if (!batch.projectEntryFollowerIds) batch.projectEntryFollowerIds = {}
    if (!batch.projectEntryFollowerIds[projectId]) {
        batch.projectEntryFollowerIds[projectId] = await getObjectFollowersIds(projectId, 'projects', projectId)
    }
    const followerIds = uniq([...batch.projectEntryFollowerIds[projectId], feedUser.uid])
    batch.followersIds = {
        ...batch.followersIds,
        [projectId]: isProjectWide(isPublicFor)
            ? followerIds
            : followerIds.filter(userId => isPublicFor.includes(userId)),
    }
}

async function createProjectEntryFeed({
    projectId,
    project,
    feedType,
    entryText,
    isPublicFor,
    extraFields = {},
    batch,
    feedUser,
    needGenerateNotification = true,
}) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    let projectFeedObject = await loadFeedObject(projectId, projectId, 'projects', currentMilliseconds, batch)
    if (!projectFeedObject) {
        projectFeedObject = generateProjectObjectModel(currentMilliseconds, project || {}, projectId)
        batch.feedObjects = { ...batch.feedObjects, [projectId]: projectFeedObject }
    }
    projectFeedObject.lastChangeDate = currentMilliseconds
    projectFeedObject.name = project?.name || projectFeedObject.name
    projectFeedObject.color = project?.color || projectFeedObject.color || ''

    const audience = isProjectWide(isPublicFor) ? projectFeedObject.isPublicFor || [FEED_PUBLIC_FOR_ALL] : isPublicFor
    const { feed, feedId } = generateFeedModel({
        feedType,
        lastChangeDate: currentMilliseconds,
        entryText,
        feedUser,
        objectId: projectId,
        isPublicFor: audience,
    })
    Object.assign(feed, extraFields)

    await setEntryFollowers(projectId, audience, feedUser, batch)

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        projectId,
        'projects',
        projectFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification,
        project ? { project } : {}
    )
    return { feedId, feed }
}

module.exports = { createProjectEntryFeed, isProjectWide }
