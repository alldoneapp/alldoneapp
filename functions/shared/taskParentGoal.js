'use strict'

const { assertProjectAccess, canAccessObject } = require('./privacyAccess')

function normalizeParentGoalId(value) {
    if (value === undefined || value === null) return value
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (
        typeof value !== 'string' ||
        !normalized ||
        normalized.includes('/') ||
        normalized === '.' ||
        normalized === '..' ||
        Buffer.byteLength(normalized, 'utf8') > 1500
    ) {
        throw new Error('parentGoalId must be a non-empty goal document ID or null to clear the parent goal')
    }
    return normalized
}

async function resolveTaskParentGoal(database, userId, projectId, parentGoalId) {
    const goalId = normalizeParentGoalId(parentGoalId)
    if (goalId === undefined) return undefined

    // Admin SDK bypasses Firestore rules: enforce the invoking human's membership,
    // not the assistant actor's identity. Clearing also requires project access.
    await assertProjectAccess(database, userId, projectId)
    if (goalId === null) return null

    const snapshot = await database.doc(`goals/${projectId}/items/${goalId}`).get()
    if (!snapshot.exists || !canAccessObject(snapshot.data(), userId)) {
        throw new Error('Parent goal not found or not accessible in the task project')
    }
    return { ...snapshot.data(), id: goalId }
}

function buildTaskParentGoalFields(goal) {
    return {
        parentGoalId: goal?.id || null,
        parentGoalIsPublicFor: goal ? [...goal.isPublicFor] : null,
        lockKey: goal?.lockKey || '',
    }
}

function buildTaskParentGoalUpdate(task, goal, userId) {
    const fields = buildTaskParentGoalFields(goal)
    if (
        (task.parentGoalId || null) === fields.parentGoalId &&
        JSON.stringify(task.parentGoalIsPublicFor ?? null) === JSON.stringify(fields.parentGoalIsPublicFor) &&
        (task.lockKey || '') === fields.lockKey &&
        task.goalSuggestion?.status !== 'pending' &&
        task.goalSuggestion?.status !== 'classifying'
    ) {
        return {}
    }
    const now = Date.now()
    return {
        ...fields,
        sortIndex: now,
        ...(task.goalSuggestion?.status === 'pending' || task.goalSuggestion?.status === 'classifying'
            ? {
                  goalSuggestion: {
                      ...task.goalSuggestion,
                      status: 'superseded',
                      resolvedAt: now,
                      resolvedBy: userId,
                  },
              }
            : {}),
    }
}

async function prepareTaskParentGoalUpdate(database, userId, projectId, task, parentGoalId, parentId) {
    if (parentGoalId === undefined) return undefined
    if (parentId !== undefined) {
        throw new Error('Change parentId and parentGoalId in separate calls')
    }
    if (task.parentId || task.isSubtask) {
        throw new Error('Subtasks inherit their parent goal. Update the parent task or detach the subtask first')
    }
    const goal = await resolveTaskParentGoal(database, userId, projectId, parentGoalId)
    if (!canAccessObject(task, userId)) throw new Error('User does not have access to this task')
    return buildTaskParentGoalUpdate(task, goal, userId)
}

// Re-read membership, task visibility and goal privacy in the committing transaction.
// This also prevents a router's pending suggestion from undoing a deliberate change.
async function persistTaskParentGoalUpdate(database, { projectId, taskId, userId, parentGoalId, updateData }) {
    const goalId = normalizeParentGoalId(parentGoalId)
    return database.runTransaction(async transaction => {
        const taskRef = database.doc(`items/${projectId}/tasks/${taskId}`)
        const [projectSnapshot, taskSnapshot, goalSnapshot] = await Promise.all([
            transaction.get(database.doc(`projects/${projectId}`)),
            transaction.get(taskRef),
            goalId === null
                ? Promise.resolve(null)
                : transaction.get(database.doc(`goals/${projectId}/items/${goalId}`)),
        ])
        if (!projectSnapshot.exists || !projectSnapshot.data()?.userIds?.includes(userId)) {
            throw new Error('User does not have access to this project')
        }
        if (!taskSnapshot.exists || !canAccessObject(taskSnapshot.data(), userId)) {
            throw new Error('Task not found or not accessible')
        }
        if (goalId !== null && (!goalSnapshot.exists || !canAccessObject(goalSnapshot.data(), userId))) {
            throw new Error('Parent goal not found or not accessible in the task project')
        }
        const task = taskSnapshot.data()
        if (task.parentId || task.isSubtask) {
            throw new Error('Subtasks inherit their parent goal. Update the parent task or detach the subtask first')
        }
        const goal = goalSnapshot ? { ...goalSnapshot.data(), id: goalId } : null
        const persistedData = { ...updateData }
        delete persistedData.goalSuggestion
        Object.assign(persistedData, buildTaskParentGoalUpdate(task, goal, userId))
        // Never retain a stale visibility projection from the preflight read.
        Object.assign(persistedData, buildTaskParentGoalFields(goal))
        transaction.update(taskRef, persistedData)
        return { updateData: persistedData, updatedTask: { ...task, ...persistedData } }
    })
}

module.exports = {
    normalizeParentGoalId,
    resolveTaskParentGoal,
    buildTaskParentGoalFields,
    prepareTaskParentGoalUpdate,
    persistTaskParentGoalUpdate,
}
