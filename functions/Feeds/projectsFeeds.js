'use strict'

const { generateCurrentDateObject, generateFeedModel, proccessFeed, loadFeedObject } = require('./globalFeedsHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { FEED_PROJECT_ARCHIVED_UNARCHIVED, FEED_PROJECT_DESCRIPTION_CHANGED } = require('./FeedsConstants')
const { shrinkTagText } = require('../Utils/parseTextUtils')

function generateProjectObjectModel(currentMilliseconds, project = {}, projectId = '') {
    return {
        type: 'project',
        lastChangeDate: currentMilliseconds,
        name: project.name || 'Project',
        color: project.color || '',
        description: project.description || '',
        projectId,
        isPublicFor: [FEED_PUBLIC_FOR_ALL],
    }
}

async function createProjectDescriptionChangedFeed(
    projectId,
    project,
    newDescription,
    oldDescription,
    batch,
    feedUser,
    needGenerateNotification = false
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    let projectFeedObject = await loadFeedObject(projectId, projectId, 'projects', currentMilliseconds, batch)
    if (!projectFeedObject) {
        projectFeedObject = generateProjectObjectModel(currentMilliseconds, project, projectId)
        batch.feedObjects = { ...batch.feedObjects, [projectId]: projectFeedObject }
    }

    projectFeedObject.lastChangeDate = currentMilliseconds
    projectFeedObject.name = project?.name || projectFeedObject.name
    projectFeedObject.color = project?.color || projectFeedObject.color || ''
    projectFeedObject.description = newDescription

    const simpleOldDescription = shrinkTagText(oldDescription || '', 80) || '(empty)'
    const simpleNewDescription = shrinkTagText(newDescription || '', 80) || '(empty)'

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed description • From ${simpleOldDescription} to ${simpleNewDescription}`,
        feedUser,
        objectId: projectId,
        isPublicFor: projectFeedObject.isPublicFor,
    })

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
        { project }
    )
}

async function createProjectAutoArchivedFeed(projectId, project, inactiveDays, batch, feedUser) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    let projectFeedObject = await loadFeedObject(projectId, projectId, 'projects', currentMilliseconds, batch)
    if (!projectFeedObject) {
        projectFeedObject = generateProjectObjectModel(currentMilliseconds, project, projectId)
        batch.feedObjects = { ...batch.feedObjects, [projectId]: projectFeedObject }
    }

    projectFeedObject.lastChangeDate = currentMilliseconds
    projectFeedObject.name = project?.name || projectFeedObject.name
    projectFeedObject.color = project?.color || projectFeedObject.color || ''

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_PROJECT_ARCHIVED_UNARCHIVED,
        lastChangeDate: currentMilliseconds,
        entryText: `automatically archived project after ${inactiveDays} days without activity`,
        feedUser,
        objectId: projectId,
        isPublicFor: projectFeedObject.isPublicFor,
    })

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
        false,
        { project, disabledLastInteraction: true }
    )
}

// MCP feed parity: Gmail and Calendar. One Updates entry on the project for something an MCP client
// or an assistant did in the user's mailbox or calendar (see ./integrationToolFeeds.js, which builds
// the text and decides the project). Every store keys an entry by its id, so passing the `feedId` of
// an earlier entry rewrites that entry in place: that is how a burst of email changes stays ONE line
// ("archived 3 emails"). `notifyUserIds` names who gets the unread badge — the owner of the mailbox
// or calendar, not every member; the others still see the line in the project's Updates.
async function createProjectIntegrationActivityFeed(
    projectId,
    project,
    feedType,
    entryText,
    batch,
    feedUser,
    { feedId: existingFeedId = null, notifyUserIds = [], dateObject = null } = {}
) {
    const { currentDateFormated, currentMilliseconds } = dateObject || generateCurrentDateObject()

    let projectFeedObject = await loadFeedObject(projectId, projectId, 'projects', currentMilliseconds, batch)
    if (!projectFeedObject) {
        projectFeedObject = generateProjectObjectModel(currentMilliseconds, project, projectId)
        batch.feedObjects = { ...batch.feedObjects, [projectId]: projectFeedObject }
    }

    projectFeedObject.lastChangeDate = currentMilliseconds
    projectFeedObject.name = project?.name || projectFeedObject.name
    projectFeedObject.color = project?.color || projectFeedObject.color || ''

    const { feed, feedId: generatedFeedId } = generateFeedModel({
        feedType,
        lastChangeDate: currentMilliseconds,
        entryText,
        feedUser,
        objectId: projectId,
        isPublicFor: projectFeedObject.isPublicFor,
    })
    const feedId = existingFeedId || generatedFeedId
    const usersToNotify = (Array.isArray(notifyUserIds) ? notifyUserIds : []).filter(Boolean)

    await proccessFeed(
        projectId,
        currentDateFormated,
        usersToNotify,
        projectId,
        'projects',
        projectFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        usersToNotify.length > 0,
        { project, feedCreator: feedUser }
    )

    return { feedId }
}

module.exports = {
    createProjectAutoArchivedFeed,
    createProjectDescriptionChangedFeed,
    createProjectIntegrationActivityFeed,
    generateProjectObjectModel,
}
