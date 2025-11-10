const { ALL_TAB } = require('../Feeds/FeedsConstants')
const { createTaskFollowedFeed } = require('../Feeds/tasksFeeds')
const { createGoalFollowedFeed } = require('../Feeds/goalsFeeds')
const { createContactFollowedFeed } = require('../Feeds/contactsFeeds')
const { createNoteFollowedFeed } = require('../Feeds/notesFeeds')
const { createAssistantFollowedFeed } = require('../Feeds/assistantsFeeds')

const { getFeedObjectLastState, deleteObjectFeedCounter } = require('../Feeds/globalFeedsHelper')
const { getGlobalState } = require('../GlobalState/globalState')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

function addFollowerWithoutFeeds(
    projectId,
    userFollowingId,
    followObjectsType,
    followObjectId,
    actionType,
    batch,
    followObject
) {
    const { admin, appAdmin } = getGlobalState()
    const entry = { [followObjectsType]: {} }
    entry[followObjectsType][followObjectId] = true
    const userFollowingRef = appAdmin.firestore().doc(`usersFollowing/${projectId}/entries/${userFollowingId}`)
    batch.set(userFollowingRef, entry, { merge: true })

    const followersRef = appAdmin.firestore().doc(`followers/${projectId}/${followObjectsType}/${followObjectId}`)
    batch.set(followersRef, { usersFollowing: admin.firestore.FieldValue.arrayUnion(userFollowingId) }, { merge: true })

    if (followObjectsType === 'notes' && actionType !== 'delete') {
        if (followObject) {
            const updateData = { followersIds: admin.firestore.FieldValue.arrayUnion(userFollowingId) }
            if (
                followObject.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                followObject.isPublicFor.includes(userFollowingId)
            ) {
                updateData.isVisibleInFollowedFor = admin.firestore.FieldValue.arrayUnion(userFollowingId)
            }
            appAdmin.firestore().doc(`noteItems/${projectId}/notes/${followObjectId}`).set(updateData, { merge: true })
        }
    }
}

async function addFollowerToChat(projectId, chatId, userId) {
    const { admin, appAdmin } = getGlobalState()
    const db = appAdmin.firestore()
    const doc = await db.doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    if (doc.exists) {
        const chat = doc.data()
        const { usersFollowing } = chat
        if (!usersFollowing.includes(uid)) {
            await db.doc(`chatObjects/${projectId}/chats/${chatId}`).update({
                usersFollowing: admin.firestore.FieldValue.arrayUnion(userId),
            })
        }
    }
}

async function addFollower(projectId, followData, batch, needGenerateNotification) {
    let { followObjectsType, followObjectId, followObject, feedUser, project, actionType } = followData
    const userFollowingId = feedUser.uid

    addFollowerWithoutFeeds(
        projectId,
        userFollowingId,
        followObjectsType,
        followObjectId,
        actionType,
        batch,
        followObject
    )
    await addFollowerToChat(projectId, followObjectId, userFollowingId)

    //if (!followObject) followObject = await getObject(projectId, followObjectId, followObjectsType)

    if (followObject && followObject.noteId) {
        addFollowerWithoutFeeds(projectId, userFollowingId, 'notes', followObject.noteId, null, batch, followObject)
    }

    if (followObjectsType === 'tasks') {
        await createTaskFollowedFeed(projectId, followObjectId, batch, feedUser, needGenerateNotification)

        const subtaskIds = followObject
            ? followObject.subtaskIds
            : await getFeedObjectLastState(projectId, followObjectsType, followObjectId).subtaskIds
        if (subtaskIds) {
            subtaskIds.forEach(subtaskId => {
                addFollowerWithoutFeeds(
                    projectId,
                    userFollowingId,
                    followObjectsType,
                    subtaskId,
                    null,
                    batch,
                    followObject
                )
                addFollowerToChat(projectId, subtaskId, userFollowingId)
            })
        }
    } else if (followObjectsType === 'contacts') {
        await createContactFollowedFeed(projectId, followObjectId, batch, feedUser, needGenerateNotification)
    } else if (followObjectsType === 'notes') {
        await createNoteFollowedFeed(projectId, followObjectId, batch, feedUser, needGenerateNotification)
    } else if (followObjectsType === 'goals') {
        await createGoalFollowedFeed(projectId, followObjectId, batch, feedUser, needGenerateNotification)
    } else if (followObjectsType === 'assistants') {
        await createAssistantFollowedFeed(projectId, followObjectId, batch, feedUser, needGenerateNotification)
    }

    deleteObjectFeedCounter(projectId, userFollowingId, followObjectId, followObjectsType, ALL_TAB, batch)
}

async function tryAddFollower(projectId, followData, externalBatch, needGenerateNotification) {
    const { appAdmin } = getGlobalState()
    const { followObjectsType, followObjectId, feedUser } = followData
    const userFollowingId = feedUser.uid
    const followedObjects = (
        await appAdmin.firestore().doc(`followers/${projectId}/${followObjectsType}/${followObjectId}`).get()
    ).data()
    if (
        !followedObjects ||
        !followedObjects.usersFollowing ||
        !followedObjects.usersFollowing.includes(userFollowingId)
    ) {
        await addFollower(projectId, followData, externalBatch, needGenerateNotification)
    }
}

async function addFollowers(projectId, followerIds, followData, batch, needGenerateNotification) {
    const { users } = getGlobalState()
    const promises = []
    users.forEach(user => {
        if (followerIds.includes(user.uid)) {
            promises.push(tryAddFollower(projectId, { ...followData, feedUser: user }, batch, needGenerateNotification))
        }
    })
    await Promise.all(promises)
}

module.exports = {
    addFollowers,
    tryAddFollower,
}
