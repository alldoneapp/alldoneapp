const TASK_CREATION_FAILURE_MESSAGE = 'I could not create that task because of a technical issue. Please try again.'
const GENERIC_TOOL_FAILURE_MESSAGE = 'I could not complete that action because of a technical issue. Please try again.'

function getUserFacingToolErrorMessage(toolName, error) {
    const errorMessage = typeof error?.message === 'string' ? error.message.trim() : ''

    if (toolName === 'create_task') {
        return TASK_CREATION_FAILURE_MESSAGE
    }

    if (isTaskNotFoundError(errorMessage)) {
        return `I couldn't find a task matching that name. Please check the task name or tell me which project it's in.`
    }

    if (isTaskNameTooGenericError(errorMessage)) {
        return 'That task name is too generic to update safely. Please be more specific.'
    }

    return GENERIC_TOOL_FAILURE_MESSAGE
}

function isTaskNotFoundError(errorMessage) {
    return errorMessage.includes('No tasks found matching search criteria')
}

function isTaskNameTooGenericError(errorMessage) {
    return errorMessage.includes('is too generic. Please be more specific.')
}

module.exports = {
    TASK_CREATION_FAILURE_MESSAGE,
    GENERIC_TOOL_FAILURE_MESSAGE,
    getUserFacingToolErrorMessage,
    isTaskNotFoundError,
    isTaskNameTooGenericError,
}
