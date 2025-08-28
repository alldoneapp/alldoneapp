const { generateCurrentDateObject, generateFeedModel, proccessFeed, loadFeedObject } = require('./globalFeedsHelper')

const {
    FEED_ASSISTANT_CREATED,
    FEED_ASSISTANT_FOLLOWED,
    FEED_ASSISTANT_DESCRIPTION_CHANGED,
} = require('./FeedsConstants')
const { generateAssistantObjectModel } = require('./assistantsFeedsHelper')
const { shrinkTagText } = require('../Utils/parseTextUtils')

async function createAssistantCreatedFeed(
    projectId,
    assistant,
    assistantId,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()

    const assistantFeedObject = generateAssistantObjectModel(currentMilliseconds, assistant, assistantId)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_CREATED,
        lastChangeDate: currentMilliseconds,
        entryText: `created assistant`,
        feedUser,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    batch.feedObjects = { [assistantId]: assistantFeedObject }

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        assistantId,
        'assistants',
        assistantFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createAssistantFollowedFeed(projectId, assistantId, batch, feedUser, needGenerateNotification) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const assistantFeedObject = await loadFeedObject(projectId, assistantId, 'assistants', currentMilliseconds, batch)

    if (!assistantFeedObject) return

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_FOLLOWED,
        lastChangeDate: currentMilliseconds,
        entryText: 'started following the assistant',
        feedUser,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        assistantId,
        'assistants',
        assistantFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

async function createAssistantDescriptionChangedFeed(
    projectId,
    assistantId,
    oldDescription,
    newDescription,
    batch,
    feedUser,
    needGenerateNotification
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const assistantFeedObject = await loadFeedObject(projectId, assistantId, 'assistants', currentMilliseconds, batch)

    if (!assistantFeedObject) return

    const simpleNewDesc = shrinkTagText(newDescription, 50)
    const simpleOldDesc = shrinkTagText(oldDescription, 50)

    const { feed, feedId } = generateFeedModel({
        feedType: FEED_ASSISTANT_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed assistant description • From ${simpleOldDesc} to ${simpleNewDesc}`,
        feedUser,
        objectId: assistantId,
        isPublicFor: assistantFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        assistantId,
        'assistants',
        assistantFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

module.exports = {
    createAssistantCreatedFeed,
    createAssistantFollowedFeed,
    createAssistantDescriptionChangedFeed,
}
