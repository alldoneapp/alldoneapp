const admin = require('firebase-admin')
const moment = require('moment')

const { assertProjectAccess, canAccessObject } = require('../shared/privacyAccess')
const { createUndoActionRecord, MAX_OPERATIONS_PER_ACTION } = require('../shared/UndoActionService')
const { getDateToMoveTaskInAutoPostpone } = require('./autoPostponeTasksCloud')
const { FocusTaskService } = require('../shared/FocusTaskService')

const BACKLOG_DATE = Number.MAX_SAFE_INTEGER

class ProjectPostponeError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

function normalizeRequest(data = {}) {
    if (!data || typeof data !== 'object') {
        throw new ProjectPostponeError('invalid-argument', 'A request object is required')
    }
    const validId = value => typeof value === 'string' && value.trim() && !value.includes('/')
    if (!validId(data.projectId) || !validId(data.requestId) || data.requestId.length > 128) {
        throw new ProjectPostponeError('invalid-argument', 'Valid projectId and requestId are required')
    }
    if (!Number.isInteger(data.timezoneOffset) || Math.abs(data.timezoneOffset) > 840) {
        throw new ProjectPostponeError('invalid-argument', 'A valid timezoneOffset in minutes is required')
    }
    if (data.mode !== 'date' && data.mode !== 'auto') {
        throw new ProjectPostponeError('invalid-argument', 'mode must be date or auto')
    }
    if (data.mode === 'date' && (!Number.isSafeInteger(data.date) || data.date < 0 || data.date > BACKLOG_DATE)) {
        throw new ProjectPostponeError('invalid-argument', 'A valid postpone date is required')
    }
    return { ...data, projectId: data.projectId.trim(), requestId: data.requestId.trim() }
}

// Select on the server, so collapsed goals, pagination and browser filters cannot leave tasks behind.
// The actor is ALWAYS the planning user; caller-supplied targetUserId/task ids have no authority.
async function executeProjectPostpone({ actorUserId, data, db = admin.firestore(), now = Date.now() }) {
    if (!actorUserId) throw new ProjectPostponeError('permission-denied', 'Authentication required')
    const { projectId, requestId, mode, date, timezoneOffset } = normalizeRequest(data)
    let actorData
    try {
        actorData = await assertProjectAccess(db, actorUserId, projectId)
    } catch (_error) {
        throw new ProjectPostponeError('permission-denied', 'No access to project')
    }

    const endOfToday = moment(now).utcOffset(timezoneOffset).endOf('day').valueOf()
    const actionRef = db.doc(`users/${actorUserId}/undoActions/${requestId}`)
    // Equality filters need no new composite index. Apply the date/visibility checks inside the transaction.
    const query = db
        .collection(`items/${projectId}/tasks`)
        .where('currentReviewerId', '==', actorUserId)
        .where('inDone', '==', false)

    const result = await db.runTransaction(async transaction => {
        const existing = await transaction.get(actionRef)
        if (existing.exists) {
            return {
                success: true,
                actionId: requestId,
                updatedTaskCount: existing.data().operations.length,
                duplicate: true,
            }
        }
        const projectSnapshot = await transaction.get(db.doc(`projects/${projectId}`))
        if (!projectSnapshot.exists || !projectSnapshot.data().userIds?.includes(actorUserId)) {
            throw new ProjectPostponeError('permission-denied', 'No access to project')
        }
        const taskSnapshot = await transaction.get(query)
        const tasks = taskSnapshot.docs.filter(doc => {
            const task = doc.data()
            return (
                task.currentReviewerId === actorUserId &&
                task.inDone === false &&
                task.done !== true &&
                canAccessObject(task, actorUserId) &&
                Number.isFinite(task.dueDate) &&
                task.dueDate <= endOfToday
            )
        })
        if (tasks.length > MAX_OPERATIONS_PER_ACTION) {
            throw new ProjectPostponeError('failed-precondition', 'Too many tasks to postpone as one undoable action')
        }
        if (!tasks.length) return { success: true, actionId: null, updatedTaskCount: 0, duplicate: false }

        const operations = tasks.map((doc, index) => {
            const task = doc.data()
            const dueDate =
                mode === 'auto'
                    ? getDateToMoveTaskInAutoPostpone(
                          task.timesPostponed,
                          false,
                          { offsetMinutes: timezoneOffset },
                          now
                      )
                    : date
            const after = { dueDate, sortIndex: now + index }
            if (dueDate > task.dueDate) {
                after.timesPostponed = (task.timesPostponed || 0) + 1
                after.priority = 'none'
                const recurrence = typeof task.recurrence === 'object' ? task.recurrence?.type : task.recurrence
                if (recurrence && recurrence !== 'never' && !task.recurrenceOriginalDueDate) {
                    after.recurrenceOriginalDueDate = task.dueDate
                }
            }
            const before = {}
            const beforeMissingFields = []
            Object.keys(after).forEach(field => {
                if (Object.prototype.hasOwnProperty.call(task, field)) before[field] = task[field]
                else beforeMissingFields.push(field)
            })
            transaction.update(doc.ref, after)
            return {
                objectType: 'task',
                projectId,
                objectId: doc.id,
                kind: 'update',
                before,
                after,
                beforeMissingFields,
                skipIfMissing: true,
                requiredCurrentFields: {
                    currentReviewerId: actorUserId,
                    inDone: false,
                    ...('parentId' in task ? { parentId: task.parentId } : {}),
                },
            }
        })
        transaction.set(
            actionRef,
            createUndoActionRecord({
                actionId: requestId,
                initiatorId: actorUserId,
                label: `Postponed project tasks “${projectSnapshot.data().name || 'project'}”`,
                operations,
                createdAt: now,
            })
        )
        const focusIndex = tasks.findIndex(
            doc => doc.id === actorData.inFocusTaskId && actorData.inFocusTaskProjectId === projectId
        )
        const postponedFocusTask =
            focusIndex >= 0 && operations[focusIndex].after.dueDate > endOfToday
                ? { taskId: tasks[focusIndex].id, parentGoalId: tasks[focusIndex].data().parentGoalId || null }
                : null
        return {
            success: true,
            actionId: requestId,
            updatedTaskCount: operations.length,
            duplicate: false,
            postponedFocusTask,
        }
    })
    if (result.postponedFocusTask) {
        const { taskId, parentGoalId } = result.postponedFocusTask
        // The task transaction has already committed. A failed focus refresh must not report that
        // the postpone failed or overwrite a focus the user selected while the callable ran.
        try {
            await new FocusTaskService({ database: db }).findAndSetNewFocusTask(
                actorUserId,
                projectId,
                parentGoalId,
                taskId,
                timezoneOffset,
                null,
                { expectedCurrentFocusTaskId: taskId }
            )
        } catch (error) {
            console.warn('[projectPostpone] Could not refresh focus after postponing', { error: error.message })
        }
    }
    const { postponedFocusTask, ...response } = result
    return response
}

module.exports = { executeProjectPostpone, normalizeRequest, ProjectPostponeError }
