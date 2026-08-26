const TASK_EXECUTION_MODE_WORKFLOW = 'workflow'
const TASK_EXECUTION_MODE_DIRECT = 'direct'

const getTaskExecutionMode = (task, legacyDefault = TASK_EXECUTION_MODE_WORKFLOW) => {
    return task?.executionMode === TASK_EXECUTION_MODE_DIRECT || task?.executionMode === TASK_EXECUTION_MODE_WORKFLOW
        ? task.executionMode
        : legacyDefault
}

const taskBypassesWorkflow = (task, legacyDefault = TASK_EXECUTION_MODE_WORKFLOW) =>
    getTaskExecutionMode(task, legacyDefault) === TASK_EXECUTION_MODE_DIRECT

module.exports = {
    TASK_EXECUTION_MODE_WORKFLOW,
    TASK_EXECUTION_MODE_DIRECT,
    getTaskExecutionMode,
    taskBypassesWorkflow,
}
