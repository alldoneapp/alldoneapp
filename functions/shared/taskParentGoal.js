'use strict'

const { assertProjectAccess, canAccessObject, getAccessibleProjectIdsFromUserData } = require('./privacyAccess')

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

async function resolveTaskParentGoal(database, userId, projectId, parentGoalId, parentGoalProjectId) {
    const goalId = normalizeParentGoalId(parentGoalId)
    if (goalId === undefined) return undefined
    const user = await assertProjectAccess(database, userId, projectId)
    if (goalId === null) return null
    const explicitProject = parentGoalProjectId === undefined ? null : normalizeParentGoalId(parentGoalProjectId)
    if (parentGoalProjectId !== undefined && !explicitProject)
        throw new Error('parentGoalProjectId must be a project ID')
    if (explicitProject && explicitProject !== projectId) await assertProjectAccess(database, userId, explicitProject)
    const preferredProject = explicitProject || projectId
    const snapshot = await database.doc(`goals/${preferredProject}/items/${goalId}`).get()
    if (snapshot.exists) {
        if (!canAccessObject(snapshot.data(), userId)) throw new Error('Parent goal not found or not accessible')
        return { ...snapshot.data(), id: goalId, projectId: preferredProject }
    }
    if (explicitProject) throw new Error('Parent goal not found or not accessible')

    // Search only the caller's projects and confirm actual membership. A copied goal
    // may have the same ID in several projects; never choose an arbitrary destination.
    const matches = []
    for (const id of getAccessibleProjectIdsFromUserData(user)) {
        if (id === projectId) continue
        const project = await database.doc(`projects/${id}`).get()
        if (!project.exists || !project.data()?.userIds?.includes(userId)) continue
        const goal = await database.doc(`goals/${id}/items/${goalId}`).get()
        if (goal.exists && canAccessObject(goal.data(), userId))
            matches.push({ ...goal.data(), id: goalId, projectId: id })
    }
    if (matches.length > 1) throw new Error('Parent goal ID is ambiguous; specify parentGoalProjectId')
    if (!matches.length) throw new Error('Parent goal not found or not accessible')
    return matches[0]
}

function buildTaskGoalDetachment(task) {
    if (!task.parentId && !task.isSubtask) return {}
    return {
        parentId: null,
        isSubtask: false,
        parentDone: false,
        inDone: !!task.done,
        completed: task.done ? task.completed || Date.now() : null,
    }
}

async function readTaskGoalParent(transaction, database, projectId, task, userId) {
    if (!task.parentId) return null
    const ref = database.doc(`items/${projectId}/tasks/${task.parentId}`)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    if (!canAccessObject(snapshot.data(), userId)) throw new Error('Parent task not accessible for detachment')
    return { ref, task: snapshot.data() }
}

function detachTaskGoalParent(transaction, parent, taskId) {
    if (!parent) return
    const ids = parent.task.subtaskIds || []
    const names = parent.task.subtaskNames || []
    transaction.update(parent.ref, {
        subtaskIds: ids.filter(id => id !== taskId),
        subtaskNames: names.filter((_, index) => ids[index] !== taskId),
    })
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

async function prepareTaskParentGoalUpdate(
    database,
    userId,
    projectId,
    task,
    parentGoalId,
    parentId,
    parentGoalProjectId
) {
    if (parentGoalId === undefined) return undefined
    if (parentId !== undefined) {
        throw new Error('Change parentId and parentGoalId in separate calls')
    }
    const goal = await resolveTaskParentGoal(database, userId, projectId, parentGoalId, parentGoalProjectId)
    if (!canAccessObject(task, userId)) throw new Error('User does not have access to this task')
    return {
        ...buildTaskParentGoalUpdate(task, goal, userId),
        ...buildTaskGoalDetachment(task),
        ...(goal && goal.projectId !== projectId ? { projectId: goal.projectId } : {}),
    }
}

// Re-read membership, task visibility and goal privacy in the committing transaction.
// This also prevents a router's pending suggestion from undoing a deliberate change.
async function persistTaskParentGoalUpdate(
    database,
    { projectId, taskId, userId, parentGoalId, parentGoalProjectId, updateData }
) {
    if (parentGoalProjectId && parentGoalProjectId !== projectId) {
        return require('./taskParentGoalMove').persistTaskParentGoalMove(database, {
            projectId,
            taskId,
            userId,
            parentGoalId,
            parentGoalProjectId,
            updateData,
        })
    }
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
        const parent = await readTaskGoalParent(transaction, database, projectId, task, userId)
        const goal = goalSnapshot ? { ...goalSnapshot.data(), id: goalId } : null
        const persistedData = { ...updateData }
        delete persistedData.goalSuggestion
        Object.assign(persistedData, buildTaskParentGoalUpdate(task, goal, userId))
        // Never retain a stale visibility projection from the preflight read.
        Object.assign(
            persistedData,
            buildTaskParentGoalFields(goal),
            buildTaskGoalDetachment({ ...task, ...updateData, parentId: task.parentId, isSubtask: task.isSubtask })
        )
        detachTaskGoalParent(transaction, parent, taskId)
        transaction.update(taskRef, persistedData)
        return { updateData: persistedData, updatedTask: { ...task, ...persistedData } }
    })
}

module.exports = {
    readTaskGoalParent,
    detachTaskGoalParent,
    buildTaskGoalDetachment,
    buildTaskParentGoalUpdate,
    normalizeParentGoalId,
    resolveTaskParentGoal,
    buildTaskParentGoalFields,
    prepareTaskParentGoalUpdate,
    persistTaskParentGoalUpdate,
}
