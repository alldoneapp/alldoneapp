const { generateCurrentDateObject, generateFeedModel, proccessFeed, loadFeedObject } = require('./globalFeedsHelper')
const { FEED_USER_DESCRIPTION_CHANGED } = require('./FeedsConstants')

function generateFallbackUserObjectModel(currentMilliseconds, userId) {
    return {
        type: 'user',
        lastChangeDate: currentMilliseconds,
        userId,
    }
}

async function createUserDescriptionChangedFeed(
    projectId,
    userId,
    newDescription,
    oldDescription,
    batch,
    feedUser,
    needGenerateNotification,
    descriptionLabel = 'description'
) {
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    const userFeedObject =
        (await loadFeedObject(projectId, userId, 'users', currentMilliseconds, batch)) ||
        generateFallbackUserObjectModel(currentMilliseconds, userId)

    const parsedOldDescription = oldDescription ? oldDescription : 'Unknown'
    const parsedNewDescription = newDescription ? newDescription : 'Unknown'
    const { feed, feedId } = generateFeedModel({
        feedType: FEED_USER_DESCRIPTION_CHANGED,
        lastChangeDate: currentMilliseconds,
        entryText: `changed ${descriptionLabel} • From ${parsedOldDescription} to ${parsedNewDescription}`,
        feedUser,
        objectId: userId,
        isPublicFor: userFeedObject.isPublicFor,
    })

    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        userId,
        'users',
        userFeedObject,
        feedId,
        feed,
        feedUser,
        batch,
        needGenerateNotification
    )
}

// MCP feed parity: contacts and moves
// update_user_description without a project changes users/{uid}, which belongs to no project; the
// entry is written on the user in their default project and says which description changed.
async function createUserGlobalDescriptionChangedFeed(
    projectId,
    userId,
    newDescription,
    oldDescription,
    batch,
    feedUser,
    needGenerateNotification
) {
    await createUserDescriptionChangedFeed(
        projectId,
        userId,
        newDescription,
        oldDescription,
        batch,
        feedUser,
        needGenerateNotification,
        'global description'
    )
}

module.exports = {
    createUserDescriptionChangedFeed,
    createUserGlobalDescriptionChangedFeed,
}
