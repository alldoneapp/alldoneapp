import { ALL_TAB } from '../../Feeds/Utils/FeedsConstants'

export const isUnreadChat = (projectNotifications, chatId, chatsActiveTab) => {
    const chatNotifications = projectNotifications?.[chatId]
    if (!chatNotifications) return false

    return chatsActiveTab === ALL_TAB
        ? chatNotifications.totalFollowed > 0 || chatNotifications.totalUnfollowed > 0
        : chatNotifications.totalFollowed > 0
}

export const getUnreadThreadCount = (projectChatNotifications, projectIds, chatsActiveTab) =>
    projectIds.reduce((total, projectId) => {
        const projectNotifications = projectChatNotifications[projectId] || {}
        const unreadInProject = Object.keys(projectNotifications).filter(chatId =>
            isUnreadChat(projectNotifications, chatId, chatsActiveTab)
        ).length
        return total + unreadInProject
    }, 0)

const getLatestNotificationDate = (chatNotifications, chatsActiveTab) => {
    const followedNotifications = chatNotifications?.followedNotifications || []
    const unfollowedNotifications = chatsActiveTab === ALL_TAB ? chatNotifications?.unfollowedNotifications || [] : []

    return [...followedNotifications, ...unfollowedNotifications].reduce((latestDate, notification) => {
        const date = Number(notification?.date)
        return Number.isFinite(date) ? Math.max(latestDate, date) : latestDate
    }, 0)
}

export const getUnreadChatIds = (projectNotifications = {}, chatsActiveTab) =>
    Object.keys(projectNotifications)
        .filter(chatId => isUnreadChat(projectNotifications, chatId, chatsActiveTab))
        .map((chatId, index) => ({
            chatId,
            index,
            latestNotificationDate: getLatestNotificationDate(projectNotifications[chatId], chatsActiveTab),
        }))
        .sort(
            (a, b) =>
                b.latestNotificationDate - a.latestNotificationDate ||
                // Preserve the Firestore snapshot order for legacy notification
                // entries that do not include their dates.
                a.index - b.index
        )
        .map(({ chatId }) => chatId)

/**
 * The unread notifications of a single chat, oldest first, for the preview under a topic (AT-2256).
 *
 * Deliberately reproduces the row badge's own rule - `totalFollowed || totalUnfollowed`, i.e.
 * followed if there are any, otherwise unfollowed - rather than merging both sets. A user who
 * started following a topic part-way through has both kinds, and merging them would preview more
 * messages than the number printed next to them, which reads as a bug in the count.
 *
 * The tab still constrains it: the Followed tab never previews unfollowed notifications, matching
 * `isUnreadChat`. Deciding on the counters rather than the arrays keeps it aligned with the badge
 * even for legacy notification docs that carry no `commentId` - those are dropped here, because
 * there is no comment for them to point at, but they must not flip the choice of set.
 */
export const getUnreadNotifications = (chatNotifications, chatsActiveTab) => {
    if (!chatNotifications) return []

    const usesFollowed = (chatNotifications.totalFollowed || 0) > 0
    let notifications = []

    if (usesFollowed) {
        notifications = chatNotifications.followedNotifications || []
    } else if (chatsActiveTab === ALL_TAB) {
        notifications = chatNotifications.unfollowedNotifications || []
    }

    return notifications
        .filter(notification => !!notification?.commentId)
        .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0))
}

export const getUnreadCommentIds = (chatNotifications, chatsActiveTab) =>
    getUnreadNotifications(chatNotifications, chatsActiveTab).map(({ commentId }) => commentId)

export const filterChatsByUnread = (chatsByDate, projectNotifications, chatsActiveTab) =>
    Object.keys(chatsByDate).reduce((filteredChats, date) => {
        const unreadChats = chatsByDate[date].filter(chat =>
            isUnreadChat(projectNotifications, chat.id, chatsActiveTab)
        )
        if (unreadChats.length > 0) filteredChats[date] = unreadChats
        return filteredChats
    }, {})

export const filterStickyChatsByUnread = (chats, projectNotifications, chatsActiveTab) =>
    chats.filter(chat => isUnreadChat(projectNotifications, chat.id, chatsActiveTab))
