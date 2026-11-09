'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')

const { DONE_STEP, DEFAULT_WORKSTREAM_ID, OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { withoutAccessProjection } = require('./objectAccessProjection')
const { canAccessObject } = require('./privacyAccess')
const { getActorChannelFields } = require('./mcpActor')

const TASK_PROJECT_CHANGED_TO = 17
const TASK_PROJECT_CHANGED_FROM = 18

// security audit 2026-11: subtaskIds is client-writable, and a manual move widens every moved
// task's privacy to the actor. So for a manual move (actorId given) a node is part of the tree only
// if it really is a child of the node that lists it (its parentId says so), and every node must be
// readable by the actor; a tree holding a task the actor cannot read is not moved at all.
async function collectTaskTreeForMove(database, sourceProjectId, rootTaskId, actorId = null) {
    const taskTree = new Map()
    const queue = [{ taskId: rootTaskId, parentTaskId: null }]

    while (queue.length > 0) {
        const { taskId, parentTaskId } = queue.shift()
        if (!taskId || taskTree.has(taskId)) continue

        const taskDoc = await database.doc(`items/${sourceProjectId}/tasks/${taskId}`).get()
        if (!taskDoc.exists) {
            if (taskId === rootTaskId) {
                throw new Error(`Task ${rootTaskId} not found in source project ${sourceProjectId}`)
            }
            continue
        }

        const taskData = taskDoc.data() || {}
        if (actorId) {
            if (parentTaskId && taskData.parentId !== parentTaskId) continue
            if (!canAccessObject(taskData, actorId)) {
                const error = new Error('The task tree contains a task you cannot access')
                error.code = 'permission-denied'
                throw error
            }
        }
        taskTree.set(taskId, taskData)

        const subtaskIds = Array.isArray(taskData.subtaskIds) ? taskData.subtaskIds : []
        subtaskIds.forEach(subtaskId => {
            if (typeof subtaskId === 'string' && subtaskId.trim() && !taskTree.has(subtaskId)) {
                queue.push({ taskId: subtaskId, parentTaskId: taskId })
            }
        })
    }

    return taskTree
}

function buildCalendarProjectRoutingFeedback(task, sourceProjectId, targetProjectId, actorId, requestId, timestamp) {
    const calendarData = task?.calendarData
    if (!calendarData || typeof calendarData !== 'object') return null

    return {
        version: 1,
        feedbackId: requestId,
        requestedAt: timestamp,
        requestedByUserId: actorId,
        syncProjectId: calendarData.originalProjectId || calendarData.projectRouting?.syncProjectId || sourceProjectId,
        movedFromProjectId: sourceProjectId,
        movedToProjectId: targetProjectId,
        previousRoutedProjectId: calendarData.projectRouting?.chosenProjectId || '',
    }
}

function prepareManualTaskMove({
    task,
    isRootTask,
    rootTask,
    sourceProjectId,
    targetProjectId,
    targetProjectUserIds,
    actorId,
    requestId,
    timestamp,
    targetGoal,
}) {
    const targetMembers = new Set(targetProjectUserIds || [])
    const originalOwnerId = rootTask.userId
    const ownerId =
        rootTask.suggestedBy || (!targetMembers.has(originalOwnerId) && originalOwnerId !== DEFAULT_WORKSTREAM_ID)
            ? actorId
            : originalOwnerId
    // Each node keeps its own privacy (collectTaskTreeForMove already proved the actor can read it);
    // taking the root's would publish a private subtask to everyone the root is visible to.
    const ownPrivacy = Array.isArray(task.isPublicFor) ? task.isPublicFor : rootTask.isPublicFor
    const isPublicFor = Array.isArray(ownPrivacy) ? [...ownPrivacy] : [0, originalOwnerId]
    if (!isPublicFor.includes(0) && !isPublicFor.includes(ownerId) && !ownerId.startsWith('ws@')) {
        isPublicFor.push(ownerId)
    }

    const movedTask = {
        ...task,
        projectId: targetProjectId,
        userId: ownerId,
        userIds: [ownerId],
        currentReviewerId: rootTask.done ? DONE_STEP : ownerId,
        stepHistory: [OPEN_STEP],
        observersIds: [],
        dueDateByObserversIds: {},
        estimationsByObserverIds: {},
        parentGoalId: targetGoal?.id || null,
        parentGoalIsPublicFor: targetGoal?.isPublicFor || null,
        lockKey: targetGoal?.lockKey || '',
        // A project move creates the task again in the destination project. Clear
        // every completed or pending decision from the source project so the
        // destination onCreate trigger evaluates its own Goals. Tasks moved as
        // part of a Goal keep their routing state and the copied Goal association.
        goalSuggestion: targetGoal ? task.goalSuggestion || null : null,
        isPublicFor,
        sortIndex: isRootTask ? timestamp : -timestamp,
        creatorId: targetMembers.has(rootTask.creatorId) ? rootTask.creatorId : actorId,
        lastEditionDate: timestamp,
        lastEditorId: actorId,
        movingToOtherProjectId: null,
        projectMove: {
            requestId,
            sourceProjectId,
            targetProjectId,
            requestedByUserId: actorId,
            requestedAt: timestamp,
            status: 'moving',
        },
    }

    if (rootTask.suggestedBy) movedTask.suggestedBy = null

    if (isRootTask && movedTask.parentId) {
        movedTask.parentId = null
        movedTask.isSubtask = false
        movedTask.parentDone = false
        movedTask.inDone = !!movedTask.done
        if (movedTask.done) movedTask.completed = movedTask.completed || timestamp
    } else if (!isRootTask) {
        movedTask.created = rootTask.created
        movedTask.parentDone = !!rootTask.done
        movedTask.inDone = !!rootTask.inDone
        movedTask.dueDate = rootTask.dueDate
        movedTask.completed = rootTask.completed || null
        movedTask.subtaskIds = []
    }

    if (movedTask.calendarData && typeof movedTask.calendarData === 'object') {
        const projectRoutingFeedback = buildCalendarProjectRoutingFeedback(
            rootTask,
            sourceProjectId,
            targetProjectId,
            actorId,
            requestId,
            timestamp
        )
        movedTask.calendarData = {
            ...movedTask.calendarData,
            pinnedToProjectId: targetProjectId,
            ...(projectRoutingFeedback ? { projectRoutingFeedback } : {}),
        }
    }

    return withoutAccessProjection(movedTask)
}

async function persistManualTaskMoveFeeds(database, params) {
    const {
        sourceProject,
        targetProject,
        taskId,
        movedTask,
        actorId,
        followerIds = [],
        requestId,
        timestamp,
        feedUser = null,
    } = params
    // A move made through MCP says so ("Karsten Wysk (via Claude)"); empty for anyone else.
    const actorChannelFields = getActorChannelFields(feedUser)
    const feeds = [
        {
            projectId: sourceProject.id,
            direction: 'to',
            project: targetProject,
            type: TASK_PROJECT_CHANGED_TO,
        },
        {
            projectId: targetProject.id,
            direction: 'from',
            project: sourceProject,
            type: TASK_PROJECT_CHANGED_FROM,
        },
    ]
    const batch = database.batch()

    feeds.forEach(({ projectId, direction, project, type }) => {
        const feedId = `${requestId}-${direction}`
        const feed = {
            type,
            lastChangeDate: timestamp,
            creatorId: actorId,
            objectId: taskId,
            isPublicFor: movedTask.isPublicFor || [0],
            projectName: project.name || '',
            projectColor: project.color || '',
            changeDirection: direction,
            ...actorChannelFields,
        }
        batch.set(database.doc(`projectsInnerFeeds/${projectId}/tasks/${taskId}/feeds/${feedId}`), feed)
        batch.set(database.doc(`feedsStore/${projectId}/all/${feedId}`), feed, { merge: true })
        const feedFollowerIds = direction === 'from' ? [actorId] : followerIds
        feedFollowerIds.forEach(followerId => {
            batch.set(database.doc(`feedsStore/${projectId}/${followerId}/feeds/followed/${feedId}`), feed, {
                merge: true,
            })
        })
        batch.set(database.doc(`projects/${projectId}`), { lastActionDate: timestamp }, { merge: true })
    })

    batch.set(
        database.doc(`followers/${targetProject.id}/tasks/${taskId}`),
        { usersFollowing: admin.firestore.FieldValue.arrayUnion(actorId) },
        { merge: true }
    )
    batch.set(
        database.doc(`usersFollowing/${targetProject.id}/entries/${actorId}`),
        { tasks: { [taskId]: true } },
        { merge: true }
    )
    await batch.commit()
}

// MCP feed parity: contacts and moves
// A task an assistant or an MCP client moves (update_task with moveToProjectId) gets the same two
// "changed project" entries as a move in the app, with the tool's actor. The move itself keeps the
// assistant semantics of moveTaskToDifferentProject (no owner or privacy reset); only the entries
// are added, and a failure to write them is logged, never thrown into the move.
async function loadProjectForMoveFeed(database, project, projectId) {
    if (project && project.name && Array.isArray(project.userIds)) return { ...project, id: projectId }
    const snapshot = await database.doc(`projects/${projectId}`).get()
    return { ...(snapshot.exists ? snapshot.data() || {} : {}), id: projectId }
}

async function persistToolTaskMoveFeeds(database, params) {
    const { sourceProjectId, targetProjectId, taskId, movedTask, feedUser, requestId, timestamp } = params
    try {
        const [sourceProject, targetProject] = await Promise.all([
            loadProjectForMoveFeed(database, params.sourceProject, sourceProjectId),
            loadProjectForMoveFeed(database, params.targetProject, targetProjectId),
        ])
        const followersSnapshot = await database.doc(`followers/${sourceProjectId}/tasks/${taskId}`).get()
        const followerIds = followersSnapshot.exists ? [...(followersSnapshot.data()?.usersFollowing || [])] : []
        // The actor follows the moved task like after a move in the app, unless it is an assistant
        // (only project members are followers).
        const memberIds = Array.isArray(targetProject.userIds) ? targetProject.userIds : []
        if (!followerIds.includes(feedUser.uid) && memberIds.includes(feedUser.uid)) followerIds.push(feedUser.uid)
        await persistManualTaskMoveFeeds(database, {
            sourceProject,
            targetProject,
            taskId,
            movedTask,
            actorId: feedUser.uid,
            followerIds,
            requestId,
            timestamp,
            feedUser,
        })
        return true
    } catch (error) {
        console.warn('Task move: failed to write the moved-task feeds', {
            taskId,
            sourceProjectId,
            targetProjectId,
            error: error.message,
        })
        return false
    }
}

async function moveTaskToDifferentProject(params) {
    const {
        database,
        sourceProjectId,
        targetProjectId,
        taskId,
        editorId,
        editorName,
        manual = false,
        requestId = crypto.randomUUID().replace(/-/g, ''),
    } = params

    if (!sourceProjectId || !targetProjectId || !taskId) {
        throw new Error('sourceProjectId, targetProjectId and taskId are required for task move')
    }
    if (sourceProjectId === targetProjectId) {
        return {
            moved: false,
            reason: 'already_in_target_project',
            sourceProjectId,
            targetProjectId,
            taskId,
            movedTaskCount: 1,
        }
    }

    const sourceRootRef = database.doc(`items/${sourceProjectId}/tasks/${taskId}`)
    const targetRootRef = database.doc(`items/${targetProjectId}/tasks/${taskId}`)
    const [sourceRootSnapshot, targetRootSnapshot] = await Promise.all([sourceRootRef.get(), targetRootRef.get()])
    if (!sourceRootSnapshot.exists && targetRootSnapshot.exists) {
        if (manual && targetRootSnapshot.data()?.projectMove?.requestId === requestId) {
            await targetRootRef.set(
                {
                    projectMove: {
                        ...targetRootSnapshot.data().projectMove,
                        status: 'completed',
                        completedAt: Date.now(),
                    },
                },
                { merge: true }
            )
        }
        return {
            moved: false,
            reason: 'already_moved',
            sourceProjectId,
            targetProjectId,
            taskId,
            movedTaskCount: 1,
        }
    }
    if (!sourceRootSnapshot.exists) {
        throw new Error(`Task ${taskId} not found in source project ${sourceProjectId}`)
    }

    const taskTree = await collectTaskTreeForMove(database, sourceProjectId, taskId, manual ? editorId : null)
    const taskIdsToMove = Array.from(taskTree.keys())
    const timestamp = Date.now()
    const sourceProject = params.sourceProject || { id: sourceProjectId }
    const targetProject = params.targetProject || { id: targetProjectId, userIds: [] }
    const actorId = editorId || taskTree.get(taskId)?.creatorId || taskTree.get(taskId)?.userId

    const targetSnapshots = new Map([[taskId, targetRootSnapshot]])
    for (const id of taskIdsToMove) {
        const targetTaskDoc =
            targetSnapshots.get(id) || (await database.doc(`items/${targetProjectId}/tasks/${id}`).get())
        targetSnapshots.set(id, targetTaskDoc)
        if (targetTaskDoc.exists && targetTaskDoc.data()?.projectMove?.requestId !== requestId) {
            throw new Error(
                `Cannot move task ${taskId}: task ID ${id} already exists in target project ${targetProjectId}.`
            )
        }
    }

    // onDeleteTask copies a moved task's linked note (noteId, client-writable) into the target
    // project. In a manual move a note the actor cannot read is left behind and unlinked instead.
    const unreadableNoteTaskIds = new Set()
    if (manual && editorId) {
        for (const [id, sourceTask] of taskTree.entries()) {
            if (!sourceTask.noteId) continue
            const noteSnapshot = await database.doc(`noteItems/${sourceProjectId}/notes/${sourceTask.noteId}`).get()
            if (noteSnapshot.exists && !canAccessObject(noteSnapshot.data(), editorId)) unreadableNoteTaskIds.add(id)
        }
    }

    const rootTask = taskTree.get(taskId)
    let movedRootTask = null
    for (const [id, sourceTask] of taskTree.entries()) {
        const isRootTask = id === taskId
        const movedTask = manual
            ? prepareManualTaskMove({
                  task: sourceTask,
                  isRootTask,
                  rootTask,
                  sourceProjectId,
                  targetProjectId,
                  targetProjectUserIds: targetProject.userIds,
                  actorId,
                  requestId,
                  timestamp,
                  targetGoal: params.targetGoal,
              })
            : withoutAccessProjection({ ...sourceTask, lastEditionDate: timestamp })

        if (!manual) {
            if (editorId) movedTask.lastEditorId = editorId
            if (editorName) movedTask.lastEditorName = editorName
            delete movedTask.movingToOtherProjectId
            delete movedTask.projectId
            movedTask.parentGoalId = null
            movedTask.parentGoalIsPublicFor = null
            movedTask.lockKey = ''
            movedTask.goalSuggestion = null
            if (isRootTask && movedTask.parentId) {
                movedTask.parentId = null
                movedTask.isSubtask = false
                movedTask.parentDone = false
                movedTask.inDone = !!movedTask.done
                if (movedTask.done && !movedTask.completed) movedTask.completed = timestamp
            }
            if (movedTask.calendarData && typeof movedTask.calendarData === 'object') {
                movedTask.calendarData = { ...movedTask.calendarData, pinnedToProjectId: targetProjectId }
            }
        }

        if (unreadableNoteTaskIds.has(id)) movedTask.noteId = null

        if (!targetSnapshots.get(id).exists) {
            await database.doc(`items/${targetProjectId}/tasks/${id}`).set(movedTask)
        }
        if (isRootTask) movedRootTask = movedTask
    }

    const sourceMoveMarkerUpdate = {
        movingToOtherProjectId: targetProjectId,
        lastEditionDate: timestamp,
    }
    if (editorId) sourceMoveMarkerUpdate.lastEditorId = editorId
    if (editorName) sourceMoveMarkerUpdate.lastEditorName = editorName

    for (const id of taskIdsToMove) {
        const nodeMarkerUpdate = { ...sourceMoveMarkerUpdate }
        const listedSubtaskIds = taskTree.get(id)?.subtaskIds
        if (manual && Array.isArray(listedSubtaskIds)) {
            // onDeleteTask deletes every listed subtask, so a listed id that is not really a child
            // (and was therefore not moved) must not stay listed when the source is deleted.
            const movedSubtaskIds = listedSubtaskIds.filter(subtaskId => taskTree.has(subtaskId))
            if (movedSubtaskIds.length !== listedSubtaskIds.length) nodeMarkerUpdate.subtaskIds = movedSubtaskIds
        }
        if (unreadableNoteTaskIds.has(id)) nodeMarkerUpdate.noteId = null
        try {
            await database.doc(`items/${sourceProjectId}/tasks/${id}`).update(nodeMarkerUpdate)
        } catch (error) {
            if (manual) throw error
            console.warn('Task move: failed to set move marker on source task', {
                taskId: id,
                sourceProjectId,
                error: error.message,
            })
        }
    }

    const copyInnerFeeds = params.copyInnerFeeds || require('../Feeds/globalFeedsHelper').copyInnerFeedsToOtherProject
    const moveManualChat =
        params.moveManualChat || (moveParams => require('../Chats/copyProjectMoveChat').copyProjectMoveChat(moveParams))
    const copyAssistantChat = params.copyChat || require('../Chats/chatsFirestoreCloud').copyChatToOtherProject
    for (const id of taskIdsToMove) {
        if (manual) {
            await moveManualChat({
                adminRef: admin,
                actorId,
                sourceProjectId,
                targetProjectId,
                objectType: 'tasks',
                objectId: id,
            })
            await copyInnerFeeds(admin, sourceProjectId, targetProjectId, 'tasks', id)
        } else {
            // A failed chat migration must leave the source intact, otherwise its delete cascade
            // destroys the only copy of the conversation (including any still-running reply).
            await copyAssistantChat(admin, sourceProjectId, targetProjectId, 'tasks', id)
            await copyInnerFeeds(admin, sourceProjectId, targetProjectId, 'tasks', id).catch(error =>
                console.warn('Task move: failed to copy updates feed to target project', {
                    taskId: id,
                    sourceProjectId,
                    targetProjectId,
                    error: error.message,
                })
            )
        }
    }

    if (manual) {
        const followersSnapshot = await database.doc(`followers/${sourceProjectId}/tasks/${taskId}`).get()
        const followerIds = followersSnapshot.exists ? followersSnapshot.data()?.usersFollowing || [] : []
        if (!followerIds.includes(actorId)) followerIds.push(actorId)
        await persistManualTaskMoveFeeds(database, {
            sourceProject,
            targetProject,
            taskId,
            movedTask: movedRootTask,
            actorId,
            followerIds,
            requestId,
            timestamp,
        })
    } else if (params.feedUser?.uid) {
        // Only the assistant/MCP tools pass a feedUser to a non-manual move; nothing else does.
        await persistToolTaskMoveFeeds(database, {
            sourceProjectId,
            targetProjectId,
            taskId,
            movedTask: movedRootTask,
            feedUser: params.feedUser,
            sourceProject: params.sourceProject,
            targetProject: params.targetProject,
            requestId,
            timestamp,
        })
    }

    await sourceRootRef.delete()
    if (manual) {
        await targetRootRef.set(
            { projectMove: { ...movedRootTask.projectMove, status: 'completed', completedAt: Date.now() } },
            { merge: true }
        )
    }

    return {
        moved: true,
        sourceProjectId,
        targetProjectId,
        taskId,
        movedTaskCount: taskIdsToMove.length,
    }
}

module.exports = {
    TASK_PROJECT_CHANGED_FROM,
    TASK_PROJECT_CHANGED_TO,
    buildCalendarProjectRoutingFeedback,
    collectTaskTreeForMove,
    moveTaskToDifferentProject,
    persistManualTaskMoveFeeds,
    persistToolTaskMoveFeeds,
    prepareManualTaskMove,
}
