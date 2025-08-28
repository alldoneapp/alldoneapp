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
        await createAssistantDescriptionChangedFeed(
            projectId,
            '',
            assistant.description,
            assistant.uid,
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
