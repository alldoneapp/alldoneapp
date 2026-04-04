const admin = require('firebase-admin')
const moment = require('moment-timezone')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createTaskDueDateChangedFeed } = require('../Feeds/tasksFeeds')
const { tryAddFollower } = require('../Followers/followerHelper')
const { FOLLOWER_TASKS_TYPE } = require('../Followers/FollowerConstants')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')
const { FocusTaskService } = require('../shared/FocusTaskService')
const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
const {
    BACKLOG_DATE_NUMERIC,
    DEFAULT_WORKSTREAM_ID,
    FEED_PUBLIC_FOR_ALL,
    generateSortIndex,
} = require('../Utils/HelperFunctionsCloud')
const { mapProjectData, mapTaskData } = require('../Utils/MapDataFuncions')

const AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT = 3
const AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER = 0
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const ALLOWED_AUTO_POSTPONE_VALUES = new Set([0, 1, 2, 3, 5, 7, 14, 30])

function normalizeAutoPostponeAfterDaysOverdue(value) {
    const parsedValue = Number(value)
    return ALLOWED_AUTO_POSTPONE_VALUES.has(parsedValue) ? parsedValue : AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT
}

function getUserAutoPostponeAfterDaysOverdue(userData = {}) {
    return normalizeAutoPostponeAfterDaysOverdue(userData.autoPostponeAfterDaysOverdue)
}

function resolveTimezoneContext(userData = {}) {
    const timezoneCandidates = [
        userData.timezone,
        userData.timezoneOffset,
        userData.timezoneMinutes,
        userData.preferredTimezone,
    ]

    for (const candidate of timezoneCandidates) {
        if (typeof candidate === 'string') {
            const trimmedValue = candidate.trim()
            if (trimmedValue && moment.tz.zone(trimmedValue)) {
                return { zoneName: trimmedValue, offsetMinutes: null }
            }
        }

        const normalizedOffset = TaskRetrievalService.normalizeTimezoneOffset(candidate)
        if (typeof normalizedOffset === 'number' && !Number.isNaN(normalizedOffset)) {
            return { zoneName: null, offsetMinutes: normalizedOffset }
        }
    }

    return { zoneName: null, offsetMinutes: 0 }
}

function getMomentInTimezone(timestamp = Date.now(), timezoneContext = resolveTimezoneContext()) {
    if (timezoneContext.zoneName) return moment.tz(timestamp, timezoneContext.zoneName)
    return moment(timestamp).utcOffset(timezoneContext.offsetMinutes || 0)
}

function getLocalDateKey(userData = {}, now = Date.now()) {
    return getMomentInTimezone(now, resolveTimezoneContext(userData)).format('YYYY-MM-DD')
}

function getOverdueDays(dueDate, timezoneContext, now = Date.now()) {
    const currentDayStart = getMomentInTimezone(now, timezoneContext).startOf('day')
    const dueDayStart = getMomentInTimezone(dueDate, timezoneContext).startOf('day')
    return currentDayStart.diff(dueDayStart, 'days')
}

function shouldProcessUserToday(userData = {}, now = Date.now()) {
    const localDateKey = getLocalDateKey(userData, now)
    return {
        localDateKey,
        shouldProcess: userData.lastAutoPostponeLocalDateKey !== localDateKey,
    }
}

function getUserWorkstreamIds(userData = {}, projectId) {
    const projectWorkstreams = Array.isArray(userData?.workstreams?.[projectId]) ? userData.workstreams[projectId] : []
    return Array.from(new Set([DEFAULT_WORKSTREAM_ID, ...projectWorkstreams]))
}

function isVisibleToUser(task, userId) {
    return (
        Array.isArray(task.isPublicFor) &&
        (task.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || task.isPublicFor.includes(userId))
    )
}

function shouldAutoPostponeTask({
    task,
    effectiveDueDate,
    userId,
    timezoneContext,
    thresholdDays,
    endOfToday,
    requireVisible = true,
    now = Date.now(),
}) {
    if (!task || !task.id) return false
    if (task.done === true || task.inDone === true) return false
    if (task.parentId !== null && task.parentId !== undefined) return false
    if (typeof effectiveDueDate !== 'number' || !Number.isFinite(effectiveDueDate)) return false
    if (effectiveDueDate === BACKLOG_DATE_NUMERIC || effectiveDueDate > endOfToday) return false
    if (requireVisible && !isVisibleToUser(task, userId)) return false
    return getOverdueDays(effectiveDueDate, timezoneContext, now) >= thresholdDays
}

function mergeTaskCandidate(taskMap, candidate) {
    const existingCandidate = taskMap.get(candidate.id)
    if (!existingCandidate || (existingCandidate.isObservedTask && !candidate.isObservedTask)) {
        taskMap.set(candidate.id, candidate)
    }
}

function getDateToMoveTaskInAutoReminder(timesPostponed, isObservedTask, timezoneContext, now = Date.now()) {
    let nextDate = getMomentInTimezone(now, timezoneContext)

    if (!timesPostponed || isObservedTask) {
        nextDate.add(1, 'day')
    } else if (timesPostponed === 1) {
        nextDate.add(2, 'day')
    } else if (timesPostponed === 2) {
        nextDate.add(4, 'day')
    } else if (timesPostponed === 3) {
        nextDate.add(8, 'day')
    } else if (timesPostponed === 4) {
        nextDate.add(16, 'day')
    } else if (timesPostponed === 5) {
        nextDate.add(32, 'day')
    } else if (timesPostponed === 6) {
        nextDate.add(64, 'day')
    } else if (timesPostponed === 7) {
        nextDate.add(128, 'day')
    } else if (timesPostponed === 8) {
        nextDate.add(256, 'day')
    } else {
        return BACKLOG_DATE_NUMERIC
    }

    return nextDate.valueOf()
}

async function getActiveUsersMap(now = Date.now()) {
    const activeUsersMap = new Map()
    const thirtyDaysAgo = now - THIRTY_DAYS_MS

    const activeUsersSnapshot = await admin
        .firestore()
        .collection('users')
        .where('lastLogin', '>=', thirtyDaysAgo)
        .get()
    activeUsersSnapshot.docs.forEach(doc => {
        activeUsersMap.set(doc.id, { id: doc.id, ...doc.data() })
    })

    return activeUsersMap
}

async function getEligibleActiveProjectsForUser(userData = {}, db) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const archivedProjectIds = new Set(Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : [])
    const templateProjectIds = new Set(Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : [])
    const guideProjectIds = new Set(Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : [])

    const targetProjectIds = projectIds.filter(
        projectId =>
            !archivedProjectIds.has(projectId) && !templateProjectIds.has(projectId) && !guideProjectIds.has(projectId)
    )

    const projectDocs = await Promise.all(
        targetProjectIds.map(projectId => db.collection('projects').doc(projectId).get())
    )
    return projectDocs
        .filter(doc => doc.exists)
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(
            projectData =>
                projectData.active !== false && projectData.isTemplate !== true && !projectData.parentTemplateId
        )
}

async function collectEligibleTasksForProject({
    projectId,
    userId,
    userData,
    timezoneContext,
    thresholdDays,
    db,
    now = Date.now(),
}) {
    const endOfToday = getMomentInTimezone(now, timezoneContext).endOf('day').valueOf()
    const allowUserIds = [FEED_PUBLIC_FOR_ALL, userId]
    const taskMap = new Map()

    const reviewerTasksSnapshot = await db
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('parentId', '==', null)
        .where('currentReviewerId', '==', userId)
        .where('dueDate', '<=', endOfToday)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .get()

    reviewerTasksSnapshot.docs.forEach(doc => {
        const task = mapTaskData(doc.id, doc.data())
        if (
            shouldAutoPostponeTask({
                task,
                effectiveDueDate: task.dueDate,
                userId,
                timezoneContext,
                thresholdDays,
                endOfToday,
                now,
            })
        ) {
            mergeTaskCandidate(taskMap, {
                id: task.id,
                projectId,
                task,
                isObservedTask: false,
                effectiveDueDate: task.dueDate,
            })
        }
    })

    const workstreamIds = getUserWorkstreamIds(userData, projectId)
    for (const workstreamId of workstreamIds) {
        const workstreamTasksSnapshot = await db
            .collection(`items/${projectId}/tasks`)
            .where('inDone', '==', false)
            .where('parentId', '==', null)
            .where('userId', '==', workstreamId)
            .where('dueDate', '<=', endOfToday)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .get()

        workstreamTasksSnapshot.docs.forEach(doc => {
            const task = mapTaskData(doc.id, doc.data())
            if (
                shouldAutoPostponeTask({
                    task,
                    effectiveDueDate: task.dueDate,
                    userId,
                    timezoneContext,
                    thresholdDays,
                    endOfToday,
                    now,
                })
            ) {
                mergeTaskCandidate(taskMap, {
                    id: task.id,
                    projectId,
                    task,
                    isObservedTask: false,
                    effectiveDueDate: task.dueDate,
                })
            }
        })
    }

    const observedTasksSnapshot = await db
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('parentId', '==', null)
        .where('observersIds', 'array-contains', userId)
        .get()

    observedTasksSnapshot.docs.forEach(doc => {
        const task = mapTaskData(doc.id, doc.data())
        const observerDueDate = task.dueDateByObserversIds?.[userId]

        if (
            shouldAutoPostponeTask({
                task,
                effectiveDueDate: observerDueDate,
                userId,
                timezoneContext,
                thresholdDays,
                endOfToday,
                now,
            })
        ) {
            mergeTaskCandidate(taskMap, {
                id: task.id,
                projectId,
                task,
                isObservedTask: true,
                effectiveDueDate: observerDueDate,
            })
        }
    })

    return Array.from(taskMap.values())
}

async function autoPostponeTaskCloud({
    projectId,
    task,
    userId,
    isObservedTask,
    timezoneContext,
    batch,
    feedUser,
    now = Date.now(),
}) {
    const oldDueDate = isObservedTask ? task.dueDateByObserversIds?.[userId] : task.dueDate
    const newDueDate = getDateToMoveTaskInAutoReminder(task.timesPostponed, isObservedTask, timezoneContext, now)
    const updateData = {
        sortIndex: generateSortIndex(),
        lastEditionDate: now,
        lastEditorId: userId,
    }

    if (isObservedTask) {
        updateData[`dueDateByObserversIds.${userId}`] = newDueDate
    } else {
        updateData.dueDate = newDueDate
        if (newDueDate > task.dueDate) {
            updateData.timesPostponed = admin.firestore.FieldValue.increment(1)
        }
    }

    batch.update(admin.firestore().doc(`items/${projectId}/tasks/${task.id}`), updateData)

    if (!isObservedTask && newDueDate > task.dueDate && Array.isArray(task.subtaskIds) && task.subtaskIds.length > 0) {
        task.subtaskIds.forEach(subtaskId => {
            batch.update(admin.firestore().doc(`items/${projectId}/tasks/${subtaskId}`), {
                dueDate: newDueDate,
                timesPostponed: admin.firestore.FieldValue.increment(1),
                lastEditionDate: now,
                lastEditorId: userId,
            })
        })
    }

    await createTaskDueDateChangedFeed(
        projectId,
        newDueDate,
        oldDueDate,
        task.id,
        batch,
        newDueDate === BACKLOG_DATE_NUMERIC,
        oldDueDate === BACKLOG_DATE_NUMERIC,
        isObservedTask,
        feedUser,
        false
    )

    await tryAddFollower(
        projectId,
        {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: task.id,
            followObject: task,
            feedUser,
        },
        batch,
        false
    )

    return newDueDate
}

async function processUserAutoPostpone(userId, userData, now = Date.now()) {
    const db = admin.firestore()
    const thresholdDays = getUserAutoPostponeAfterDaysOverdue(userData)
    if (thresholdDays === AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER) {
        return { processed: false, reason: 'disabled', postponedCount: 0 }
    }

    const { localDateKey, shouldProcess } = shouldProcessUserToday(userData, now)
    if (!shouldProcess) {
        return { processed: false, reason: 'already-processed', postponedCount: 0, localDateKey }
    }

    const timezoneContext = resolveTimezoneContext(userData)
    const activeProjects = await getEligibleActiveProjectsForUser(userData, db)
    if (activeProjects.length === 0) {
        await db.doc(`users/${userId}`).update({ lastAutoPostponeLocalDateKey: localDateKey })
        return { processed: true, reason: 'no-active-projects', postponedCount: 0, localDateKey }
    }

    let postponedCount = 0
    const focusTaskService = new FocusTaskService({ database: db })
    let postponedFocusTask = null

    for (const rawProjectData of activeProjects) {
        const projectId = rawProjectData.id
        const projectData = mapProjectData(projectId, rawProjectData)
        const eligibleTasks = await collectEligibleTasksForProject({
            projectId,
            userId,
            userData,
            timezoneContext,
            thresholdDays,
            db,
            now,
        })

        if (eligibleTasks.length === 0) continue

        const feedUser = {
            uid: userId,
            displayName: userData.displayName || '',
            photoURL: userData.photoURL || '',
            dateFormat: userData.dateFormat || null,
        }

        loadFeedsGlobalState(admin, admin, feedUser, projectData, [], null)

        const batch = new BatchWrapper(db)
        batch.setProjectContext(projectId)

        for (const eligibleTask of eligibleTasks) {
            await autoPostponeTaskCloud({
                projectId,
                task: eligibleTask.task,
                userId,
                isObservedTask: eligibleTask.isObservedTask,
                timezoneContext,
                batch,
                feedUser,
                now,
            })

            postponedCount++

            if (
                !postponedFocusTask &&
                userData.inFocusTaskId === eligibleTask.task.id &&
                userData.inFocusTaskProjectId === projectId
            ) {
                postponedFocusTask = {
                    projectId,
                    parentGoalId: eligibleTask.task.parentGoalId || null,
                    taskId: eligibleTask.task.id,
                }
            }
        }

        await batch.commit()
    }

    if (postponedFocusTask) {
        const timezoneOffset = getMomentInTimezone(now, timezoneContext).utcOffset()
        await focusTaskService.findAndSetNewFocusTask(
            userId,
            postponedFocusTask.projectId,
            postponedFocusTask.parentGoalId,
            postponedFocusTask.taskId,
            timezoneOffset
        )
    }

    await db.doc(`users/${userId}`).update({ lastAutoPostponeLocalDateKey: localDateKey })
    return { processed: true, reason: 'completed', postponedCount, localDateKey }
}

async function checkAndAutoPostponeTasks(now = Date.now()) {
    const activeUsersMap = await getActiveUsersMap(now)
    let processedUsers = 0
    let skippedUsers = 0
    let postponedTasks = 0

    for (const [userId, userData] of activeUsersMap.entries()) {
        try {
            const result = await processUserAutoPostpone(userId, userData, now)
            if (result.processed) {
                processedUsers++
                postponedTasks += result.postponedCount || 0
            } else {
                skippedUsers++
            }
        } catch (error) {
            skippedUsers++
            console.error('[autoPostponeTasksCloud] Failed to process user', {
                userId,
                error: error.message,
            })
        }
    }

    console.log('[autoPostponeTasksCloud] Completed run', {
        activeUsers: activeUsersMap.size,
        processedUsers,
        skippedUsers,
        postponedTasks,
    })

    return {
        success: true,
        activeUsers: activeUsersMap.size,
        processedUsers,
        skippedUsers,
        postponedTasks,
    }
}

module.exports = {
    AUTO_POSTPONE_AFTER_DAYS_OVERDUE_DEFAULT,
    AUTO_POSTPONE_AFTER_DAYS_OVERDUE_NEVER,
    normalizeAutoPostponeAfterDaysOverdue,
    getUserAutoPostponeAfterDaysOverdue,
    resolveTimezoneContext,
    getMomentInTimezone,
    getLocalDateKey,
    getOverdueDays,
    shouldProcessUserToday,
    getUserWorkstreamIds,
    shouldAutoPostponeTask,
    mergeTaskCandidate,
    getDateToMoveTaskInAutoReminder,
    autoPostponeTaskCloud,
    processUserAutoPostpone,
    checkAndAutoPostponeTasks,
}
