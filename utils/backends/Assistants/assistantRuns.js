import { runHttpsCallableFunction } from '../firestore'

export function cancelAssistantRun({ projectId, objectType, objectId, commentId, runKind, runId }) {
    return runHttpsCallableFunction('cancelAssistantRunSecondGen', {
        projectId,
        objectType,
        objectId,
        commentId,
        runKind,
        runId,
    })
}

export function respondToVmInteraction({ projectId, objectType, objectId, commentId, runId, requestId, response }) {
    return runHttpsCallableFunction('respondToVmInteractionSecondGen', {
        projectId,
        objectType,
        objectId,
        commentId,
        runId,
        requestId,
        response,
    })
}
