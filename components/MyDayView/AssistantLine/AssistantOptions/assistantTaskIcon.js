const TASK_TYPE_PROMPT = 'prompt'
const RECURRENCE_NEVER = 'never'

export const isScheduledAssistantTask = task => {
    const recurrenceByUser = task?.recurrenceByUser || {}
    const hasScheduledUser = Object.values(recurrenceByUser).some(
        recurrence => recurrence && recurrence !== RECURRENCE_NEVER
    )

    return hasScheduledUser || (!!task?.recurrence && task.recurrence !== RECURRENCE_NEVER)
}

export const getAssistantTaskIcon = task => {
    if (isScheduledAssistantTask(task)) return 'clock'
    return task?.type === TASK_TYPE_PROMPT ? 'message-square' : 'bookmark'
}
