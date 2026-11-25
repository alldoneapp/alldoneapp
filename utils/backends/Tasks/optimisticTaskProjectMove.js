import { getDb } from '../firestore'
import { publishOptimisticTaskCreated, publishOptimisticTaskCreateFailed } from './optimisticTaskCreate'
import { settleOptimisticTaskRow } from './optimisticTaskSettlement'
import {
    beginLocalTaskProjectMove,
    buildOptimisticMovedTaskDoc,
    endLocalTaskProjectMove,
} from './localTaskProjectMoves'

/**
 * AT-3156 - a task moved to another project leaves its list and shows up in the destination
 * the moment the user picks the project, not when the server has finished.
 *
 * A manual project move is done by a Cloud Tasks worker (AT-2572): the callable
 * `moveObjectToProjectSecondGen` marks the source document and enqueues the worker, which
 * creates the destination copy and deletes the source. On a warm server that takes a few
 * seconds; on a cold start it took over two minutes (2026-11-25: 79s for the callable's
 * preflight alone, then 48s for the worker). The row stayed in the source list for all of
 * it, and the client SDK gave up on the callable after its 70s default and reported "No
 * changes were made" for a move the server then completed.
 *
 * So the client now shows the outcome first and lets the server catch up:
 *
 *  - SOURCE: `beginLocalTaskProjectMove` registers the task (and its subtasks) as moving out of
 *    the source project. The task watchers ask `isTaskMovingOutOfProject` for every document
 *    they would render and drop the row at once; the same check hides the row while the
 *    server's own marker (`projectMove.status === 'moving'` on the source document) is there,
 *    so a second tab or a later snapshot cannot bring it back mid-move.
 *  - DESTINATION: the task is published on the AT-2342 optimistic-create bus for the target
 *    project, shaped the way `prepareManualTaskMove` (functions/shared/moveTaskToDifferentProject.js)
 *    will write it. Every live list of that project inserts it through its normal pipeline,
 *    with the move spinner, and the real document replaces it when it arrives.
 *  - OUTCOME: a definite failure rolls both back (the source row returns, the destination copy
 *    goes); completion settles the destination row against the real document.
 *
 * Nothing here writes to Firestore. The server stays the only writer of the move.
 */

const readSourceTask = async (projectId, taskId) => {
    try {
        const snapshot = await getDb().doc(`items/${projectId}/tasks/${taskId}`).get({ source: 'cache' })
        return snapshot?.exists ? snapshot.data() : null
    } catch (error) {
        return null
    }
}

/**
 * Starts the visible half of a task move. Returns `complete()` for a move the server finished and
 * `rollback()` for one that will not happen; both are idempotent and the first call wins.
 *
 * `task` is the row the user acted on. The destination copy is built from the cached raw document
 * when there is one (the watchers' pipelines map raw documents themselves), else from that row.
 */
export const startOptimisticTaskProjectMove = ({ sourceProjectId, targetProject, task, actorId }) => {
    const taskId = task?.id
    const targetProjectId = targetProject?.id
    if (!sourceProjectId || !targetProjectId || !taskId || sourceProjectId === targetProjectId) {
        return { complete: () => {}, rollback: () => {} }
    }

    const move = beginLocalTaskProjectMove({
        sourceProjectId,
        targetProjectId,
        taskId,
        subtaskIds: task.subtaskIds,
    })
    let settled = false
    let publishedDoc = null

    readSourceTask(sourceProjectId, taskId).then(rawTask => {
        if (settled) return
        publishedDoc = buildOptimisticMovedTaskDoc(rawTask || task, {
            sourceProjectId,
            targetProject,
            actorId,
            timestamp: Date.now(),
        })
        publishOptimisticTaskCreated(targetProjectId, taskId, publishedDoc)
    })

    return {
        complete: () => {
            if (settled) return
            settled = true
            // The destination lists re-check their optimistic row against the real document and
            // keep or drop it; the source rows stay away because the source document is gone.
            if (publishedDoc) settleOptimisticTaskRow(targetProjectId, taskId)
            endLocalTaskProjectMove(move)
        },
        rollback: () => {
            if (settled) return
            settled = true
            if (publishedDoc) publishOptimisticTaskCreateFailed(targetProjectId, taskId, publishedDoc)
            endLocalTaskProjectMove(move)
        },
    }
}

/**
 * Callable failures that do not prove the server did nothing: the SDK's own deadline (it does not
 * cancel the request, so the server may still run it), a dropped connection, a 5xx.
 */
const AMBIGUOUS_CALLABLE_CODES = new Set([
    'deadline-exceeded',
    'functions/deadline-exceeded',
    'internal',
    'functions/internal',
    'unavailable',
    'functions/unavailable',
    'unknown',
    'functions/unknown',
])

export const isAmbiguousCallableFailure = error => AMBIGUOUS_CALLABLE_CODES.has(error?.code)

/**
 * After an ambiguous callable failure: did the server accept the move anyway? The callable marks
 * the source before it returns, and clears the mark (status `failed`) when it cannot enqueue, so
 * the source document answers it. `null` means the read itself failed.
 */
export const didServerAcceptTaskMove = async (sourceProjectId, targetProjectId, taskId) => {
    try {
        const snapshot = await getDb().doc(`items/${sourceProjectId}/tasks/${taskId}`).get({ source: 'server' })
        if (!snapshot.exists) return true
        const projectMove = snapshot.data()?.projectMove
        return projectMove?.status === 'moving' && projectMove.targetProjectId === targetProjectId
    } catch (error) {
        return null
    }
}
