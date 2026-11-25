import { getDb } from './firestore'
import { runHttpsCallableFunction } from './firestore'
import { beginLocalContactMove, finishLocalContactMove } from '../projectMoveState'

const PROJECT_MOVE_PATHS = {
    task: (projectId, objectId) => `items/${projectId}/tasks/${objectId}`,
    note: (projectId, objectId) => `noteItems/${projectId}/notes/${objectId}`,
    goal: (projectId, objectId) => `goals/${projectId}/items/${objectId}`,
    contact: (projectId, objectId) => `projectsContacts/${projectId}/contacts/${objectId}`,
    chat: (projectId, objectId) => `chatObjects/${projectId}/chats/${objectId}`,
    skill: (projectId, objectId) => `skills/${projectId}/items/${objectId}`,
}

/**
 * AT-3156: the SDK's 70s default is shorter than a cold start of this callable (79s for the CORS
 * preflight alone on 2026-11-25). The SDK does not cancel the request when its timer fires, so the
 * server went on to enqueue and complete a move the client had already reported as failed.
 */
export const PROJECT_MOVE_CALLABLE_TIMEOUT_MS = 5 * 60 * 1000

export function queueObjectProjectMove(sourceProjectId, targetProjectId, objectType, objectId) {
    const finishLocalMove = objectType === 'contact' ? beginLocalContactMove(sourceProjectId, objectId) : () => {}
    try {
        return Promise.resolve(
            runHttpsCallableFunction(
                'moveObjectToProjectSecondGen',
                {
                    sourceProjectId,
                    targetProjectId,
                    objectType,
                    objectId,
                },
                { timeout: PROJECT_MOVE_CALLABLE_TIMEOUT_MS }
            )
        ).catch(error => {
            finishLocalMove()
            throw error
        })
    } catch (error) {
        finishLocalMove()
        throw error
    }
}

export function waitForProjectMoveCompletion(
    sourceProjectId,
    targetProjectId,
    objectType,
    objectId,
    timeoutMs = 300000,
    { isCancelled = () => false } = {}
) {
    const buildPath = PROJECT_MOVE_PATHS[objectType]
    if (!buildPath) return Promise.reject(new Error(`Unsupported project move type: ${objectType}`))

    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs
        const checkMove = async () => {
            if (isCancelled()) {
                const cancelled = new Error(`Stopped waiting for the ${objectType} move`)
                cancelled.code = 'cancelled'
                reject(cancelled)
                return
            }
            const [sourceResult, targetResult] = await Promise.allSettled([
                getDb().doc(buildPath(sourceProjectId, objectId)).get(),
                getDb().doc(buildPath(targetProjectId, objectId)).get(),
            ])
            const sourceData = sourceResult.status === 'fulfilled' ? sourceResult.value.data() : null
            const targetSnapshot = targetResult.status === 'fulfilled' ? targetResult.value : null
            const targetData = targetSnapshot?.exists ? targetSnapshot.data() || {} : null
            if (sourceData?.projectMove?.status === 'failed' || targetData?.projectMove?.status === 'failed') {
                const failed = new Error(`The ${objectType} move failed`)
                failed.code = 'move-failed'
                reject(failed)
                return
            }
            if (targetData?.projectMove?.status === 'completed') {
                resolve({ id: objectId, ...targetData })
                return
            }
            if (Date.now() >= deadline) {
                const timedOut = new Error(`Timed out waiting for ${objectType} ${objectId} to move`)
                timedOut.code = 'move-timeout'
                reject(timedOut)
                return
            }
            // A destination document can briefly exist before its access projection
            // trigger has populated readerIds. Firestore reports that window as a
            // permanent permission-denied to a listener, so use fresh reads until the
            // projection (or the timeout) settles instead of failing the move UI.
            setTimeout(checkMove, 1000)
        }
        checkMove()
    }).finally(() => {
        if (objectType === 'contact') finishLocalContactMove(sourceProjectId, objectId)
    })
}
