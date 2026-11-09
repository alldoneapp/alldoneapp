const admin = require('firebase-admin')

const { FOLLOWER_ASSISTANTS_TYPE } = require('../Followers/FollowerConstants')
const { addFollowers } = require('../Followers/followerHelper')
const { insertFollowersUserToFeedChain, cleanFeeds, cleanObjectFeeds } = require('./globalFeedsHelper')
const { getGlobalState } = require('../GlobalState/globalState')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createAssistantCreatedFeed, createAssistantDescriptionChangedFeed } = require('./assistantsFeeds')

async function createAssistantUpdatesChain(projectId, assistant, needCleanGlobalFeeds, needGenerateNotification) {
    const { feedCreator } = getGlobalState()
    const batch = new BatchWrapper(admin.firestore())

    const followerIds = [feedCreator.uid]
    insertFollowersUserToFeedChain(followerIds, assistant.uid, batch)

    await createAssistantCreatedFeed(projectId, assistant, assistant.uid, batch, feedCreator, needGenerateNotification)

    if (assistant.description.trim() !== '') {
        // Server argument order: (projectId, assistantId, oldDescription, newDescription, ...). This
        // call used the web helper's order and wrote under an empty assistant id.
        await createAssistantDescriptionChangedFeed(
            projectId,
            assistant.uid,
            '',
            assistant.description,
            batch,
            feedCreator,
            needGenerateNotification
        )
    }

    const followData = {
        followObjectsType: FOLLOWER_ASSISTANTS_TYPE,
        followObjectId: assistant.uid,
        followObject: assistant,
    }
    await addFollowers(projectId, followerIds, followData, batch, needGenerateNotification)

    await batch.commit()

    if (needCleanGlobalFeeds) {
        await cleanFeeds(projectId, assistant.uid, 'assistants')
    } else {
        await cleanObjectFeeds(projectId, assistant.uid, 'assistants')
    }
}

module.exports = { createAssistantUpdatesChain }
