import { DONE_STEP } from '../TaskListView/Utils/TasksHelper'
import { FORDWARD_COMMENT } from '../Feeds/Utils/HelperFunctions'
import { getTaskBypassingWorkflow } from '../WorkflowModal/workflowBypass'
import { moveTasksFromOpen, updateSubtasksState, updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'

export const userHasWorkflowInProject = (user, projectId) => Object.keys(user?.workflow?.[projectId] || {}).length > 0

// A suggested task can only "bypass" something when the accepting user actually has a
// workflow configured in the project. Without one, the regular next step already is Done.
export const canBypassSuggestedTaskWorkflow = (user, projectId) => userHasWorkflowInProject(user, projectId)

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
