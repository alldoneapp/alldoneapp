// Shared by the top navigation and assistant activity history. Keep badge eligibility here,
// so raw notification payloads cannot turn into notices when the corresponding count is zero.
export const getFollowedFeedAmount = state => state.followedFeedsAmount || 0

export const getFollowedAndUnfollowedChatNotificationsAmount = (
    inAllProjects,
    selectedProjectId,
    projectChatNotifications = {},
    archivedProjectIds = [],
    templateProjectIds = []
) => {
    if (inAllProjects) {
        let globalTotalFollowed = 0
        let globalTotalUnfollowed = 0
        const projectIds = Object.keys(projectChatNotifications)
        projectIds.forEach(projectId => {
            const needToCount = !archivedProjectIds.includes(projectId) && !templateProjectIds.includes(projectId)
            if (needToCount) {
                const { totalFollowed, totalUnfollowed } = projectChatNotifications[projectId]
                globalTotalFollowed += totalFollowed || 0
                globalTotalUnfollowed += totalUnfollowed || 0
            }
        })
        return { totalFollowed: globalTotalFollowed, totalUnfollowed: globalTotalUnfollowed }
    } else {
        return projectChatNotifications[selectedProjectId] || { totalFollowed: 0, totalUnfollowed: 0 }
    }
}

export const resetNotificationsWhenUserHasAnActiveChat = (projectChatNotifications = {}, activeChatData = {}) => {
    const { projectId, chatId, chatType } = activeChatData || {}

    if (
        projectId &&
        chatId &&
        chatType &&
        projectChatNotifications[projectId] &&
        projectChatNotifications[projectId][chatId]
    ) {
        const { totalFollowed, totalUnfollowed } = projectChatNotifications[projectId][chatId]
        if (totalFollowed || totalUnfollowed) {
            projectChatNotifications = { ...projectChatNotifications }
            projectChatNotifications[projectId] = { ...projectChatNotifications[projectId] }
            projectChatNotifications[projectId].totalFollowed -=
                projectChatNotifications[projectId][chatId].totalFollowed
            projectChatNotifications[projectId].totalUnfollowed -=
                projectChatNotifications[projectId][chatId].totalUnfollowed

            delete projectChatNotifications[projectId][chatId]
        }
    }
    return projectChatNotifications
}

export const getRedChatNotifications = (notifications, activeChat, user) => {
    const visible = resetNotificationsWhenUserHasAnActiveChat(notifications, activeChat)
    const { totalFollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
        true,
        '',
        visible,
        user.archivedProjectIds,
        user.templateProjectIds
    )
    if (!(totalFollowed > 0)) return {}
    const excluded = new Set([...(user.archivedProjectIds || []), ...(user.templateProjectIds || [])])
    return Object.fromEntries(
        Object.entries(visible).filter(([id, project]) => !excluded.has(id) && project.totalFollowed > 0)
    )
}
