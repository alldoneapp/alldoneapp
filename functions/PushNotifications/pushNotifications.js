const admin = require('firebase-admin')
const { uniq } = require('lodash')

const { removeUserFcmTokens, getUserData } = require('../Users/usersFirestore')
const { getChatPushNotifications, removeChatPushNotifications } = require('../Chats/chatsFirestoreCloud')
const { divideArrayIntoSubgroups } = require('../Utils/HelperFunctionsCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

const getUsersMap = async userIds => {
    const promises = []
    userIds.forEach(userId => {
        promises.push(getUserData(userId))
    })
    const users = await Promise.all(promises)

    const usersMap = {}
    users.forEach(user => {
        if (user) usersMap[user.uid] = user
    })
    return usersMap
}

const getUsersMapToNotify = async notifications => {
    let allUserIds = []
    notifications.forEach(notification => {
        const { userIds } = notification
        allUserIds.push(...userIds)
    })
    allUserIds = uniq(allUserIds)

    return await getUsersMap(allUserIds)
}

const getUsersTokens = (userIds, usersMap) => {
    const tokensByUser = {}
    const tokens = []
    userIds.forEach(userId => {
        const user = usersMap[userId]

        const needToSendPushNotification =
            user && user.pushNotificationsStatus && user.fcmToken && user.fcmToken.length > 0
        if (needToSendPushNotification) {
            tokensByUser[user.uid] = user.fcmToken
            tokens.push(...user.fcmToken)
        }
    })
    return { tokensByUser, tokens }
}

const getTokensToRemove = (multiCastResponse, tokens, tokensByUser) => {
    const tokensToRemoveByUser = {}
    multiCastResponse.responses.forEach((resp, index) => {
        if (!resp.success) {
            const token = tokens[index]

            const userIdsWithTokens = Object.keys(tokensByUser)
            userIdsWithTokens.forEach(userId => {
                if (tokensByUser[userId].includes(token)) {
                    if (!tokensToRemoveByUser[userId]) tokensToRemoveByUser[userId] = []
                    tokensToRemoveByUser[userId].push(token)
                }
            })
        }
    })
    return tokensToRemoveByUser
}

const removeFailedTokens = async (multiCastResponses, tokens, tokensByUser) => {
    const batch = new BatchWrapper(admin.firestore())
    multiCastResponses.forEach(response => {
        if (response.failureCount > 0) {
            const tokensToRemoveByUser = getTokensToRemove(response, tokens, tokensByUser)
            Object.keys(tokensToRemoveByUser).forEach(userId => {
                removeUserFcmTokens(userId, tokensToRemoveByUser[userId], batch)
            })
        }
    })
    await batch.commit()
}

const generateNotificationMessages = (tokens, type, body, link) => {
    const tokensSubgroups = divideArrayIntoSubgroups(tokens, 500)
    const data = { type, body, link }

    const messages = []
    tokensSubgroups.forEach(tokens => {
        messages.push({ data, tokens })
    })
    return messages
}

const sendNotificationMessages = async messages => {
    const promises = []
    messages.forEach(message => {
        promises.push(admin.messaging().sendEachForMulticast(message))
    })
    return await Promise.all(promises)
}

const sendPushNotitifcation = async (notification, usersMap) => {
    const { userIds, body, link, type } = notification
    const { tokensByUser, tokens } = getUsersTokens(userIds, usersMap)
    const messages = generateNotificationMessages(tokens, type, body, link)
    const multiCastResponses = await sendNotificationMessages(messages)
    await removeFailedTokens(multiCastResponses, tokens, tokensByUser)
}

const sendAllNotifications = async (notifications, usersMap) => {
    const promises = []
    notifications.forEach(notification => {
        promises.push(sendPushNotitifcation(notification, usersMap))
    })
    await Promise.all(promises)
}

const processPushNotifications = async notifications => {
    const notificationsToProcess = notifications.filter(notification => notification.userIds.length > 0)
    const usersMap = await getUsersMapToNotify(notificationsToProcess)
    await sendAllNotifications(notificationsToProcess, usersMap)
}

const processChatPushNotifications = async () => {
    const notifications = await getChatPushNotifications()
    const promises = []
    promises.push(processPushNotifications(notifications))
    promises.push(removeChatPushNotifications(notifications))
    await Promise.all(promises)
}

module.exports = { processPushNotifications, processChatPushNotifications }
