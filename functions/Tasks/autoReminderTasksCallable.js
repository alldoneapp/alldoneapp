const admin = require('firebase-admin')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')
const { FocusTaskService } = require('../shared/FocusTaskService')
const { canAccessObject, getAccessibleProjectIdsFromUserData } = require('../shared/privacyAccess')
const { mapProjectData, mapTaskData } = require('../Utils/MapDataFuncions')
const { WORKSTREAM_ID_PREFIX } = require('../Utils/HelperFunctionsCloud')
const { autoPostponeTaskCloud, getMomentInTimezone, resolveTimezoneContext } = require('./autoPostponeTasksCloud')

const MAX_AUTO_REMINDER_TASKS = 500

class AutoReminderCallableError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

function normalizeTaskRequests(data = {}) {
    const targetUserId = typeof data.targetUserId === 'string' ? data.targetUserId.trim() : ''
    if (!targetUserId) {
        throw new AutoReminderCallableError('invalid-argument', 'targetUserId is required')
    }
    if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
        throw new AutoReminderCallableError('invalid-argument', 'At least one task is required')
    }
    if (data.tasks.length > MAX_AUTO_REMINDER_TASKS) {
        throw new AutoReminderCallableError(
            'invalid-argument',
            `A maximum of ${MAX_AUTO_REMINDER_TASKS} tasks can be processed per request`
        )
    }

    const deduplicated = new Map()
    data.tasks.forEach((task, index) => {
        const projectId = typeof task?.projectId === 'string' ? task.projectId.trim() : ''
        const taskId = typeof task?.taskId === 'string' ? task.taskId.trim() : ''
        if (!projectId || !taskId || typeof task?.isObservedTask !== 'boolean') {
            throw new AutoReminderCallableError(
                'invalid-argument',
                `tasks[${index}] must contain projectId, taskId, and isObservedTask`
            )
        }

        const key = `${projectId}:${taskId}`
        const normalized = { projectId, taskId, isObservedTask: task.isObservedTask }
        const existing = deduplicated.get(key)
        // Prefer the primary task path if the same task arrives from both the assigned
        // and observed lists. That matches how openTasksMap resolves the overlap.
        if (!existing || (existing.isObservedTask && !normalized.isObservedTask)) {
            deduplicated.set(key, normalized)
        }
    })

    return { targetUserId, tasks: Array.from(deduplicated.values()) }
}

function canAccessProject(userData, projectId, projectData = {}) {
    return (
        getAccessibleProjectIdsFromUserData(userData).includes(projectId) ||
        (Array.isArray(projectData.userIds) && projectData.userIds.includes(userData.uid))
    )
}

async function getUserRecord(db, userId) {
    const snapshot = await db.doc(`users/${userId}`).get()
    return snapshot.exists ? { uid: userId, ...snapshot.data() } : null
}

function buildFeedUser(userId, userData = {}) {
    return {
        uid: userId,
        displayName: userData.displayName || '',
        photoURL: userData.photoURL || '',
        dateFormat: userData.dateFormat || null,
    }
}

async function executeAutoReminderTasks({ actorUserId, data, now = Date.now() }) {
    if (!actorUserId) throw new AutoReminderCallableError('permission-denied', 'Authentication required')

    const { targetUserId, tasks } = normalizeTaskRequests(data)
    const db = admin.firestore()
    const actorData = await getUserRecord(db, actorUserId)
    if (!actorData) throw new AutoReminderCallableError('permission-denied', 'User not found')

    const targetIsWorkstream = targetUserId.startsWith(WORKSTREAM_ID_PREFIX)
    const targetData = targetIsWorkstream ? null : await getUserRecord(db, targetUserId)
    if (!targetData && !targetIsWorkstream) {
        throw new AutoReminderCallableError('not-found', 'Target user not found')
    }

    const timezoneUserData = targetData || actorData
    const timezoneContext = resolveTimezoneContext(timezoneUserData)
    const feedUser = buildFeedUser(actorUserId, actorData)
    const projectIds = Array.from(new Set(tasks.map(task => task.projectId)))
    const projectSnapshots = await Promise.all(projectIds.map(projectId => db.doc(`projects/${projectId}`).get()))
    const projectsById = {}

    projectSnapshots.forEach((snapshot, index) => {
        const projectId = projectIds[index]
        if (!snapshot.exists) throw new AutoReminderCallableError('not-found', `Project not found: ${projectId}`)
        const projectData = { id: projectId, ...snapshot.data() }
        if (!canAccessProject(actorData, projectId, projectData)) {
            throw new AutoReminderCallableError('permission-denied', `No access to project: ${projectId}`)
        }
        if (targetData && !canAccessProject(targetData, projectId, projectData)) {
            throw new AutoReminderCallableError(
                'permission-denied',
                `Target user has no access to project: ${projectId}`
            )
        }
        projectsById[projectId] = projectData
    })

    const groupedTasks = tasks.reduce((groups, task) => {
        if (!groups[task.projectId]) groups[task.projectId] = []
        groups[task.projectId].push(task)
        return groups
    }, {})
    const updated = []
    const skipped = []
    let postponedFocusTask = null

    for (const projectId of projectIds) {
        const projectData = projectsById[projectId]
        const requests = groupedTasks[projectId]
        const taskSnapshots = await Promise.all(
            requests.map(request => db.doc(`items/${projectId}/tasks/${request.taskId}`).get())
        )

        loadFeedsGlobalState(admin, admin, feedUser, mapProjectData(projectId, projectData), [], null)
        const batch = new BatchWrapper(db)
        batch.setProjectContext(projectId)
        let projectUpdatedCount = 0

        for (let index = 0; index < requests.length; index++) {
            const request = requests[index]
            const taskSnapshot = taskSnapshots[index]
            if (!taskSnapshot.exists) {
                skipped.push({ ...request, reason: 'not-found' })
                continue
            }

            const task = mapTaskData(request.taskId, taskSnapshot.data())
            if (task.done === true || task.inDone === true) {
                skipped.push({ ...request, reason: 'completed' })
                continue
            }
            if (!canAccessObject(task, actorUserId)) {
                throw new AutoReminderCallableError('permission-denied', `No access to task: ${request.taskId}`)
            }
            if (
                request.isObservedTask &&
                (!Array.isArray(task.observersIds) || !task.observersIds.includes(targetUserId))
            ) {
                throw new AutoReminderCallableError(
                    'permission-denied',
                    `Target user is not observing task: ${request.taskId}`
                )
            }

            const dueDate = await autoPostponeTaskCloud({
                projectId,
                task,
                userId: targetUserId,
                editorUserId: actorUserId,
                isObservedTask: request.isObservedTask,
                timezoneContext,
                batch,
                feedUser,
                now,
            })
            updated.push({ ...request, dueDate })
            projectUpdatedCount++

            if (
                !postponedFocusTask &&
                targetData?.inFocusTaskId === task.id &&
                targetData?.inFocusTaskProjectId === projectId
            ) {
                postponedFocusTask = {
                    projectId,
                    parentGoalId: task.parentGoalId || null,
                    taskId: task.id,
                }
            }
        }

        if (projectUpdatedCount > 0) await batch.commit()
    }

    if (postponedFocusTask && targetData) {
        const focusTaskService = new FocusTaskService({ database: db })
        const timezoneOffset = getMomentInTimezone(now, timezoneContext).utcOffset()
        await focusTaskService.findAndSetNewFocusTask(
            targetUserId,
            postponedFocusTask.projectId,
            postponedFocusTask.parentGoalId,
            postponedFocusTask.taskId,
            timezoneOffset
        )
    }

    return {
        requestedCount: tasks.length,
        updatedCount: updated.length,
        updated,
        skipped,
    }
}

module.exports = {
    MAX_AUTO_REMINDER_TASKS,
    AutoReminderCallableError,
    normalizeTaskRequests,
    executeAutoReminderTasks,
}
