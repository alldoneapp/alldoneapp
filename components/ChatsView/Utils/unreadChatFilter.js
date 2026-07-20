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

export const getUnreadChatIds = (projectNotifications = {}, chatsActiveTab) =>
    Object.keys(projectNotifications).filter(chatId => isUnreadChat(projectNotifications, chatId, chatsActiveTab))

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
