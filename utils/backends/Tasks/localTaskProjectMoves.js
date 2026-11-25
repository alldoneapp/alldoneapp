import { DEFAULT_WORKSTREAM_ID } from '../../../components/Workstreams/WorkstreamConstants'

/**
 * Local state of task project moves started in this tab: which rows are on their way out of which
 * project, and what the destination copy looks like. Kept free of Firestore and redux imports
 * because the task watchers and the task row both load it; the move itself is orchestrated in
 * optimisticTaskProjectMove.js, which explains the whole flow.
 */

// OPEN_STEP / DONE_STEP of components/TaskListView/Utils/TasksHelper.js. Not imported: that module
// pulls in most of the app, and this one is loaded by the task watchers and the project picker.
const OPEN_STEP = -1
const DONE_STEP = -2

/** After this the local hint expires on its own; the server marker or the real documents rule. */
export const LOCAL_TASK_PROJECT_MOVE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * A server marker older than this no longer hides the row. A worker that died without recording
 * its terminal state would otherwise make the task invisible in its project for good; before
 * this change such a task showed with a spinner, and after this window it does again.
 */
export const SERVER_MOVE_MARKER_HIDE_WINDOW_MS = 10 * 60 * 1000

const movesByTaskId = new Map()
const listeners = new Set()

const notify = event => {
    Array.from(listeners).forEach(listener => {
        try {
            listener(event)
        } catch (error) {
            // One broken list must not stop the others from hiding or restoring the row.
            console.warn('[task project move] local task move listener failed', error)
        }
    })
}

/** `listener({ type: 'begin' | 'end', move })`; `move.ids` holds the task and its subtask ids. */
export const subscribeLocalTaskProjectMoves = listener => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const isServerMoveOutPending = (projectId, taskData, now = Date.now()) => {
    const projectMove = taskData?.projectMove
    if (!projectMove || projectMove.status !== 'moving') return false
    if (projectMove.sourceProjectId !== projectId) return false
    const requestedAt = Number(projectMove.requestedAt) || 0
    return now - requestedAt < SERVER_MOVE_MARKER_HIDE_WINDOW_MS
}

/**
 * Is this task document, read from project `projectId`, on its way out of that project?
 * The destination copy carries the same `projectMove` while the move runs, but its
 * `sourceProjectId` is the other project, so it is never hidden in its new home.
 */
export const isTaskMovingOutOfProject = (projectId, taskId, taskData) => {
    if (!projectId || !taskId) return false
    const localMove = movesByTaskId.get(taskId)
    if (localMove && localMove.sourceProjectId === projectId) return true
    return isServerMoveOutPending(projectId, taskData)
}

/** The destination copy while the move is still running: shown, but not yet a real task. */
export const isIncomingTaskProjectMovePending = (task, projectId) =>
    task?.projectMove?.status === 'moving' && !!projectId && task.projectMove.targetProjectId === projectId

export const beginLocalTaskProjectMove = ({ sourceProjectId, targetProjectId, taskId, subtaskIds = [] }) => {
    const move = {
        sourceProjectId,
        targetProjectId,
        taskId,
        ids: [taskId, ...(Array.isArray(subtaskIds) ? subtaskIds : [])].filter(Boolean),
        ended: false,
        timer: null,
    }
    move.ids.forEach(id => movesByTaskId.set(id, move))
    move.timer = setTimeout(() => endLocalTaskProjectMove(move), LOCAL_TASK_PROJECT_MOVE_TIMEOUT_MS)
    notify({ type: 'begin', move })
    return move
}

export const endLocalTaskProjectMove = move => {
    if (!move || move.ended) return
    move.ended = true
    clearTimeout(move.timer)
    move.ids.forEach(id => {
        if (movesByTaskId.get(id) === move) movesByTaskId.delete(id)
    })
    notify({ type: 'end', move })
}

/**
 * The destination document as the worker's `prepareManualTaskMove` writes it for the root task.
 * Keep the two in step: anything this gets wrong is visible only until the real document lands,
 * but a field that decides list membership (`currentReviewerId`, `isPublicFor`, `inDone`) puts
 * the row in the wrong list for that time.
 */
export const buildOptimisticMovedTaskDoc = (task, { sourceProjectId, targetProject, actorId, timestamp }) => {
    const targetMembers = new Set(targetProject?.userIds || [])
    const originalOwnerId = task.userId
    const ownerId =
        task.suggestedBy || (!targetMembers.has(originalOwnerId) && originalOwnerId !== DEFAULT_WORKSTREAM_ID)
            ? actorId
            : originalOwnerId
    const isPublicFor = Array.isArray(task.isPublicFor) ? [...task.isPublicFor] : [0, originalOwnerId]
    if (!isPublicFor.includes(0) && !isPublicFor.includes(ownerId) && !String(ownerId).startsWith('ws@')) {
        isPublicFor.push(ownerId)
    }

    const movedTask = {
        ...task,
        userId: ownerId,
        userIds: [ownerId],
        currentReviewerId: task.done ? DONE_STEP : ownerId,
        stepHistory: [OPEN_STEP],
        observersIds: [],
        dueDateByObserversIds: {},
        estimationsByObserverIds: {},
        parentGoalId: null,
        parentGoalIsPublicFor: null,
        lockKey: '',
        goalSuggestion: null,
        isPublicFor,
        sortIndex: timestamp,
        lastEditionDate: timestamp,
        lastEditorId: actorId,
        movingToOtherProjectId: null,
        projectMove: {
            sourceProjectId,
            targetProjectId: targetProject.id,
            requestedByUserId: actorId,
            requestedAt: timestamp,
            status: 'moving',
        },
    }
    if (task.suggestedBy) movedTask.suggestedBy = null
    if (movedTask.parentId) {
        movedTask.parentId = null
        movedTask.isSubtask = false
        movedTask.parentDone = false
        movedTask.inDone = !!movedTask.done
    }
    return movedTask
}

/** Test-only: the registry is module state. */
export const resetLocalTaskProjectMoves = () => {
    Array.from(new Set(movesByTaskId.values())).forEach(move => clearTimeout(move.timer))
    movesByTaskId.clear()
    listeners.clear()
}
