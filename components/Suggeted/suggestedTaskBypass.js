import { DONE_STEP } from '../TaskListView/Utils/TasksHelper'
import { FORDWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { getTaskBypassingWorkflow } from '../WorkflowModal/workflowBypass'
import { moveTasksFromOpen, updateSubtasksState, updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'
import { isAssistantSuggestedTask } from '../../utils/suggestedTaskFlow'

export const BYPASS_WORKFLOW_LABEL = 'Bypass workflow'
export const ACCEPT_AND_DONE_LABEL = 'Accept and mark done'

export const userHasWorkflowInProject = (user, projectId) => Object.keys(user?.workflow?.[projectId] || {}).length > 0

// When is a direct route to Done needed in the suggested task popup?
//
// - A human suggestion offers "Go to next step". With a workflow that lands in the first
//   workflow step, so the bypass is what skips it. Without a workflow that action already
//   moves the task to Done, so there is nothing to bypass and the link stays hidden.
// - An assistant suggestion (for example a Gmail follow-up task) offers "Reject" instead.
//   That is not a "next step" at all: `nextStepSuggestedTask` short-circuits into
//   `getAssistantSuggestedTaskRejection` and hands the task back to the assistant. So neither
//   button ever completes the task for the accepting user, with or without a workflow, and
//   the bypass has to be offered unconditionally.
export const canBypassSuggestedTaskWorkflow = (user, projectId, task) =>
    isAssistantSuggestedTask(task) || userHasWorkflowInProject(user, projectId)

// "Bypass workflow" only describes what happens when there actually is a workflow to skip.
// For an assistant suggestion in a project without one, the link simply accepts the task and
// completes it, so it is labelled accordingly.
export const getSuggestedTaskBypassLabel = (user, projectId) =>
    userHasWorkflowInProject(user, projectId) ? BYPASS_WORKFLOW_LABEL : ACCEPT_AND_DONE_LABEL

// Accepts the suggestion (clears `suggestedBy`, like the regular next-step action does) and
// moves the task straight to Done, skipping every workflow step of the accepting user.
export const moveSuggestedTaskToDoneBypassingWorkflow = ({ projectId, task, estimations, comment, checkBoxId }) => {
    const updateData = { suggestedBy: null }
    updateTaskData(projectId, task.id, updateData, null)
    updateSubtasksState(projectId, task.subtaskIds, updateData, null)

    return moveTasksFromOpen(
        projectId,
        getTaskBypassingWorkflow(task),
        DONE_STEP,
        comment,
        FORDWARD_COMMENT,
        estimations,
        checkBoxId
    )
}
