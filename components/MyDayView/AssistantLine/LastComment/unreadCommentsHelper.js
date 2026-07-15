export const getUnreadCommentIds = (chatNotifications, isFollowedNotification) => {
    const commentIds = isFollowedNotification
        ? chatNotifications?.followedCommentIds
        : chatNotifications?.unfollowedCommentIds

    return Array.isArray(commentIds) ? [...new Set(commentIds.filter(Boolean))] : []
}

export const getAllUnreadCommentIds = chatNotifications => [
    ...new Set([...getUnreadCommentIds(chatNotifications, true), ...getUnreadCommentIds(chatNotifications, false)]),
]

export const getUnreadCommentsCount = (chatNotifications, isFollowedNotification, recentCommentIds) => {
    const allUnreadIds = new Set(getAllUnreadCommentIds(chatNotifications))
    const selectedUnreadIds = new Set(getUnreadCommentIds(chatNotifications, isFollowedNotification))
    let count = 0

    // Comments arrive newest first. Only the contiguous unread tail is genuinely new;
    // old unread-marker documents before a read/non-notified comment are stale.
    for (const commentId of recentCommentIds || []) {
        if (!allUnreadIds.has(commentId)) break
        if (selectedUnreadIds.has(commentId)) count++
    }

    return count
}
