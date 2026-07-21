import { DONE_STEP, OPEN_STEP } from '../../../components/TaskListView/Utils/TasksHelper'
import { chronoEntriesOrder } from '../../HelperFunctions'

// Direction reported when neither the target nor the current step can be located in the
// workflow, e.g. because the step was deleted while a task still referenced it. Consumers
// render this as a plain `isForward ? 'forward' : 'backward'`, so it has to stay a boolean.
// `true` matches getCommentDirectionWhenMoveTaskInTheWorklfow, which also reports a move as
// forward when the current step is missing from the workflow.
export const DEFAULT_IS_FORWARD = true

export function getStepWorkflowDirection(targetStepId, task, workflow) {
    let isForward = null

    if (targetStepId === 'open') {
        isForward = false
    } else if (targetStepId === 'done') {
        isForward = true
    }

    const stepHistory = task && task.stepHistory ? task.stepHistory : []
    const currentStepId = stepHistory[stepHistory.length - 1]

    if (currentStepId === OPEN_STEP) {
        isForward = true
    } else if (currentStepId === DONE_STEP) {
        isForward = false
    } else if (isForward === null) {
        const workflowEntries = Object.entries(workflow || {}).sort(chronoEntriesOrder)
        for (let i = 0; i < workflowEntries.length; i++) {
            if (workflowEntries[i][0] === targetStepId) {
                isForward = false
                break
            } else if (workflowEntries[i][0] === currentStepId) {
                isForward = true
                break
            }
        }
    }

    return isForward === null ? DEFAULT_IS_FORWARD : isForward
}
