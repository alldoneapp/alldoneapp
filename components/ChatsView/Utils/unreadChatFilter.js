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
 * The unread notifications of a single chat, for the active tab, oldest first.
 *
 * Mirrors `isUnreadChat`'s tab rule so the preview under a topic (AT-2256) can never disagree with
 * the row's own unread badge: the Followed tab only ever counts followed notifications, the All tab
 * counts both. Entries are `{ commentId, date }`; legacy notification docs without a `commentId`
 * are dropped because there is no comment for them to point at.
 */
export const getUnreadNotifications = (chatNotifications, chatsActiveTab) => {
    if (!chatNotifications) return []

    const followed = chatNotifications.followedNotifications || []
    const unfollowed = chatsActiveTab === ALL_TAB ? chatNotifications.unfollowedNotifications || [] : []

    return [...followed, ...unfollowed]
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
