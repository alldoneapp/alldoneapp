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
 * Reproduces the row badge's own rule - `totalFollowed || totalUnfollowed`, i.e. followed if there
 * are any, otherwise unfollowed - rather than merging both sets. A user who started following a
 * topic part-way through has both kinds, and merging them would preview more messages than the
 * number printed next to them, which reads as a bug in the count.
 *
 * It is deliberately NOT narrowed by the active tab. That narrowing is what hid every email preview
 * (and, with it, the "Archive emails" / "Archive all emails" buttons that read the previews) on the
 * Followed tab: a Gmail informational email writes an *unfollowed* (grey) chat notification while
 * still adding the user to the chat's `usersFollowing`, so its "Daily emails ..." topic is listed on
 * the Followed tab, prints its grey unread badge there - and previewed nothing underneath it. The
 * badge in `ChatItem` is tab-independent, so anything that previews less than the badge counts
 * contradicts the row it sits in. `isUnreadChat` stays tab-scoped: it answers a different question
 * (does this chat count as unread *for this tab* - the unread-only filter and the tab's counters),
 * and previewing is about what a row that is already on screen is showing.
 *
 * Deciding on the counters rather than the arrays keeps it aligned with the badge even for legacy
 * notification docs that carry no `commentId` - those are dropped here, because there is no comment
 * for them to point at, but they must not flip the choice of set.
 */
export const getUnreadNotifications = chatNotifications => {
    if (!chatNotifications) return []

    const usesFollowed = (chatNotifications.totalFollowed || 0) > 0
    const notifications = usesFollowed
        ? chatNotifications.followedNotifications || []
        : chatNotifications.unfollowedNotifications || []

    return notifications
        .filter(notification => !!notification?.commentId)
        .sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0))
}

export const getUnreadCommentIds = chatNotifications =>
    getUnreadNotifications(chatNotifications).map(({ commentId }) => commentId)

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
