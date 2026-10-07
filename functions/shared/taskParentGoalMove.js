'use strict'

const crypto = require('crypto')
const { canAccessObject } = require('./privacyAccess')
const { withoutAccessProjection, valuesEqual } = require('./objectAccessProjection')
const { prepareManualTaskMove, persistManualTaskMoveFeeds } = require('./moveTaskToDifferentProject')
const {
    normalizeParentGoalId,
    buildTaskParentGoalUpdate,
    buildTaskGoalDetachment,
    readTaskGoalParent,
    detachTaskGoalParent,
} = require('./taskParentGoal')

function sourceFingerprint(task) {
    const data = withoutAccessProjection({ ...task })
    delete data.projectMove
    delete data.movingToOtherProjectId
    // Firestore may return maps in a different key order on a later read.
    const stableJson = JSON.stringify(data, (_, value) => {
        if (value && Object.getPrototypeOf(value) === Object.prototype) {
            return Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map(key => [key, value[key]])
            )
        }
        return value
    })
    return crypto.createHash('sha256').update(stableJson).digest('hex')
}

async function readMoveAccess(transaction, database, params) {
    const { projectId, parentGoalProjectId, parentGoalId, userId } = params
    const [source, target, goal] = await Promise.all([
        transaction.get(database.doc(`projects/${projectId}`)),
        transaction.get(database.doc(`projects/${parentGoalProjectId}`)),
        transaction.get(database.doc(`goals/${parentGoalProjectId}/items/${parentGoalId}`)),
    ])
    for (const project of [source, target]) {
        if (!project.exists || !project.data()?.userIds?.includes(userId)) {
            throw new Error('User does not have access to a task move project')
        }
    }
    if (!goal.exists || !canAccessObject(goal.data(), userId))
        throw new Error('Parent goal not found or not accessible')
    return {
        sourceProject: { ...source.data(), id: projectId },
        targetProject: { ...target.data(), id: parentGoalProjectId },
        goal: { ...goal.data(), id: parentGoalId },
    }
}

// Two durable phases: create the entire destination tree + source markers atomically,
// then transfer history before deleting any source. A failed transfer leaves the source
// intact and a retry resumes the same request without overwriting unrelated tasks.
async function persistTaskParentGoalMove(database, params, dependencies = {}) {
    const { projectId, parentGoalProjectId: targetProjectId, taskId, userId, updateData } = params
    params = { ...params, parentGoalId: normalizeParentGoalId(params.parentGoalId) }
    const requestId = crypto
        .createHash('sha256')
        .update(JSON.stringify([projectId, targetProjectId, taskId, userId, params.parentGoalId]))
        .digest('hex')
        .slice(0, 32)
    const timestamp = Date.now()
    const staged = await database.runTransaction(async transaction => {
        const access = await readMoveAccess(transaction, database, params)
        const tree = new Map()
        const queue = [{ id: taskId, parentId: null }]
        while (queue.length) {
            const { id, parentId } = queue.shift()
            if (tree.has(id)) throw new Error('Cannot move a cyclic or repeated subtask hierarchy')
            if (tree.size >= 190) throw new Error('Task tree is too large for an atomic parent goal move')
            const sourceRef = database.doc(`items/${projectId}/tasks/${id}`)
            const targetRef = database.doc(`items/${targetProjectId}/tasks/${id}`)
            const [source, target] = await Promise.all([transaction.get(sourceRef), transaction.get(targetRef)])
            if (!source.exists) {
                if (id === taskId) throw new Error('Source task not found for parent goal move')
                continue // Existing UI moves tolerate stale references to deleted subtasks.
            }
            const task = source.data()
            if (!canAccessObject(task, userId)) throw new Error('Task tree contains a task not accessible to the user')
            if (parentId && task.parentId !== parentId)
                throw new Error('Subtask hierarchy changed during parent goal move')
            if (task.movingToOtherProjectId && task.projectMove?.requestId !== requestId) {
                throw new Error('Task already has a different project move in progress')
            }
            if (target.exists) {
                const move = target.data().projectMove
                if (move?.requestId !== requestId || move.status !== 'moving') {
                    throw new Error('Task ID already exists in target project')
                }
                if (!canAccessObject(target.data(), userId)) throw new Error('Move destination task is not accessible')
                if (move.sourceFingerprint !== sourceFingerprint(task)) {
                    throw new Error('Source task changed after a partial move; reconcile before retrying')
                }
                const expected = prepareMovedTask(
                    task,
                    id === taskId,
                    tree.get(taskId)?.task || task,
                    access,
                    updateData,
                    move.requestedAt
                )
                if (!valuesEqual(expected, withoutAccessProjection(target.data()))) {
                    throw new Error('Destination task changed after a partial move; reconcile before retrying')
                }
            }
            tree.set(id, { task, sourceRef, targetRef, existingTarget: target.exists ? target.data() : null })
            for (const childId of task.subtaskIds || []) {
                if (!childId) throw new Error('Invalid subtask ID in task tree')
                normalizeParentGoalId(childId)
                queue.push({ id: childId, parentId: id })
            }
        }
        await readTaskGoalParent(transaction, database, projectId, tree.get(taskId).task, userId)
        const root = tree.get(taskId).task
        for (const [id, entry] of tree) {
            entry.moved =
                entry.existingTarget || prepareMovedTask(entry.task, id === taskId, root, access, updateData, timestamp)
            if (!entry.existingTarget) transaction.set(entry.targetRef, entry.moved)
            transaction.update(entry.sourceRef, {
                movingToOtherProjectId: targetProjectId,
                projectMove: entry.moved.projectMove,
            })
        }
        return { tree, ...access }
    })

    function prepareMovedTask(task, isRootTask, rootTask, access, changes, requestedAt) {
        const effectiveRoot = { ...rootTask }
        for (const field of ['userId', 'done', 'inDone', 'completed', 'completedDate', 'completedTime']) {
            if (changes[field] !== undefined) effectiveRoot[field] = changes[field]
        }
        if (changes.userId !== undefined && !access.targetProject.userIds.includes(changes.userId)) {
            throw new Error('Requested task assignee is not a member of the goal project')
        }
        const effectiveTask = isRootTask ? { ...task, ...effectiveRoot } : task
        const moved = prepareManualTaskMove({
            task: effectiveTask,
            rootTask: effectiveRoot,
            isRootTask,
            sourceProjectId: projectId,
            targetProjectId,
            targetProjectUserIds: access.targetProject.userIds,
            actorId: userId,
            requestId,
            timestamp: requestedAt,
            targetGoal: access.goal,
        })
        if (!isRootTask && task.subtaskIds?.length) {
            moved.subtaskIds = [...task.subtaskIds]
            moved.subtaskNames = task.subtaskNames || []
        }
        // Preserve validated scalar edits; the destination's ownership/workflow reset
        // remains authoritative for a cross-project move.
        if (isRootTask) {
            const scalarFields = [
                'name',
                'extendedName',
                'description',
                'dueDate',
                'recurrence',
                'executionMode',
                'priority',
                'hasStar',
            ]
            for (const field of scalarFields) if (changes[field] !== undefined) moved[field] = changes[field]
            Object.assign(moved, buildTaskGoalDetachment(effectiveTask))
            if (effectiveTask.parentId && effectiveTask.done && !effectiveTask.completed) moved.completed = requestedAt
        }
        Object.assign(moved, buildTaskParentGoalUpdate({ ...task, parentGoalId: null }, access.goal, userId), {
            sortIndex: isRootTask ? requestedAt : -requestedAt,
        })
        if (moved.goalSuggestion?.resolvedAt) moved.goalSuggestion.resolvedAt = requestedAt
        moved.projectMove.sourceFingerprint = sourceFingerprint(task)
        return Object.fromEntries(
            Object.entries(withoutAccessProjection(moved)).filter(([, value]) => value !== undefined)
        )
    }

    try {
        const admin = require('firebase-admin')
        const copyChat =
            dependencies.copyChat || (args => require('../Chats/copyProjectMoveChat').copyProjectMoveChat(args))
        const copyFeeds = dependencies.copyFeeds || require('../Feeds/globalFeedsHelper').copyInnerFeedsToOtherProject
        for (const [id] of staged.tree) {
            await copyChat({
                adminRef: admin,
                actorId: userId,
                sourceProjectId: projectId,
                targetProjectId,
                objectType: 'tasks',
                objectId: id,
                requestId,
            })
            await copyFeeds(admin, projectId, targetProjectId, 'tasks', id)
        }
        const followers = await database.doc(`followers/${projectId}/tasks/${taskId}`).get()
        await (dependencies.persistFeeds || persistManualTaskMoveFeeds)(database, {
            ...staged,
            taskId,
            movedTask: staged.tree.get(taskId).moved,
            actorId: userId,
            followerIds: followers.exists ? followers.data()?.usersFollowing || [] : [],
            requestId,
            timestamp: staged.tree.get(taskId).moved.projectMove.requestedAt,
        })
        staged.finalTask = await database.runTransaction(async transaction => {
            const access = await readMoveAccess(transaction, database, params)
            for (const entry of staged.tree.values()) {
                const [source, target] = await Promise.all([
                    transaction.get(entry.sourceRef),
                    transaction.get(entry.targetRef),
                ])
                if (
                    !source.exists ||
                    sourceFingerprint(source.data()) !== sourceFingerprint(entry.task) ||
                    source.data().projectMove?.requestId !== requestId ||
                    !target.exists ||
                    !valuesEqual(withoutAccessProjection(target.data()), entry.moved)
                ) {
                    throw new Error('Task changed during parent goal move; source retained')
                }
                if (!canAccessObject(source.data(), userId) || !canAccessObject(target.data(), userId))
                    throw new Error('Task access changed during parent goal move')
            }
            const parent = await readTaskGoalParent(
                transaction,
                database,
                projectId,
                staged.tree.get(taskId).task,
                userId
            )
            // Read fresh goal privacy before finalizing, including a changed lock key.
            for (const entry of staged.tree.values()) {
                transaction.update(entry.targetRef, {
                    parentGoalIsPublicFor: [...access.goal.isPublicFor],
                    lockKey: access.goal.lockKey || '',
                    projectMove: { ...entry.moved.projectMove, status: 'completed', completedAt: Date.now() },
                })
                transaction.delete(entry.sourceRef)
            }
            detachTaskGoalParent(transaction, parent, taskId)
            return {
                ...staged.tree.get(taskId).moved,
                parentGoalIsPublicFor: [...access.goal.isPublicFor],
                lockKey: access.goal.lockKey || '',
                projectMove: {
                    ...staged.tree.get(taskId).moved.projectMove,
                    status: 'completed',
                    completedAt: Date.now(),
                },
            }
        })
    } catch (error) {
        throw new Error(
            `Parent goal move partially completed (request ${requestId}); source retained in ${projectId}, destination staged in ${targetProjectId}. Retry the same goal change after resolving the error: ${error.message}`
        )
    }
    const updatedTask = staged.finalTask
    return { updateData: updatedTask, updatedTask }
}

module.exports = { persistTaskParentGoalMove }
