import { RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'

export function getCurrentUserTaskRecurrence(task, currentUserId) {
    const recurrenceByUser = task?.recurrenceByUser
    if (
        currentUserId &&
        recurrenceByUser &&
        typeof recurrenceByUser === 'object' &&
        Object.prototype.hasOwnProperty.call(recurrenceByUser, currentUserId)
    ) {
        return recurrenceByUser[currentUserId] || RECURRENCE_NEVER
    }

    return task?.recurrence || RECURRENCE_NEVER
}
