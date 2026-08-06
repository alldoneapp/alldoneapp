import { nextStepSuggestedTask, updateSuggestedTask } from './backends/Tasks/tasksFirestore'
import { getWorkflowStepsIdsSorted } from './HelperFunctions'
import { collectSuggestedTasks, resolveSuggestedRejectionStepId } from './suggestedTaskFlow'

// Bulk accept/reject for a whole "Suggested by X" section (AT-2173).
//
// Both helpers deliberately reuse the exact single-task backend calls from SuggestedModal instead
// of writing their own Firestore payloads, so a suggestion accepted/rejected in bulk is
// indistinguishable from one handled through the per-task popup:
//   accept -> updateSuggestedTask(..., { suggestedBy: null })   (assignee + estimation stay as suggested)
//   reject -> nextStepSuggestedTask(...)                        (assistant suggestions go back to the assistant)

export const acceptAllSuggestedTasks = ({ projectId, tasks }) => {
    const suggestedTasks = Array.isArray(tasks) ? tasks.filter(task => task?.id) : []

    suggestedTasks.forEach(task => {
        updateSuggestedTask(projectId, task.id, { suggestedBy: null })
    })

    return suggestedTasks.length
}

export const rejectAllSuggestedTasks = async ({ projectId, tasks, workflow }) => {
    const suggestedTasks = Array.isArray(tasks) ? tasks.filter(task => task?.id) : []
    const stepId = resolveSuggestedRejectionStepId(workflow, getWorkflowStepsIdsSorted)

    // Sequential on purpose: nextStepSuggestedTask moves tasks out of the open list and
    // recalculates ordering/focus, so parallel rejections race each other.
    for (const task of suggestedTasks) {
        await nextStepSuggestedTask(projectId, stepId, task, task.estimations, '', null)
    }

    return suggestedTasks.length
}

export const getSuggestedTasksForBulkAction = collectSuggestedTasks
