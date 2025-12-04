const admin = require('firebase-admin')
const moment = require('moment')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

/**
 * Creates an initial status message from the assistant with proper notifications and updates
 * @param {string} projectId - Project ID
 * @param {string} objectType - Type of object ('tasks', 'notes', 'goals', 'topics')
 * @param {string} objectId - ID of the parent object
 * @param {string} assistantId - ID of the assistant
 * @param {string} statusMessage - The status message text
 * @param {Array} userIdsToNotify - Users to notify
 * @param {Array} isPublicFor - Visibility settings
 * @param {Array} followerIds - Follower IDs
 * @returns {Promise<string>} The comment ID
 */
async function createInitialStatusMessage(
    projectId,
    objectType,
    objectId,
    assistantId,
    statusMessage,
    userIdsToNotify,
    isPublicFor,
    followerIds = []
) {
    console.log('📝 STATUS MESSAGE: Creating initial status message:', {
        projectId,
        objectType,
        objectId,
        assistantId,
        statusMessage,
        userIdsToNotifyCount: userIdsToNotify?.length,
        followerIdsCount: followerIds?.length,
    })

    const commentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
    const now = Date.now()

    // Get current follower IDs (will merge with any existing followers)
    const currentFollowerIds = await getCurrentFollowerIds(followerIds, projectId, objectType, objectId, isPublicFor)

    // Ensure chat object exists before creating comments
    await ensureChatExists(projectId, objectType, objectId, assistantId, currentFollowerIds, isPublicFor)

    // Create the comment
    const comment = {
        creatorId: assistantId,
        commentText: statusMessage,
        commentType: 'STAYWARD_COMMENT',
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        originalContent: statusMessage,
        fromAssistant: true,
    }

    // Create comment in Firestore
    await admin
        .firestore()
        .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
        .set(comment)

    // Update chat object with the new comment
    await admin
        .firestore()
        .doc(`chatObjects/${projectId}/chats/${objectId}`)
        .update({
            lastEditionDate: Date.now(),
            [`commentsData.lastCommentOwnerId`]: assistantId,
            [`commentsData.lastComment`]: statusMessage,
            [`commentsData.lastCommentType`]: 'STAYWARD_COMMENT',
            [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
        })

    // Update last comment data on parent object
    await updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, statusMessage, 'STAYWARD_COMMENT')

    // Update last assistant comment data
    await updateLastAssistantCommentData(projectId, objectType, objectId, currentFollowerIds, assistantId)

    // Get chat data for notifications (it definitely exists now)
    const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
    const chat = chatDoc.data()

    // Generate notifications
    await generateNotificationsForStatusMessage(
        projectId,
        objectType,
        objectId,
        userIdsToNotify,
        chat?.title || 'Task',
        assistantId,
        commentId,
        statusMessage,
        currentFollowerIds
    )

    console.log('✅ STATUS MESSAGE: Successfully created status message with ID:', commentId)

    return commentId
}

/**
 * Ensure chat object exists for the given parent object
 */
async function ensureChatExists(projectId, objectType, objectId, assistantId, followerIds, isPublicFor) {
    const chatRef = admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`)
    const chatDoc = await chatRef.get()

    if (!chatDoc.exists) {
        console.log('📝 STATUS MESSAGE: Creating chat object for', objectId)

        // Get parent object data for title
        const parentPath = getParentObjectPath(projectId, objectType, objectId)
        let title = 'Task'

        if (parentPath) {
            try {
                const parentDoc = await admin.firestore().doc(parentPath).get()
                if (parentDoc.exists) {
                    const parentData = parentDoc.data()
                    title = parentData.extendedName || parentData.name || 'Task'
                }
            } catch (error) {
                console.error('Error getting parent object:', error)
            }
        }

        // Create chat object with Date.now() timestamps
        await chatRef.set({
            id: objectId,
            projectId: projectId,
            creatorId: followerIds[0] || assistantId,
            created: Date.now(),
            lastEditionDate: Date.now(),
            lastEditorId: followerIds[0] || assistantId,
            title: title,
            type: objectType, // Use 'type' field, not 'objectType'
            assistantId: assistantId,
            followerIds: followerIds || [],
            usersFollowing: followerIds || [], // Add usersFollowing field
            members: followerIds && followerIds.length > 0 ? [followerIds[0], assistantId] : [assistantId],
            isPublicFor: isPublicFor || [],
            hasStar: '#ffffff',
            quickDateId: '',
            stickyData: { days: 0, stickyEndDate: 0 },
            commentsData: {
                amount: 0,
                lastComment: '',
                lastCommentOwnerId: '',
                lastCommentType: '',
            },
        })

        console.log('✅ STATUS MESSAGE: Chat object created successfully')
    } else {
        console.log('📝 STATUS MESSAGE: Chat object already exists for', objectId)
    }
}

/**
 * Get current follower IDs for the chat object
 */
async function getCurrentFollowerIds(followerIds, projectId, objectType, objectId, isPublicFor) {
    if (!followerIds || followerIds.length === 0) {
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
        if (chatDoc.exists) {
            const chat = chatDoc.data()
            return chat.followerIds || []
        }
        return []
    }
    return followerIds
}

/**
 * Update last comment data on the parent object (task, note, goal, etc.)
 */
async function updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, commentText, commentType) {
    const parentPath = getParentObjectPath(projectId, objectType, objectId)
    if (!parentPath) return

    try {
        // Only update commentsData, not lastChangeDate to avoid race conditions with frontend updates
        await admin
            .firestore()
            .doc(parentPath)
            .update({
                [`commentsData.lastComment`]: commentText?.substring(0, 500) || '',
                [`commentsData.lastCommentType`]: commentType,
            })
    } catch (error) {
        console.error('Error updating parent object comment data:', error)
        // Don't throw - this is a non-critical update
    }
}

/**
 * Get the Firestore path for the parent object
 */
function getParentObjectPath(projectId, objectType, objectId) {
    switch (objectType) {
        case 'tasks':
            return `items/${projectId}/tasks/${objectId}`
        case 'notes':
            return `notes/${projectId}/notes/${objectId}`
        case 'goals':
            return `goals/${projectId}/goals/${objectId}`
        case 'topics':
            return `chatObjects/${projectId}/chats/${objectId}`
        default:
            return null
    }
}

/**
 * Update last assistant comment data
 */
async function updateLastAssistantCommentData(projectId, objectType, objectId, followerIds, assistantId) {
    try {
        await admin
            .firestore()
            .doc(`chatObjects/${projectId}/chats/${objectId}`)
            .update({
                lastAssistantComment: Date.now(),
                followerIds: followerIds || [],
                assistantId: assistantId,
            })
    } catch (error) {
        console.error('Error updating last assistant comment data:', error)
    }
}

/**
 * Generate notifications for the status message
 */
async function generateNotificationsForStatusMessage(
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    objectName,
    assistantId,
    commentId,
    statusMessage,
    followerIds
) {
    const safeFollowerIds = followerIds || []

    if (safeFollowerIds.length === 0 && (!userIdsToNotify || userIdsToNotify.length === 0)) {
        console.log('No followers or users to notify')
        return
    }

    const batch = new BatchWrapper(admin.firestore())
    const messageTimestamp = moment().utc().valueOf()
    const followersMap = {}
    safeFollowerIds.forEach(followerId => {
        followersMap[followerId] = true
    })

    // Create internal notifications
    if (safeFollowerIds.length > 0 || (userIdsToNotify && userIdsToNotify.length > 0)) {
        createChatInternalNotifications(
            projectId,
            objectId,
            objectType,
            commentId,
            followersMap,
            userIdsToNotify,
            assistantId,
            batch
        )
    }

    await batch.commit()
}

/**
 * Create internal notifications (in-app notifications)
 */
function createChatInternalNotifications(
    projectId,
    objectId,
    objectType,
    commentId,
    followersMap,
    userIdsToNotify,
    assistantId,
    batch
) {
    const notificationId = Date.now().toString() + Math.random().toString(36).substring(2, 9)
    const timestamp = Date.now()

    // Create notification for each user
    const usersToNotify = userIdsToNotify || []
    usersToNotify.forEach(userId => {
        if (userId !== assistantId) {
            // Don't notify the assistant itself
            const notificationRef = admin
                .firestore()
                .doc(`notifications/${userId}/notifications/${notificationId}-${userId}`)
            batch.set(notificationRef, {
                projectId,
                objectId,
                objectType,
                commentId,
                creatorId: assistantId,
                timestamp,
                read: false,
                type: 'chat_message',
            })
        }
    })
}

module.exports = {
    createInitialStatusMessage,
}
