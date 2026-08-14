import { DONE_STEP } from '../TaskListView/Utils/TasksHelper'
import { moveTasksFromMiddleOfWorkflow, moveTasksFromOpen } from '../../utils/backends/Tasks/tasksFirestore'
import { TASK_EXECUTION_MODE_DIRECT } from '../../utils/taskExecutionMode'

export const getTaskBypassingWorkflow = task => ({
    ...task,
    executionMode: TASK_EXECUTION_MODE_DIRECT,
})

export const moveTaskToDoneBypassingWorkflow = ({
    projectId,
    task,
    comment,
    commentType,
    estimations,
    checkBoxId,
    recurrenceBaseDateOverride,
}) => {
    const bypassingTask = getTaskBypassingWorkflow(task)

    return task.userIds.length === 1
        ? moveTasksFromOpen(
              projectId,
              bypassingTask,
              DONE_STEP,
              comment,
              commentType,
              estimations,
              checkBoxId,
              recurrenceBaseDateOverride
          )
        : moveTasksFromMiddleOfWorkflow(
              projectId,
              bypassingTask,
              DONE_STEP,
              comment,
              commentType,
              estimations,
              checkBoxId
          )
}
