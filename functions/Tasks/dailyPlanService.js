const admin = require('firebase-admin')
const moment = require('moment')

const { canAccessObject } = require('../shared/privacyAccess')
const { createUndoActionRecord, MAX_OPERATIONS_PER_ACTION } = require('../shared/UndoActionService')
const { FocusTaskService } = require('../shared/FocusTaskService')
const { getDateToMoveTaskInAutoPostpone } = require('./autoPostponeTasksCloud')

/**
 * AT-3142 — apply "Today's plan" (capacity-aware positive daily selection).
 *
 * The client reviews Anna's proposal and sends ONE decision per task that is on the user's Today:
 *
 *   - `plan`     the task is in today's plan with priority must_do / should_do / could_do;
 *   - `postpone` the task moves along the existing auto-postpone ladder (3 days → week → month →
 *                3 months → 6 months → year → Someday), computed HERE from the stored counter;
 *   - `keep`     not planned, stays due today; a Must/Should/Could priority becomes Do later so the
 *                planned tasks lead the list.
 *
 * Everything is written in one transaction together with ONE undo record
 * (`users/{uid}/undoActions/{requestId}`, the existing Undo bar shows it) and the plan record
 * (`users/{uid}/dailyPlans/{localDateKey}`). Each undo operation carries `skipIfChanged` and
 * `requiredCurrentFields: { inDone: false }`: Undo restores only what this plan changed, leaves a
 * task completed since alone and never overwrites a task edited after the apply.
 *
 * Someday is opt-in: a `postpone` whose stored counter leads to Someday is only applied with
 * `confirmSomeday: true`, so a counter that changed between the review and the apply cannot send a
 * task to Someday the user did not see. Tasks that would have gone to Someday but were kept are
 * recorded as `somedayHoldTaskKeys`; the nightly auto-postpone (`autoPostponeTasksCloud.js`) does not
 * send those to Someday until the user's next applied plan decides again.
 *
 * Authority: the caller is always `request.auth.uid`; every project is checked against
 * `projects/{pid}.userIds` inside the transaction and every task against its visibility, exactly
 * the authority the existing bulk auto-postpone callable has. Only tasks that are on the caller's
 * Today (effective due date today or earlier, open, top level) are changed; anything else is
 * reported as skipped. Observed tasks only get the observer's own due date moved, never the
 * owner's priority.
 */

const BACKLOG_DATE = Number.MAX_SAFE_INTEGER
const MAX_PLAN_TASKS = MAX_OPERATIONS_PER_ACTION
const PLAN_PRIORITIES = new Set(['must_do', 'should_do', 'could_do'])
const DECISIONS = new Set(['plan', 'postpone', 'keep'])
const MAX_ESTIMATE_MINUTES = 24 * 60

class DailyPlanError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const isValidId = value => typeof value === 'string' && !!value.trim() && !value.includes('/') && value.length <= 128

const taskKey = (projectId, taskId) => `${projectId}:${taskId}`

function normalizeDailyPlanRequest(data) {
    if (!data || typeof data !== 'object') throw new DailyPlanError('invalid-argument', 'A request object is required')
    if (!isValidId(data.requestId)) throw new DailyPlanError('invalid-argument', 'A valid requestId is required')
    if (!Number.isInteger(data.timezoneOffset) || Math.abs(data.timezoneOffset) > 840) {
        throw new DailyPlanError('invalid-argument', 'A valid timezoneOffset in minutes is required')
    }
    if (typeof data.localDateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.localDateKey)) {
        throw new DailyPlanError('invalid-argument', 'A valid localDateKey is required')
    }
    if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
        throw new DailyPlanError('invalid-argument', 'At least one task decision is required')
    }
    if (data.tasks.length > MAX_PLAN_TASKS) {
        throw new DailyPlanError('invalid-argument', `A plan can contain at most ${MAX_PLAN_TASKS} tasks`)
    }

    const seen = new Set()
    const tasks = data.tasks.map((item, index) => {
        const invalid = () => new DailyPlanError('invalid-argument', `tasks[${index}] is not a valid plan decision`)
        if (!item || typeof item !== 'object') throw invalid()
        const { projectId, taskId, decision, isObservedTask } = item
        if (!isValidId(projectId) || !isValidId(taskId) || !DECISIONS.has(decision)) throw invalid()
        if (typeof isObservedTask !== 'boolean') throw invalid()
        if (decision === 'plan' && !PLAN_PRIORITIES.has(item.priority)) throw invalid()
        const key = taskKey(projectId, taskId)
        if (seen.has(key)) {
            throw new DailyPlanError('invalid-argument', `tasks[${index}] repeats a task already in the plan`)
        }
        seen.add(key)
        const estimate = Number(item.estimateMinutes)
        return {
            projectId,
            taskId,
            key,
            decision,
            isObservedTask,
            priority: decision === 'plan' ? item.priority : null,
            confirmSomeday: decision === 'postpone' && item.confirmSomeday === true,
            estimateMinutes:
                Number.isFinite(estimate) && estimate >= 0 ? Math.min(Math.round(estimate), MAX_ESTIMATE_MINUTES) : 0,
        }
    })

    return {
        requestId: data.requestId.trim(),
        timezoneOffset: data.timezoneOffset,
        localDateKey: data.localDateKey,
        tasks,
    }
}

const getRecurrenceType = task =>
    task?.recurrence && typeof task.recurrence === 'object' ? task.recurrence.type : task?.recurrence

// before/beforeMissingFields of exactly the fields `after` touches (dotted paths included).
function captureBefore(task, after) {
    const before = {}
    const beforeMissingFields = []
    Object.keys(after).forEach(field => {
        const value = String(field)
            .split('.')
            .reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), task)
        if (value === undefined) beforeMissingFields.push(field)
        else before[field] = value
    })
    return { before, beforeMissingFields }
}

function buildOperation(projectId, taskId, task, after, extraRequired = {}) {
    const { before, beforeMissingFields } = captureBefore(task, after)
    return {
        objectType: 'task',
        projectId,
        objectId: taskId,
        kind: 'update',
        before,
        after,
        beforeMissingFields,
        skipIfMissing: true,
        skipIfChanged: true,
        requiredCurrentFields: { inDone: false, ...extraRequired },
    }
}

// The primary-task fields a postpone writes; identical to autoPostponeTaskCloud / projectPostponeService.
function buildPostponeFields(task, newDueDate, sortIndex) {
    const after = { dueDate: newDueDate, sortIndex }
    if (newDueDate > task.dueDate) {
        after.timesPostponed = (task.timesPostponed || 0) + 1
        after.priority = 'none'
        const recurrence = getRecurrenceType(task)
        if (recurrence && recurrence !== 'never' && !task.recurrenceOriginalDueDate) {
            after.recurrenceOriginalDueDate = task.dueDate
        }
    }
    return after
}

/**
 * Pure decision for one stored task. Returns
 *   { status: 'skipped', reason } or
 *   { status: 'ok', after (may be empty), postponed, newDueDate, somedayHold }.
 */
function resolveTaskChange({ request, task, actorUserId, endOfToday, timezoneOffset, now, sortIndex }) {
    if (!task) return { status: 'skipped', reason: 'not-found' }
    if (task.done === true || task.inDone === true) return { status: 'skipped', reason: 'completed' }
    if (task.parentId !== null && task.parentId !== undefined) return { status: 'skipped', reason: 'subtask' }
    if (!canAccessObject(task, actorUserId)) {
        throw new DailyPlanError('permission-denied', `No access to task: ${request.taskId}`)
    }
    if (request.isObservedTask && !(Array.isArray(task.observersIds) && task.observersIds.includes(actorUserId))) {
        throw new DailyPlanError('permission-denied', `You are not observing task: ${request.taskId}`)
    }

    const effectiveDueDate = request.isObservedTask ? task.dueDateByObserversIds?.[actorUserId] : task.dueDate
    if (!Number.isFinite(effectiveDueDate) || effectiveDueDate >= BACKLOG_DATE || effectiveDueDate > endOfToday) {
        return { status: 'skipped', reason: 'not-due-today' }
    }

    const timezoneContext = { offsetMinutes: timezoneOffset }
    const ladderDate = getDateToMoveTaskInAutoPostpone(
        task.timesPostponed,
        request.isObservedTask,
        timezoneContext,
        now
    )
    const wouldGoToSomeday = !request.isObservedTask && ladderDate === BACKLOG_DATE

    if (request.decision === 'postpone') {
        if (wouldGoToSomeday && !request.confirmSomeday) {
            return { status: 'skipped', reason: 'someday-not-confirmed', somedayHold: true }
        }
        if (request.isObservedTask) {
            return {
                status: 'ok',
                after: { [`dueDateByObserversIds.${actorUserId}`]: ladderDate },
                postponed: true,
                newDueDate: ladderDate,
                somedayHold: false,
            }
        }
        return {
            status: 'ok',
            after: buildPostponeFields(task, ladderDate, sortIndex),
            postponed: true,
            newDueDate: ladderDate,
            somedayHold: false,
        }
    }

    // The owner's priority is not the observer's to set.
    if (request.isObservedTask) return { status: 'ok', after: {}, postponed: false, somedayHold: false }

    const currentPriority = task.priority || 'none'
    const after = {}
    if (request.decision === 'plan' && currentPriority !== request.priority) after.priority = request.priority
    if (request.decision === 'keep' && PLAN_PRIORITIES.has(currentPriority)) after.priority = 'do_later'
    return { status: 'ok', after, postponed: false, somedayHold: request.decision === 'keep' && wouldGoToSomeday }
}

async function executeApplyDailyPlan({ actorUserId, data, db = admin.firestore(), now = Date.now() }) {
    if (!actorUserId) throw new DailyPlanError('permission-denied', 'Authentication required')
    const { requestId, timezoneOffset, localDateKey, tasks } = normalizeDailyPlanRequest(data)

    const localNow = moment(now).utcOffset(timezoneOffset)
    // A review left open over midnight must not plan "today" with yesterday's decisions.
    if (localNow.format('YYYY-MM-DD') !== localDateKey) {
        throw new DailyPlanError('failed-precondition', 'This plan was made for another day. Please review it again.')
    }
    const endOfToday = localNow.clone().endOf('day').valueOf()

    const actionRef = db.doc(`users/${actorUserId}/undoActions/${requestId}`)
    const planRef = db.doc(`users/${actorUserId}/dailyPlans/${localDateKey}`)
    const userRef = db.doc(`users/${actorUserId}`)
    const projectIds = [...new Set(tasks.map(task => task.projectId))]

    const result = await db.runTransaction(async transaction => {
        const existing = await transaction.get(actionRef)
        if (existing.exists) {
            const operations = Array.isArray(existing.data()?.operations) ? existing.data().operations : []
            return { actionId: requestId, updatedTaskCount: operations.length, duplicate: true, skipped: [] }
        }

        // Membership is projects/{pid}.userIds, read inside the transaction.
        for (const projectId of projectIds) {
            const projectSnapshot = await transaction.get(db.doc(`projects/${projectId}`))
            const userIds = projectSnapshot.exists ? projectSnapshot.data()?.userIds : null
            if (!Array.isArray(userIds) || !userIds.includes(actorUserId)) {
                throw new DailyPlanError('permission-denied', `No access to project: ${projectId}`)
            }
        }

        const userSnapshot = await transaction.get(userRef)
        const userData = userSnapshot.exists ? userSnapshot.data() || {} : {}

        const taskSnapshots = await Promise.all(
            tasks.map(request => transaction.get(db.doc(`items/${request.projectId}/tasks/${request.taskId}`)))
        )

        const operations = []
        const skipped = []
        const somedayHoldTaskKeys = []
        const planned = []
        const postponedTaskKeys = []
        const keptTaskKeys = []
        const subtaskReads = []
        let postponedFocusTask = null

        tasks.forEach((request, index) => {
            const snapshot = taskSnapshots[index]
            const task = snapshot.exists ? snapshot.data() : null
            const change = resolveTaskChange({
                request,
                task,
                actorUserId,
                endOfToday,
                timezoneOffset,
                now,
                sortIndex: now + index,
            })
            if (change.somedayHold) somedayHoldTaskKeys.push(request.key)
            if (change.status === 'skipped') {
                skipped.push({ projectId: request.projectId, taskId: request.taskId, reason: change.reason })
                if (change.reason === 'someday-not-confirmed') keptTaskKeys.push(request.key)
                return
            }

            if (request.decision === 'plan') {
                planned.push({
                    key: request.key,
                    projectId: request.projectId,
                    priority: request.priority,
                    minutes: request.estimateMinutes,
                })
            } else if (request.decision === 'postpone') {
                postponedTaskKeys.push(request.key)
            } else {
                keptTaskKeys.push(request.key)
            }

            if (Object.keys(change.after).length > 0) {
                operations.push({
                    ref: snapshot.ref || db.doc(`items/${request.projectId}/tasks/${request.taskId}`),
                    operation: buildOperation(request.projectId, request.taskId, task, change.after),
                })
            }

            if (change.postponed && !request.isObservedTask && Array.isArray(task.subtaskIds)) {
                task.subtaskIds.filter(isValidId).forEach(subtaskId =>
                    subtaskReads.push({
                        projectId: request.projectId,
                        parentId: request.taskId,
                        subtaskId,
                        newDueDate: change.newDueDate,
                    })
                )
            }

            if (
                change.postponed &&
                !postponedFocusTask &&
                userData.inFocusTaskId === request.taskId &&
                userData.inFocusTaskProjectId === request.projectId
            ) {
                postponedFocusTask = {
                    projectId: request.projectId,
                    taskId: request.taskId,
                    parentGoalId: task.parentGoalId || null,
                }
            }
        })

        // Bound the work before reading the subtasks: every one of them could become an operation.
        if (operations.length + subtaskReads.length > MAX_OPERATIONS_PER_ACTION) {
            throw new DailyPlanError(
                'failed-precondition',
                'This plan changes too many tasks to undo as one action. Please postpone fewer tasks.'
            )
        }

        // Subtasks travel with their parent, as in autoPostponeTaskCloud.
        const subtaskSnapshots = await Promise.all(
            subtaskReads.map(read => transaction.get(db.doc(`items/${read.projectId}/tasks/${read.subtaskId}`)))
        )
        subtaskReads.forEach((read, index) => {
            const snapshot = subtaskSnapshots[index]
            const subtask = snapshot.exists ? snapshot.data() : null
            if (!subtask || subtask.inDone === true || subtask.done === true || subtask.parentId !== read.parentId)
                return
            if (!canAccessObject(subtask, actorUserId)) return
            if (Number.isFinite(subtask.dueDate) && subtask.dueDate >= read.newDueDate) return
            const after = {
                dueDate: read.newDueDate,
                priority: 'none',
                timesPostponed: (subtask.timesPostponed || 0) + 1,
            }
            operations.push({
                ref: snapshot.ref || db.doc(`items/${read.projectId}/tasks/${read.subtaskId}`),
                operation: buildOperation(read.projectId, read.subtaskId, subtask, after, { parentId: read.parentId }),
            })
        })

        if (operations.length > MAX_OPERATIONS_PER_ACTION) {
            throw new DailyPlanError(
                'failed-precondition',
                'This plan changes too many tasks to undo as one action. Please postpone fewer tasks.'
            )
        }

        operations.forEach(({ ref, operation }) => {
            transaction.update(ref, { ...operation.after, lastEditionDate: now, lastEditorId: actorUserId })
        })

        const actionId = operations.length > 0 ? requestId : null
        if (actionId) {
            transaction.set(
                actionRef,
                createUndoActionRecord({
                    actionId,
                    initiatorId: actorUserId,
                    label: `Applied today’s plan (${planned.length} planned, ${postponedTaskKeys.length} postponed)`,
                    operations: operations.map(({ operation }) => operation),
                    createdAt: now,
                })
            )
        }

        transaction.set(planRef, {
            localDateKey,
            requestId,
            actionId,
            appliedAt: now,
            timezoneOffset,
            planned,
            plannedMinutes: planned.reduce((total, item) => total + item.minutes, 0),
            postponedTaskKeys,
            keptTaskKeys,
            somedayHoldTaskKeys,
        })

        return {
            actionId,
            updatedTaskCount: operations.length,
            plannedCount: planned.length,
            postponedCount: postponedTaskKeys.length,
            keptCount: keptTaskKeys.length,
            duplicate: false,
            skipped,
            postponedFocusTask,
        }
    })

    if (result.postponedFocusTask) {
        const { projectId, taskId, parentGoalId } = result.postponedFocusTask
        // Already committed: a failed focus refresh must not report a failed plan, and the
        // conditional write never overrides a focus the user picked meanwhile (AT-2251).
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
            console.warn('[dailyPlan] Could not refresh focus after applying the plan', { error: error.message })
        }
    }

    const { postponedFocusTask, ...response } = result
    return { success: true, ...response }
}

/**
 * Keys ("projectId:taskId") the nightly auto-postpone must not send to Someday: the Someday
 * tasks the user explicitly kept in their latest applied plan. Returns null when the plan record
 * cannot be read, so the caller can fail closed (no automatic Someday at all for that run).
 */
async function loadSomedayHoldTaskKeys(db, userId) {
    try {
        const snapshot = await db.collection(`users/${userId}/dailyPlans`).orderBy('appliedAt', 'desc').limit(1).get()
        const latest = snapshot.docs[0]?.data()
        return new Set(Array.isArray(latest?.somedayHoldTaskKeys) ? latest.somedayHoldTaskKeys : [])
    } catch (error) {
        console.warn('[dailyPlan] Could not read Someday holds', { userId, error: error.message })
        return null
    }
}

module.exports = {
    DailyPlanError,
    MAX_PLAN_TASKS,
    executeApplyDailyPlan,
    loadSomedayHoldTaskKeys,
    normalizeDailyPlanRequest,
    resolveTaskChange,
}
