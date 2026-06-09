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
