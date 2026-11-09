import { runHttpsCallableFunction } from '../firestore'
import {
    SERVER_OWNED_ASSISTANT_TASK_FIELDS,
    computeAssistantTaskContentHash,
} from '../../../functions/Assistant/assistantTaskContentHash'

// Security audit 2026-11 (NEW-A): approvals of a task's content are written by the server only
// (firestore.rules refuse these fields from clients), so every client write of a task document
// leaves them out — including copies of a loaded document, which would otherwise carry a stale map.
export function stripServerOwnedAssistantTaskFields(task) {
    if (!task || typeof task !== 'object') return task
    const copy = { ...task }
    SERVER_OWNED_ASSISTANT_TASK_FIELDS.forEach(field => delete copy[field])
    return copy
}

// Records, for the signed-in user, that they approved exactly `expectedHash`.
export function approveAssistantTaskContent({ projectId, assistantId, taskId, expectedHash }) {
    return runHttpsCallableFunction('approveAssistantTaskContentSecondGen', {
        projectId,
        assistantId,
        taskId,
        expectedHash,
    })
}

export function approveAssistantTaskContentAsShown({ projectId, assistantId, task }) {
    return approveAssistantTaskContent({
        projectId,
        assistantId,
        taskId: task.id,
        expectedHash: computeAssistantTaskContentHash(task),
    })
}
