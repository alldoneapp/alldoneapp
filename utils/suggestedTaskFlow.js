const ASSISTANT_ASSIGNEE_TYPE = 'ASSISTANT'
const DONE_STEP = -2
const STAYWARD_COMMENT = 'STAYWARD_COMMENT'

export const isAssistantSuggestedTask = task =>
    !!task?.suggestedBy &&
    (task.suggestedBy === task?.taskMetadata?.assistantSuggestion?.assistantId ||
        task.suggestedBy === task?.assistantId)

export const getSuggestedById = task =>
    task?.suggestedBy || task?.taskMetadata?.assistantSuggestion?.assistantId || task?.creatorId || ''

export const resolveSuggestedByIdentity = ({ task, suggestedById, user, contact, assistant }) => {
    const id = suggestedById || getSuggestedById(task)

    return {
        id,
        identity: user || contact || assistant || null,
        isAssistant:
            !!assistant ||
            (!!id &&
                (id === task?.taskMetadata?.assistantSuggestion?.assistantId ||
                    (!!task?.assistantId && id === task.assistantId && task?.suggestedBy === id))),
    }
}

export const buildRejectedAssistantSuggestedTask = task => {
    if (!isAssistantSuggestedTask(task)) return null
    const assistantId = task.taskMetadata?.assistantSuggestion?.assistantId || task.assistantId

    return {
        ...task,
        userId: assistantId,
        userIds: [assistantId],
        currentReviewerId: assistantId,
        assigneeType: ASSISTANT_ASSIGNEE_TYPE,
        assistantId,
    }
}

export const getAssistantSuggestedTaskRejection = task => {
    const rejectedTask = buildRejectedAssistantSuggestedTask(task)
    if (!rejectedTask) return null

    return {
        task: rejectedTask,
        targetStepId: DONE_STEP,
        commentType: STAYWARD_COMMENT,
    }
}
