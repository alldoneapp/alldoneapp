const ON_DEMAND_ASSISTANT_TASK_COMPLETION_MODE = 'server_on_success'
const ON_DEMAND_ASSISTANT_TASK_SOURCE = 'preconfigured_prompt'

function buildOnDemandAssistantTaskMetadata(taskMetadata = {}) {
    return {
        ...(taskMetadata || {}),
        assistantCompletion: {
            mode: ON_DEMAND_ASSISTANT_TASK_COMPLETION_MODE,
            source: ON_DEMAND_ASSISTANT_TASK_SOURCE,
        },
    }
}

function requestsOnDemandAssistantTaskCompletion(taskMetadata = {}) {
    return (
        taskMetadata?.assistantCompletion?.mode === ON_DEMAND_ASSISTANT_TASK_COMPLETION_MODE &&
        taskMetadata?.assistantCompletion?.source === ON_DEMAND_ASSISTANT_TASK_SOURCE
    )
}

function shouldUseClientTaskCompletionFallback(taskCompletion) {
    return taskCompletion?.status !== 'succeeded'
}

module.exports = {
    ON_DEMAND_ASSISTANT_TASK_COMPLETION_MODE,
    ON_DEMAND_ASSISTANT_TASK_SOURCE,
    buildOnDemandAssistantTaskMetadata,
    requestsOnDemandAssistantTaskCompletion,
    shouldUseClientTaskCompletionFallback,
}
