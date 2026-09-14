import { getDb } from './firestore'
import { runHttpsCallableFunction } from './firestore'

const PROJECT_MOVE_PATHS = {
    task: (projectId, objectId) => `items/${projectId}/tasks/${objectId}`,
    note: (projectId, objectId) => `noteItems/${projectId}/notes/${objectId}`,
    goal: (projectId, objectId) => `goals/${projectId}/items/${objectId}`,
    contact: (projectId, objectId) => `projectsContacts/${projectId}/contacts/${objectId}`,
    chat: (projectId, objectId) => `chatObjects/${projectId}/chats/${objectId}`,
    skill: (projectId, objectId) => `skills/${projectId}/items/${objectId}`,
}

export function queueObjectProjectMove(sourceProjectId, targetProjectId, objectType, objectId) {
    return runHttpsCallableFunction('moveObjectToProjectSecondGen', {
        sourceProjectId,
        targetProjectId,
        objectType,
        objectId,
    })
}

export function waitForProjectMoveCompletion(
    sourceProjectId,
    targetProjectId,
    objectType,
    objectId,
    timeoutMs = 300000
) {
    const buildPath = PROJECT_MOVE_PATHS[objectType]
    if (!buildPath) return Promise.reject(new Error(`Unsupported project move type: ${objectType}`))

    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs
        const checkMove = async () => {
            const [sourceResult, targetResult] = await Promise.allSettled([
                getDb().doc(buildPath(sourceProjectId, objectId)).get(),
                getDb().doc(buildPath(targetProjectId, objectId)).get(),
            ])
            const sourceData = sourceResult.status === 'fulfilled' ? sourceResult.value.data() : null
            const targetSnapshot = targetResult.status === 'fulfilled' ? targetResult.value : null
            const targetData = targetSnapshot?.exists ? targetSnapshot.data() || {} : null
            if (sourceData?.projectMove?.status === 'failed' || targetData?.projectMove?.status === 'failed') {
                reject(new Error(`The ${objectType} move failed`))
                return
            }
            if (targetData?.projectMove?.status === 'completed') {
                resolve({ id: objectId, ...targetData })
                return
            }
            if (Date.now() >= deadline) {
                reject(new Error(`Timed out waiting for ${objectType} ${objectId} to move`))
                return
            }
            // A destination document can briefly exist before its access projection
            // trigger has populated readerIds. Firestore reports that window as a
            // permanent permission-denied to a listener, so use fresh reads until the
            // projection (or the timeout) settles instead of failing the move UI.
            setTimeout(checkMove, 1000)
        }
        checkMove()
    })
}
