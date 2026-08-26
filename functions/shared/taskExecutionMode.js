const TASK_EXECUTION_MODE_WORKFLOW = 'workflow'
const TASK_EXECUTION_MODE_DIRECT = 'direct'
const ASSISTANT_WORKFLOW_FIRST_STEP_ID = 'assistant-start'

const getTaskExecutionMode = (task, legacyDefault = TASK_EXECUTION_MODE_WORKFLOW) => {
    return task?.executionMode === TASK_EXECUTION_MODE_DIRECT || task?.executionMode === TASK_EXECUTION_MODE_WORKFLOW
        ? task.executionMode
        : legacyDefault
}

const taskBypassesWorkflow = (task, legacyDefault = TASK_EXECUTION_MODE_WORKFLOW) =>
    getTaskExecutionMode(task, legacyDefault) === TASK_EXECUTION_MODE_DIRECT

const resolveAssistantWorkflowExecutionMode = (assistant, projectId, requestedExecutionMode) => {
    if (requestedExecutionMode !== TASK_EXECUTION_MODE_WORKFLOW) return requestedExecutionMode

    const firstStep = assistant?.workflow?.[projectId]?.[ASSISTANT_WORKFLOW_FIRST_STEP_ID]
    return firstStep?.reviewerType === 'assistant' && firstStep?.reviewerUid
        ? TASK_EXECUTION_MODE_WORKFLOW
        : TASK_EXECUTION_MODE_DIRECT
}

module.exports = {
    TASK_EXECUTION_MODE_WORKFLOW,
    TASK_EXECUTION_MODE_DIRECT,
    getTaskExecutionMode,
    resolveAssistantWorkflowExecutionMode,
    taskBypassesWorkflow,
}
