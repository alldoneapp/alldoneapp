'use strict'

/**
 * AT-2803 - the originally planned date of a recurring task.
 *
 * A recurring task carries two dates once it has been postponed: `dueDate` (where it is now) and
 * `recurrenceOriginalDueDate` (where it was planned before the FIRST postponement). Completing it
 * then asks whether the next occurrence should be counted from the planned date, the current one
 * or today. The original is written exactly once, on the first move to a LATER date, and is never
 * overwritten by a further postponement - otherwise "original" would only mean "the previous one".
 * Every occurrence starts without it: `recurringTasksCloud` deletes it from the clone.
 *
 * The web client (`utils/backends/Tasks/tasksFirestore.js`), the auto-postpone scheduler and the
 * project postpone service apply the same rule; this is the copy for the shared Functions
 * services (assistant and MCP `update_task`), which used to drop it.
 */

const RECURRENCE_NEVER = 'never'

const getTaskRecurrenceValue = task => {
    const recurrence = task?.recurrence
    return recurrence && typeof recurrence === 'object' ? recurrence.type : recurrence
}

const isRecurring = recurrence => !!recurrence && recurrence !== RECURRENCE_NEVER

/**
 * @param {object} task the task as stored before the update
 * @param {number} previousDueDate the stored dueDate
 * @param {number} nextDueDate the dueDate being written
 * @param {object} [options]
 * @param {boolean} [options.isObservedTask] observer due dates are not the task's schedule
 * @param {string} [options.recurrence] the recurrence after the update, if it changes too
 */
const shouldSaveRecurrenceOriginalDueDate = (task, previousDueDate, nextDueDate, options = {}) => {
    const recurrence = options.recurrence !== undefined ? options.recurrence : getTaskRecurrenceValue(task)
    const previous = Number(previousDueDate)
    const next = Number(nextDueDate)
    return (
        !options.isObservedTask &&
        isRecurring(recurrence) &&
        !task?.recurrenceOriginalDueDate &&
        previousDueDate !== null &&
        previousDueDate !== undefined &&
        nextDueDate !== null &&
        nextDueDate !== undefined &&
        Number.isFinite(previous) &&
        Number.isFinite(next) &&
        next > previous
    )
}

const getRecurrenceOriginalDueDateUpdate = (task, previousDueDate, nextDueDate, options = {}) =>
    shouldSaveRecurrenceOriginalDueDate(task, previousDueDate, nextDueDate, options)
        ? { recurrenceOriginalDueDate: Number(previousDueDate) }
        : {}

module.exports = {
    getTaskRecurrenceValue,
    shouldSaveRecurrenceOriginalDueDate,
    getRecurrenceOriginalDueDateUpdate,
}
