import moment from 'moment'

import Backend from '../../../../utils/BackendBridge'
import { setTaskDueDate } from '../../../../utils/backends/Tasks/tasksFirestore'
import { setSelectedTasks, setLastSelectedDueDate } from '../../../../redux/actions'

/**
 * The what-does-picking-a-day-mean decision tree of the due-date calendar,
 * extracted from Day.js (calendar-grids consolidation, MODAL_IMPROVEMENT_PLAN.md).
 * It used to run inside the day CELL — a day cell doing Firestore writes and
 * redux dispatches was what blocked sharing the grid. The cell is now
 * presentational and the modal calls this once per pick.
 *
 * Order matters and is preserved exactly:
 * 1. an explicit `saveDueDateBeforeSaveTask` callback wins (the DueDateModal
 *    wrappers and PreConfigTask flow),
 * 2. else a task: multi-select writes all selected tasks and clears the
 *    selection; a parent-goal reminder callback outranks the single-task
 *    Firestore write,
 * 3. else the goal-milestone callback.
 *
 * Returns true when the pick was applied (future-or-today), false for a past
 * day — the caller closes the popover only on true.
 */
export const applyDaySelection = ({ year, month, day }, context) => {
    const {
        dispatch,
        updateDate,
        saveDueDateBeforeSaveTask,
        task,
        tasks,
        multipleTasks,
        projectId,
        isObservedTabActive,
        updateGoalMilestone,
        updateParentGoalReminderDate,
    } = context

    const selectedDate = new Date(year, month - 1, day)
    const selectedMoment = moment(selectedDate)
    const dueDate = selectedDate.getTime()

    if (!selectedMoment.isSameOrAfter(moment(), 'day')) return false

    updateDate(dueDate)

    if (saveDueDateBeforeSaveTask) {
        saveDueDateBeforeSaveTask(dueDate, isObservedTabActive)
    } else if (task) {
        if (multipleTasks) {
            Backend.setTaskDueDateMultiple(tasks, dueDate)
            dispatch(setSelectedTasks(null, true))
            if (updateParentGoalReminderDate) updateParentGoalReminderDate(dueDate)
        } else if (updateParentGoalReminderDate) {
            updateParentGoalReminderDate(dueDate)
        } else {
            setTaskDueDate(projectId, task.id, dueDate, task, isObservedTabActive, null)
        }
    } else if (updateGoalMilestone) {
        updateGoalMilestone(selectedMoment.hour(12).minute(0).valueOf())
    }

    dispatch(setLastSelectedDueDate(dueDate))
    return true
}
