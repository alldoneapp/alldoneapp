export const getUnreadCommentIds = (chatNotifications, isFollowedNotification) => {
    const commentIds = isFollowedNotification
        ? chatNotifications?.followedCommentIds
        : chatNotifications?.unfollowedCommentIds

    return Array.isArray(commentIds) ? [...new Set(commentIds.filter(Boolean))] : []
}

export const getAllUnreadCommentIds = chatNotifications => [
    ...new Set([...getUnreadCommentIds(chatNotifications, true), ...getUnreadCommentIds(chatNotifications, false)]),
]

const getTimestamp = value => {
    if (value === null || value === undefined) return null
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    if (Number.isFinite(value?.seconds)) {
        return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000)
    }

    const timestamp = Number(value)
    return Number.isFinite(timestamp) ? timestamp : null
}

const getUnreadNotifications = (chatNotifications, isFollowedNotification) => {
    const notifications = isFollowedNotification
        ? chatNotifications?.followedNotifications
        : chatNotifications?.unfollowedNotifications

    if (Array.isArray(notifications)) {
        const notificationsByCommentId = new Map()
        notifications.forEach(notification => {
            const commentId = notification?.commentId
            if (!commentId) return

            const existingNotification = notificationsByCommentId.get(commentId)
            const existingDate = getTimestamp(existingNotification?.date)
            const notificationDate = getTimestamp(notification.date)
            if (
                !existingNotification ||
                (notificationDate !== null && (existingDate === null || notificationDate > existingDate))
            ) {
                notificationsByCommentId.set(commentId, notification)
            }
        })
        return [...notificationsByCommentId.values()]
    }

    // Backwards compatibility for state restored before notification metadata was added.
    return getUnreadCommentIds(chatNotifications, isFollowedNotification).map(commentId => ({ commentId }))
}

const isLiveComment = comment => {
    if (!comment || typeof comment === 'string') return false

    const assistantRunStatus = comment.assistantRun?.status
    return (
        comment.isLoading === true ||
        comment.isThinking === true ||
        comment.isPartial === true ||
        assistantRunStatus === 'running' ||
        assistantRunStatus === 'cancel_requested'
    )
}

const normalizeComment = comment => (typeof comment === 'string' ? { id: comment } : comment || {})

export const getUnreadCommentsCount = (chatNotifications, isFollowedNotification, recentComments) => {
    const allUnreadIds = new Set(getAllUnreadCommentIds(chatNotifications))
    const selectedUnreadIds = new Set(getUnreadCommentIds(chatNotifications, isFollowedNotification))
    const matchedUnreadIds = new Set()
    let readBoundaryDate = null
    let foundReadBoundary = false

    // Comments arrive newest first. Only the contiguous unread tail is genuinely new;
    // old unread-marker documents before a read/non-notified comment are stale. A live
    // VM/assistant status is not a read boundary: it is updated in place without a chat
    // notification and can temporarily sit above a genuinely unread message.
    for (const rawComment of recentComments || []) {
        const comment = normalizeComment(rawComment)
        if (comment.id && allUnreadIds.has(comment.id)) {
            matchedUnreadIds.add(comment.id)
            continue
        }
        if (isLiveComment(comment)) continue

        foundReadBoundary = true
        readBoundaryDate = getTimestamp(comment.created) ?? getTimestamp(comment.lastChangeDate)
        break
    }

    let count = [...matchedUnreadIds].filter(commentId => selectedUnreadIds.has(commentId)).length

    // Firestore listeners are independent, so the notification snapshot can arrive before
    // its comment snapshot. Count only pending markers newer than the first stable/read
    // boundary. This keeps the badge visible during that race without reviving historical
    // marker documents behind the boundary.
    getUnreadNotifications(chatNotifications, isFollowedNotification).forEach(notification => {
        if (matchedUnreadIds.has(notification.commentId)) return

        const notificationDate = getTimestamp(notification.date)
        if (notificationDate === null) return
        if (!foundReadBoundary || (readBoundaryDate !== null && notificationDate > readBoundaryDate)) count++
    })

    return count
}
