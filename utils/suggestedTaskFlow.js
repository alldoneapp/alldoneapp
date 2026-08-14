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

// Flattens the `[goalId, tasks]` groups a "Suggested by" section renders into the plain task
// list a bulk accept/reject operates on. Tasks suggested by somebody else are filtered out so a
// bulk action can never reach beyond the section the user actually pressed the button in.
export const collectSuggestedTasks = (taskByGoalsList, suggestedById) => {
    if (!Array.isArray(taskByGoalsList)) return []

    const tasks = []
    const seenIds = new Set()

    taskByGoalsList.forEach(goalTasksData => {
        const goalTasks = Array.isArray(goalTasksData) ? goalTasksData[1] : goalTasksData
        if (!Array.isArray(goalTasks)) return

        goalTasks.forEach(task => {
            if (!task?.id || seenIds.has(task.id)) return
            if (suggestedById && getSuggestedById(task) !== suggestedById) return

            seenIds.add(task.id)
            tasks.push(task)
        })
    })

    return tasks
}

// Mirrors SuggestedModal.onDonePress(false): a rejected suggestion enters the reviewer's first
// workflow step when they have a workflow in this project, and goes straight to Done otherwise.
export const resolveSuggestedRejectionStepId = (workflow, sortWorkflowStepIds) => {
    const steps = workflow && typeof workflow === 'object' ? workflow : {}
    if (Object.keys(steps).length === 0) return DONE_STEP

    const sortedStepIds = typeof sortWorkflowStepIds === 'function' ? sortWorkflowStepIds(steps) : Object.keys(steps)
    const firstStepId = Array.isArray(sortedStepIds) ? sortedStepIds[0] : undefined

    return firstStepId == null ? DONE_STEP : firstStepId
}
