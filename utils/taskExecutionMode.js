export const TASK_EXECUTION_MODE_WORKFLOW = 'workflow'
export const TASK_EXECUTION_MODE_DIRECT = 'direct'

export const getTaskExecutionMode = (task, legacyDefault = TASK_EXECUTION_MODE_WORKFLOW) => {
    return task?.executionMode === TASK_EXECUTION_MODE_DIRECT || task?.executionMode === TASK_EXECUTION_MODE_WORKFLOW
        ? task.executionMode
        : legacyDefault
}

export const taskBypassesWorkflow = (task, legacyDefault = TASK_EXECUTION_MODE_WORKFLOW) =>
    getTaskExecutionMode(task, legacyDefault) === TASK_EXECUTION_MODE_DIRECT
