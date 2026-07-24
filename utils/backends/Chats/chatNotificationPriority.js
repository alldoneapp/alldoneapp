export const ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY = 'allProjects'

export const getChatNotificationWithCommentId = document => ({
    ...document.data(),
    commentId: document.id,
})

// Followed notifications use the red UI treatment; unfollowed notifications
// are grey and only become the preview when there is no red notification.
const getNotificationPriority = notification => (notification?.followed ? 1 : 0)

const getNotificationDate = notification => {
    const rawDate = notification?.date
    if (rawDate === null || rawDate === undefined) return null

    const date = Number(rawDate)
    return Number.isFinite(date) ? date : null
}

export const isPreferredChatNotification = (notification, currentNotification) => {
    if (!notification) return false
    if (!currentNotification) return true

    const priorityDifference = getNotificationPriority(notification) - getNotificationPriority(currentNotification)
    if (priorityDifference !== 0) return priorityDifference > 0

    const notificationDate = getNotificationDate(notification)
    const currentNotificationDate = getNotificationDate(currentNotification)

    if (notificationDate === null) return false
    if (currentNotificationDate === null) return true

    // Keep the first notification for equal timestamps so the result does not
    // depend on unnecessary replacements while snapshots are being rebuilt.
    return notificationDate > currentNotificationDate
}

export const getProjectChatLastNotification = (
    projectId,
    projectNotifications = [],
    projectChatLastNotification = {}
) => {
    const lastNotifications = {
        ...(projectChatLastNotification || {}),
        [projectId]: null,
    }

    const notifications = Array.isArray(projectNotifications) ? projectNotifications : []
    notifications.forEach(notification => {
        if (isPreferredChatNotification(notification, lastNotifications[projectId])) {
            lastNotifications[projectId] = notification
        }
    })

    lastNotifications[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY] = getAllProjectsChatLastNotification(lastNotifications)
    return lastNotifications
}

export const getAllProjectsChatLastNotification = notifications => {
    const keys = Object.keys(notifications || {})
    let allProjectsNotification = null

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const notification = notifications[key]
        if (
            key !== ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY &&
            isPreferredChatNotification(notification, allProjectsNotification)
        ) {
            allProjectsNotification = {
                ...notification,
                projectId: key,
            }
        }
    }

    return allProjectsNotification
}
