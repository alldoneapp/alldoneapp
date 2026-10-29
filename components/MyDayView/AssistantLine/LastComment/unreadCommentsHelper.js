import { isLiveComment } from './liveComment'

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

const normalizeComment = comment => (typeof comment === 'string' ? { id: comment } : comment || {})

/**
 * AT-2923 — the comment the Last comment preview shows for a chat.
 *
 * The preview used to show the chat's newest comment, full stop. Read state is per COMMENT, not per
 * chat (Anna's workspace acknowledges exactly the messages that scroll into view, and the user's own
 * messages never carry a notification), so a chat can hold an unread assistant reply BELOW a newer
 * comment that is already read. Showing that newer comment hid the one thing the user still had to
 * look at, while the slot was red because of it.
 *
 * Comments arrive newest first. The first one that is unread wins; a newer comment only stays on top
 * when it is still being written (`isLiveComment`), because an answer streaming in front of the user
 * has no notification yet — its marker is written when the run settles — and is the opposite of
 * "already read". With nothing unread in the window this is the newest comment, as before.
 */
export const getPreviewComment = (chatNotifications, recentComments) => {
    const comments = Array.isArray(recentComments) ? recentComments : []
    const unreadIds = new Set(getAllUnreadCommentIds(chatNotifications))
    if (unreadIds.size === 0) return comments[0] ?? null

    for (const rawComment of comments) {
        const comment = normalizeComment(rawComment)
        if ((comment.id && unreadIds.has(comment.id)) || isLiveComment(comment)) return rawComment
    }
    return comments[0] ?? null
}

export const getUnreadCommentsCount = (chatNotifications, isFollowedNotification, recentComments) => {
    const allUnreadIds = new Set(getAllUnreadCommentIds(chatNotifications))
    const selectedUnreadIds = new Set(getUnreadCommentIds(chatNotifications, isFollowedNotification))
    const matchedUnreadIds = new Set()
    let readBoundaryDate = null
    let foundReadBoundary = false

    // Comments arrive newest first. Every loaded comment that still carries an unread marker is
    // counted, including one below a newer comment that is already read (AT-2923): read state is per
    // comment, and the preview now shows exactly such a comment, so the badge must agree with it. A
    // live VM/assistant status is not a read boundary: it is updated in place without a chat
    // notification and can temporarily sit above a genuinely unread message.
    for (const rawComment of recentComments || []) {
        const comment = normalizeComment(rawComment)
        if (comment.id && allUnreadIds.has(comment.id)) {
            matchedUnreadIds.add(comment.id)
            continue
        }
        if (isLiveComment(comment) || foundReadBoundary) continue

        foundReadBoundary = true
        readBoundaryDate = getTimestamp(comment.created) ?? getTimestamp(comment.lastChangeDate)
    }

    let count = [...matchedUnreadIds].filter(commentId => selectedUnreadIds.has(commentId)).length

    // Firestore listeners are independent, so the notification snapshot can arrive before
    // its comment snapshot. A marker whose comment is not loaded is counted only when it is newer
    // than the newest read comment. This keeps the badge visible during that race without reviving
    // marker documents of comments outside the loaded window or deleted since.
    getUnreadNotifications(chatNotifications, isFollowedNotification).forEach(notification => {
        if (matchedUnreadIds.has(notification.commentId)) return

        const notificationDate = getTimestamp(notification.date)
        if (notificationDate === null) return
        if (!foundReadBoundary || (readBoundaryDate !== null && notificationDate > readBoundaryDate)) count++
    })

    return count
}
