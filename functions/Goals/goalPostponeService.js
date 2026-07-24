const admin = require('firebase-admin')

const { canAccessObject, getAccessibleProjectIdsFromUserData } = require('../shared/privacyAccess')
const { createUndoActionRecord, MAX_OPERATIONS_PER_ACTION } = require('../shared/UndoActionService')

const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER
let lastSortIndex = 0

const generateSortIndex = () => {
    const currentTimestamp = Date.now()
    lastSortIndex = Math.max(currentTimestamp, lastSortIndex + 1)
    return lastSortIndex
}

class GoalPostponeError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const getString = value => (typeof value === 'string' ? value.trim() : '')

function normalizeRequest(data = {}) {
    const projectId = getString(data.projectId)
    const goalId = getString(data.goalId)
    const targetUserId = getString(data.targetUserId)
    const requestId = getString(data.requestId)
    const date = Number(data.date)
    const endOfToday = Number(data.endOfToday)

    if (!projectId || !goalId || !targetUserId) {
        throw new GoalPostponeError('invalid-argument', 'projectId, goalId, and targetUserId are required')
    }
    if (!requestId || requestId.includes('/') || requestId.length > 128) {
        throw new GoalPostponeError('invalid-argument', 'A valid requestId is required')
    }
    if (!Number.isFinite(date) || date < 0 || date > BACKLOG_DATE_NUMERIC) {
        throw new GoalPostponeError('invalid-argument', 'A valid postpone date is required')
    }
    if (!Number.isFinite(endOfToday) || endOfToday < 0) {
        throw new GoalPostponeError('invalid-argument', 'A valid endOfToday timestamp is required')
    }

    return {
        projectId,
        goalId,
        targetUserId,
        requestId,
        date,
        endOfToday,
        cascadeToTasks: data.cascadeToTasks !== false,
    }
}

const addFieldSnapshot = (data, field, fields, missingFields) => {
    if (Object.prototype.hasOwnProperty.call(data, field)) fields[field] = data[field]
    else missingFields.push(field)
}

const createUpdateOperation = ({ objectType, projectId, objectId, beforeData, after, fields, metadata }) => {
    const before = {}
    const beforeMissingFields = []
    fields.forEach(field => addFieldSnapshot(beforeData, field, before, beforeMissingFields))

    return {
        objectType,
        projectId,
        objectId,
        kind: 'update',
        before,
        after,
        ...(beforeMissingFields.length > 0 ? { beforeMissingFields } : {}),
        ...metadata,
    }
}

async function executeGoalPostpone({
    actorUserId,
    data,
    db = admin.firestore(),
    createSortIndex = generateSortIndex,
    now = Date.now(),
}) {
    if (!actorUserId) throw new GoalPostponeError('permission-denied', 'Authentication required')

    const request = normalizeRequest(data)
    const { projectId, goalId, targetUserId, requestId, date, endOfToday, cascadeToTasks } = request
    const userRef = db.doc(`users/${actorUserId}`)
    const userSnapshot = await userRef.get()
    if (!userSnapshot.exists) throw new GoalPostponeError('permission-denied', 'User not found')
    if (!getAccessibleProjectIdsFromUserData(userSnapshot.data()).includes(projectId)) {
        throw new GoalPostponeError('permission-denied', 'No access to project')
    }

    const goalRef = db.doc(`goals/${projectId}/items/${goalId}`)
    const actionRef = db.doc(`users/${actorUserId}/undoActions/${requestId}`)
    const taskQuery = cascadeToTasks
        ? db.collection(`items/${projectId}/tasks`).where('parentGoalId', '==', goalId).where('done', '==', false)
        : null

    return db.runTransaction(async transaction => {
        const actionSnapshot = await transaction.get(actionRef)
        if (actionSnapshot.exists) {
            const existingAction = actionSnapshot.data()
            return {
                success: true,
                actionId: requestId,
                date,
                updatedTaskCount: Math.max(0, (existingAction.operations || []).length - 1),
                duplicate: true,
            }
        }

        const goalSnapshot = await transaction.get(goalRef)
        if (!goalSnapshot.exists) throw new GoalPostponeError('not-found', 'Goal not found')

        const goal = goalSnapshot.data()
        if (!canAccessObject(goal, actorUserId)) {
            throw new GoalPostponeError('permission-denied', 'No access to goal')
        }
        if (!Array.isArray(goal.assigneesIds) || !goal.assigneesIds.includes(targetUserId)) {
            throw new GoalPostponeError('failed-precondition', 'The target user is no longer assigned to this goal')
        }

        const taskSnapshot = taskQuery ? await transaction.get(taskQuery) : { docs: [] }
        const tasksToPostpone = taskSnapshot.docs.filter(taskDoc => {
            const task = taskDoc.data()
            return Number.isFinite(task.dueDate) && task.dueDate <= endOfToday
        })

        if (tasksToPostpone.length + 1 > MAX_OPERATIONS_PER_ACTION) {
            throw new GoalPostponeError(
                'failed-precondition',
                'This goal has too many connected tasks to postpone as one undoable action'
            )
        }

        const reminderField = `assigneesReminderDate.${targetUserId}`
        const oldReminderDate = goal.assigneesReminderDate?.[targetUserId]
        const oldTimesPostponed = goal.timesPostponed
        const incrementGoalCount = date > (oldReminderDate || 0) && date !== BACKLOG_DATE_NUMERIC
        const goalAfter = { [reminderField]: date }
        const goalBeforeData = {}
        if (Object.prototype.hasOwnProperty.call(goal.assigneesReminderDate || {}, targetUserId)) {
            goalBeforeData[reminderField] = oldReminderDate
        }
        const goalFields = [reminderField]

        if (incrementGoalCount) {
            goalAfter.timesPostponed = (oldTimesPostponed || 0) + 1
            if (Object.prototype.hasOwnProperty.call(goal, 'timesPostponed')) {
                goalBeforeData.timesPostponed = oldTimesPostponed
            }
            goalFields.push('timesPostponed')
        }

        const goalOperation = createUpdateOperation({
            objectType: 'goal',
            projectId,
            objectId: goalId,
            beforeData: goalBeforeData,
            after: goalAfter,
            fields: goalFields,
        })
        const operations = [goalOperation]
        const taskUpdates = []

        tasksToPostpone.forEach(taskDoc => {
            const task = taskDoc.data()
            const after = {
                dueDate: date,
                sortIndex: createSortIndex(),
                timesPostponed: (task.timesPostponed || 0) + 1,
            }
            operations.push(
                createUpdateOperation({
                    objectType: 'task',
                    projectId,
                    objectId: taskDoc.id,
                    beforeData: task,
                    after,
                    fields: ['dueDate', 'sortIndex', 'timesPostponed'],
                    metadata: {
                        skipIfMissing: true,
                        requiredCurrentFields: { parentGoalId: goalId },
                    },
                })
            )
            taskUpdates.push({ ref: taskDoc.ref || db.doc(`items/${projectId}/tasks/${taskDoc.id}`), after })
        })

        transaction.update(goalRef, goalAfter)
        taskUpdates.forEach(taskUpdate => transaction.update(taskUpdate.ref, taskUpdate.after))

        const action = createUndoActionRecord({
            actionId: requestId,
            initiatorId: actorUserId,
            label: `Postponed goal “${goal.name || 'goal'}”`,
            operations,
            createdAt: now,
        })
        transaction.set(actionRef, action)

        return {
            success: true,
            actionId: requestId,
            date,
            updatedTaskCount: tasksToPostpone.length,
            duplicate: false,
        }
    })
}

module.exports = {
    GoalPostponeError,
    executeGoalPostpone,
    normalizeRequest,
}
