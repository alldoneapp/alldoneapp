'use strict'

const { getUserLocalDayBounds } = require('../Assistant/contextTimestampHelper')

const FEED_PUBLIC_FOR_ALL = 0
const WORKSTREAM_ID_PREFIX = 'ws@'

function getActiveProjectIds(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []
    const archivedProjectIds = new Set(Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : [])
    const templateProjectIds = new Set(Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : [])

    return [...new Set([...projectIds, ...guideProjectIds])].filter(
        projectId =>
            typeof projectId === 'string' &&
            projectId &&
            !archivedProjectIds.has(projectId) &&
            !templateProjectIds.has(projectId)
    )
}

function isVisibleForUser(data = {}, userId) {
    const isPublicFor = Array.isArray(data.isPublicFor) ? data.isPublicFor : []
    return isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || isPublicFor.includes(userId)
}

function countProjectOpenTasks({ normalTasks = [], observedTasks = [], workstreamIds = [], userId, endOfDay }) {
    const userWorkstreamIds = new Set(workstreamIds)
    let count = 0

    normalTasks.forEach(task => {
        if (
            task?.done !== false ||
            task?.parentId !== null ||
            Number(task?.dueDate) > endOfDay ||
            !isVisibleForUser(task, userId)
        ) {
            return
        }

        if (task.currentReviewerId === userId) count++
        if (
            typeof task.userId === 'string' &&
            task.userId.startsWith(WORKSTREAM_ID_PREFIX) &&
            userWorkstreamIds.has(task.userId)
        ) {
            count++
        }
    })

    observedTasks.forEach(task => {
        if (
            task?.done !== false ||
            task?.parentId !== null ||
            !isVisibleForUser(task, userId) ||
            !Array.isArray(task.observersIds) ||
            !task.observersIds.includes(userId)
        ) {
            return
        }
        if (Number(task.dueDateByObserversIds?.[userId]) <= endOfDay) count++
    })

    return count
}

function countVisibleFeedObjects(newFeeds, userId) {
    if (!newFeeds || typeof newFeeds !== 'object') return 0

    const updatedObjects = new Set()
    Object.entries(newFeeds).forEach(([objectType, objects]) => {
        if (!objects || typeof objects !== 'object') return
        Object.entries(objects).forEach(([objectId, feeds]) => {
            if (!feeds || typeof feeds !== 'object' || (feeds.isPrivate && feeds.isPrivate !== userId)) return

            const hasVisibleFeed = Object.entries(feeds).some(
                ([feedId, feedData]) => feedId !== 'isPrivate' && !!feedData?.feed
            )
            if (hasVisibleFeed) updatedObjects.add(`${objectType}/${objectId}`)
        })
    })
    return updatedObjects.size
}

async function getProjectAccountSummary(db, projectId, userId, endOfDay) {
    const allowUserIds = [FEED_PUBLIC_FOR_ALL, userId]
    const tasksRef = db.collection(`items/${projectId}/tasks`)

    const [
        normalSnapshot,
        observedSnapshot,
        workstreamsSnapshot,
        messagesSnapshot,
        followedFeedsDoc,
        allFeedsDoc,
    ] = await Promise.all([
        tasksRef
            .where('done', '==', false)
            .where('dueDate', '<=', endOfDay)
            .where('parentId', '==', null)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .get(),
        tasksRef
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('observersIds', '!=', [])
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .get(),
        db.collection(`projectsWorkstreams/${projectId}/workstreams`).where('userIds', 'array-contains', userId).get(),
        db.collection(`chatNotifications/${projectId}/${userId}`).get(),
        db.doc(`feedsCount/${projectId}/${userId}/followed`).get(),
        db.doc(`feedsCount/${projectId}/${userId}/all`).get(),
    ])

    let followedMessages = 0
    let unfollowedMessages = 0
    messagesSnapshot.docs.forEach(doc => {
        doc.data()?.followed ? followedMessages++ : unfollowedMessages++
    })

    return {
        openTasksToday: countProjectOpenTasks({
            normalTasks: normalSnapshot.docs.map(doc => doc.data()),
            observedTasks: observedSnapshot.docs.map(doc => doc.data()),
            workstreamIds: workstreamsSnapshot.docs.map(doc => doc.id),
            userId,
            endOfDay,
        }),
        unreadMessages: {
            followed: followedMessages,
            unfollowed: unfollowedMessages,
        },
        unreadNotifications: {
            followed: countVisibleFeedObjects(followedFeedsDoc.data(), userId),
            all: countVisibleFeedObjects(allFeedsDoc.data(), userId),
        },
    }
}

async function getMenubarAccountSummary(db, userId, userData = {}, now = Date.now()) {
    const projectIds = getActiveProjectIds(userData)
    const { endOfDay } = getUserLocalDayBounds(userData, now)
    const projectSummaries = await Promise.all(
        projectIds.map(projectId => getProjectAccountSummary(db, projectId, userId, endOfDay))
    )

    return projectSummaries.reduce(
        (total, project) => ({
            openTasksToday: total.openTasksToday + project.openTasksToday,
            unreadMessages: {
                followed: total.unreadMessages.followed + project.unreadMessages.followed,
                unfollowed: total.unreadMessages.unfollowed + project.unreadMessages.unfollowed,
            },
            unreadNotifications: {
                followed: total.unreadNotifications.followed + project.unreadNotifications.followed,
                all: total.unreadNotifications.all + project.unreadNotifications.all,
            },
        }),
        {
            openTasksToday: 0,
            unreadMessages: { followed: 0, unfollowed: 0 },
            unreadNotifications: { followed: 0, all: 0 },
        }
    )
}

module.exports = {
    getMenubarAccountSummary,
    __private__: {
        countProjectOpenTasks,
        countVisibleFeedObjects,
        getActiveProjectIds,
    },
}
