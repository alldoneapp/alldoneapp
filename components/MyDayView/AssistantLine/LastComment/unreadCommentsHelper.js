export const getUnreadCommentsCount = (chatNotifications, isFollowedNotification) => {
    const count = isFollowedNotification ? chatNotifications?.totalFollowed : chatNotifications?.totalUnfollowed

    return count > 0 ? count : 0
}
