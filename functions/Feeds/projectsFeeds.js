'use strict'

const { generateCurrentDateObject, generateFeedModel, proccessFeed, loadFeedObject } = require('./globalFeedsHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { FEED_PROJECT_DESCRIPTION_CHANGED } = require('./FeedsConstants')
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

module.exports = {
    createProjectDescriptionChangedFeed,
    generateProjectObjectModel,
}
