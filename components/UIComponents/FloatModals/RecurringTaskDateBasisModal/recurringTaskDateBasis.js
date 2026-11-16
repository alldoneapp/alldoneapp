import moment from 'moment'

import { createRecurrenceSchedule } from '../../../../functions/shared/recurrenceSchedule'

/**
 * AT-2803 - from which date is the next occurrence of a recurring task counted?
 *
 * A recurring task can carry two dates: `dueDate` (where it is scheduled now) and
 * `recurrenceOriginalDueDate` (where it was planned before its first postponement, see
 * `getRecurrenceOriginalDueDateUpdate` in tasksFirestore.js). Completing it asks which date the
 * interval is added to:
 *
 * - `original`  - the originally planned date, so the series keeps its rhythm;
 * - `scheduled` - the current (postponed or overdue) due date;
 * - `today`     - the completion date, which is what every completion without the popup does.
 *
 * The question is only asked when the answer can matter: the task was postponed to another day or
 * is overdue. Ticking off a task on its planned day, or early, keeps the old silent behaviour.
 * Options that name the same calendar day are merged, because they produce the same occurrence.
 *
 * The chosen day is sent as LOCAL NOON (`toRecurrenceBaseDate`): the Cloud Function reads the
 * base day in the user's timezone when it knows it, and noon names the same calendar day in UTC
 * for every offset between -11 and +11 hours when it does not. Its time of day is irrelevant, the
 * next occurrence takes its time from the task's `startTime`. When base + interval is not after
 * the completion the server skips ahead on the same cadence (`calculateNextRecurrenceDate`).
 *
 * AT-3049: each row previews the NEXT occurrence its base date produces, computed with the same
 * `computeNextRecurrence` the Cloud Function uses (functions/shared/recurrenceSchedule.js).
 *
 * Constants are inlined on purpose: TasksHelper pulls in the store and the backend, and this
 * module must stay a cheap leaf that the completion paths and their tests can import.
 */

const RECURRENCE_NEVER = 'never' // TasksHelper.RECURRENCE_NEVER
const TASK_ASSIGNEE_ASSISTANT_TYPE = 'ASSISTANT' // TasksHelper.TASK_ASSIGNEE_ASSISTANT_TYPE
const SOMEDAY_DATE = Number.MAX_SAFE_INTEGER // TasksHelper.BACKLOG_DATE_NUMERIC

export const RECURRENCE_BASIS_ORIGINAL = 'original'
export const RECURRENCE_BASIS_SCHEDULED = 'scheduled'
export const RECURRENCE_BASIS_TODAY = 'today'

export const getTaskRecurrenceValue = task => {
    const recurrence = task?.recurrence
    return recurrence && typeof recurrence === 'object' ? recurrence.type : recurrence
}

export const isCalendarDate = value =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value < SOMEDAY_DATE

const isSameLocalDay = (a, b) => moment(a).isSame(moment(b), 'day')

const isEligibleRecurringTask = task => {
    const recurrence = getTaskRecurrenceValue(task)
    return (
        !!task &&
        !task.done &&
        !task.parentId &&
        // Client and scheduler use different casing for the assistant assignee type.
        String(task.assigneeType || '').toUpperCase() !== TASK_ASSIGNEE_ASSISTANT_TYPE &&
        !!recurrence &&
        recurrence !== RECURRENCE_NEVER &&
        Array.isArray(task.userIds) &&
        task.userIds.length === 1
    )
}

/** Postponed to a different day (or to Someday) and not moved back to the planned day. */
export const wasRecurringTaskPostponed = task =>
    isCalendarDate(task?.recurrenceOriginalDueDate) &&
    (!isCalendarDate(task.dueDate) || !isSameLocalDay(task.recurrenceOriginalDueDate, task.dueDate))

/** Due on a day before today. Someday is never overdue. */
export const isRecurringTaskOverdue = (task, now = Date.now()) =>
    isCalendarDate(task?.dueDate) && moment(task.dueDate).isBefore(moment(now).startOf('day'))

export const getRecurrenceDateBasisOptions = (task, now = Date.now()) => {
    const candidates = [
        wasRecurringTaskPostponed(task) && { key: RECURRENCE_BASIS_ORIGINAL, date: task.recurrenceOriginalDueDate },
        isCalendarDate(task?.dueDate) && { key: RECURRENCE_BASIS_SCHEDULED, date: task.dueDate },
        { key: RECURRENCE_BASIS_TODAY, date: now },
    ].filter(Boolean)

    return candidates.filter(
        (option, index) => !candidates.slice(0, index).some(previous => isSameLocalDay(previous.date, option.date))
    )
}

export const shouldShowRecurringTaskDateBasisModal = (task, now = Date.now()) =>
    isEligibleRecurringTask(task) &&
    (wasRecurringTaskPostponed(task) || isRecurringTaskOverdue(task, now)) &&
    getRecurrenceDateBasisOptions(task, now).length > 1

/** The local calendar day of `timestamp`, as a timestamp at local noon. */
export const toRecurrenceBaseDate = timestamp => moment(timestamp).hour(12).minute(0).second(0).millisecond(0).valueOf()

// The Cloud Function runs in UTC: it reads the base day in the assignee's timezone, then puts the
// task's time on it in UTC. A UTC moment plus the browser's offset reproduces that exactly, so the
// preview names the day the created task will show, also near midnight and for a late start time.
const { computeNextRecurrence } = createRecurrenceSchedule(moment.utc)

/**
 * AT-3049: the next occurrence the server creates when the task is completed at `now` with
 * `baseDate` as the chosen base (a timestamp), or null when the recurrence is unknown. Same code as
 * `calculateNextRecurrenceDate`; the browser's timezone stands in for the assignee's stored one,
 * which is the same zone for the person completing their own task. `utcOffsetMinutes` overrides the
 * browser's offset (tests).
 */
export const getNextRecurrenceDatePreview = (task, baseDate, now = Date.now(), utcOffsetMinutes) => {
    if (!task || !isCalendarDate(baseDate)) return null
    const recurrenceBaseDateOverride = toRecurrenceBaseDate(baseDate)
    const offset =
        typeof utcOffsetMinutes === 'number' ? utcOffsetMinutes : moment(recurrenceBaseDateOverride).utcOffset()
    const { nextDate } = computeNextRecurrence(
        { ...task, recurrence: getTaskRecurrenceValue(task), recurrenceBaseDateOverride, completed: now },
        now,
        { utcOffsetMinutes: offset }
    )
    return nextDate ? nextDate.valueOf() : null
}
