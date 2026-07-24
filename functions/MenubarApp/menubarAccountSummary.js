'use strict'

const { getUserLocalDayBounds } = require('../Assistant/contextTimestampHelper')
const { getMenubarLastComment } = require('./menubarLastComment')

const FEED_PUBLIC_FOR_ALL = 0
const WORKSTREAM_ID_PREFIX = 'ws@'

function getActiveProjectIds(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const guideProjectIds = new Set(Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : [])
    const archivedProjectIds = new Set(Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : [])
    const templateProjectIds = new Set(Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : [])

    return [...new Set(projectIds)].filter(
        projectId =>
            typeof projectId === 'string' &&
            projectId &&
            !guideProjectIds.has(projectId) &&
            !archivedProjectIds.has(projectId) &&
            !templateProjectIds.has(projectId)
    )
}

function isVisibleForUser(data = {}, userId) {
    const isPublicFor = Array.isArray(data.isPublicFor) ? data.isPublicFor : []
    return isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || isPublicFor.includes(userId)
}

function countNormalTaskAssignments(normalTasks, workstreamIds, userId) {
    const userWorkstreamIds = new Set(workstreamIds)
    let count = 0

    normalTasks.forEach(task => {
        if (task.currentReviewerId === userId) count++
        if (
            typeof task.userId === 'string' &&
            task.userId.startsWith(WORKSTREAM_ID_PREFIX) &&
            userWorkstreamIds.has(task.userId)
        ) {
            count++
        }
    })

    return count
}

function countObservedTaskAssignments(observedTasks, userId, endOfDay) {
    let count = 0

    observedTasks.forEach(task => {
        if (
            isVisibleForUser(task, userId) &&
            Array.isArray(task.observersIds) &&
            task.observersIds.includes(userId) &&
            Number(task.dueDateByObserversIds?.[userId]) <= endOfDay
        ) {
            count++
        }
    })

    return count
}

function countProjectOpenTasks({ normalTasks = [], observedTasks = [], workstreamIds = [], userId, endOfDay }) {
    const eligibleNormalTasks = normalTasks.filter(
        task =>
            task?.done === false &&
            task?.parentId === null &&
            Number(task?.dueDate) <= endOfDay &&
            isVisibleForUser(task, userId)
    )
    const eligibleObservedTasks = observedTasks.filter(
        task => task?.done === false && task?.parentId === null && isVisibleForUser(task, userId)
    )

    return (
        countNormalTaskAssignments(eligibleNormalTasks, workstreamIds, userId) +
        countObservedTaskAssignments(eligibleObservedTasks, userId, endOfDay)
    )
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

function summarizeChatNotifications(docs = [], projectId) {
    const chatNotifications = docs.map(doc => ({ ...doc.data(), commentId: doc.id, projectId }))
    const followed = chatNotifications.filter(notification => notification.followed === true).length
    return {
        chatNotifications,
        followed,
        unfollowed: Math.max(0, chatNotifications.length - followed),
    }
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
            .select('currentReviewerId', 'userId')
            .get(),
        tasksRef
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('observersIds', 'array-contains-any', [userId])
            .select('observersIds', 'dueDateByObserversIds', 'isPublicFor')
            .get(),
        db
            .collection(`projectsWorkstreams/${projectId}/workstreams`)
            .where('userIds', 'array-contains', userId)
            .select()
            .get(),
        db.collection(`chatNotifications/${projectId}/${userId}`).get(),
        db.doc(`feedsCount/${projectId}/${userId}/followed`).get(),
        db.doc(`feedsCount/${projectId}/${userId}/all`).get(),
    ])

    const messages = summarizeChatNotifications(messagesSnapshot.docs, projectId)

    return {
        openTasksToday:
            countNormalTaskAssignments(
                normalSnapshot.docs.map(doc => doc.data()),
                workstreamsSnapshot.docs.map(doc => doc.id),
                userId
            ) +
            countObservedTaskAssignments(
                observedSnapshot.docs.map(doc => doc.data()),
                userId,
                endOfDay
            ),
        unreadMessages: {
            followed: messages.followed,
            unfollowed: messages.unfollowed,
        },
        unreadNotifications: {
            followed: countVisibleFeedObjects(followedFeedsDoc.data(), userId),
            all: countVisibleFeedObjects(allFeedsDoc.data(), userId),
        },
        chatNotifications: messages.chatNotifications,
    }
}

async function getMenubarAccountSummary(
    db,
    userId,
    userData = {},
    now = Date.now(),
    appBaseUrl = 'https://my.alldone.app'
) {
    const startedAt = Date.now()
    const projectIds = getActiveProjectIds(userData)
    const { endOfDay } = getUserLocalDayBounds(userData, now)
    const projectSummaries = []
    const chatNotifications = []

    // Keep enough projects in flight for a quick response without retaining
    // every project's Firestore snapshots in memory at the same time.
    const batchSize = 8
    for (let index = 0; index < projectIds.length; index += batchSize) {
        const batch = await Promise.all(
            projectIds
                .slice(index, index + batchSize)
                .map(projectId => getProjectAccountSummary(db, projectId, userId, endOfDay))
        )
        batch.forEach(project => {
            chatNotifications.push(...project.chatNotifications)
            delete project.chatNotifications
        })
        projectSummaries.push(...batch)
    }

    const summary = projectSummaries.reduce(
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

    try {
        summary.lastComment = await getMenubarLastComment(
            db,
            userId,
            userData,
            projectIds,
            appBaseUrl,
            chatNotifications
        )
    } catch (error) {
        console.warn('menubarSession: last comment failed', { userId, error: error.message })
        summary.lastComment = null
    }

    console.info('menubarSession: account summary complete', {
        projectCount: projectIds.length,
        durationMs: Date.now() - startedAt,
    })
    return summary
}

module.exports = {
    getMenubarAccountSummary,
    __private__: {
        countNormalTaskAssignments,
        countObservedTaskAssignments,
        countProjectOpenTasks,
        countVisibleFeedObjects,
        getActiveProjectIds,
        summarizeChatNotifications,
    },
}
