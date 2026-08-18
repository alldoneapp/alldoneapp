import { orderCalendarTasksLast } from './CalendarTaskOrder'

export const TASK_PRIORITY_NONE = 'none'
export const TASK_PRIORITY_DO_LATER = 'do_later'
export const TASK_PRIORITY_COULD_DO = 'could_do'
export const TASK_PRIORITY_SHOULD_DO = 'should_do'
export const TASK_PRIORITY_MUST_DO = 'must_do'

export const TASK_PRIORITIES = [
    TASK_PRIORITY_NONE,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_SHOULD_DO,
    TASK_PRIORITY_MUST_DO,
]

const TASK_PRIORITY_RANK = {
    [TASK_PRIORITY_NONE]: 0,
    [TASK_PRIORITY_DO_LATER]: 1,
    [TASK_PRIORITY_COULD_DO]: 2,
    [TASK_PRIORITY_SHOULD_DO]: 3,
    [TASK_PRIORITY_MUST_DO]: 4,
}

const TASK_PRIORITY_LABEL = {
    [TASK_PRIORITY_NONE]: 'No priority',
    [TASK_PRIORITY_DO_LATER]: 'Do later',
    [TASK_PRIORITY_COULD_DO]: 'Could do',
    [TASK_PRIORITY_SHOULD_DO]: 'Should do',
    [TASK_PRIORITY_MUST_DO]: 'Must do',
}

export const normalizeTaskPriority = priority => (TASK_PRIORITIES.includes(priority) ? priority : TASK_PRIORITY_NONE)

export const getTaskPriorityRank = priority => TASK_PRIORITY_RANK[normalizeTaskPriority(priority)]

export const getTaskPriorityLabel = priority => TASK_PRIORITY_LABEL[normalizeTaskPriority(priority)]

/**
 * THE ordering funnel for a rendered task group. Every grouped list goes through it — the open-tasks
 * list (`openTasks.js`), goal tasks (`openGoalTasks.js`, `GoalTasksList`), the rendered list
 * (`TasksList`), subtasks (`SubTasksView`, `DroppableTaskList`) and My Day's subtask map — so a rule
 * applied here cannot be forgotten by a view. `tasks` arrives already ordered by `sortIndex`
 * descending; this adds the two rules that outrank it.
 *
 * Order of the stages is the order of authority, weakest last:
 *
 *   1. the focused task is pinned to the top      — an explicit "I am working on this now"
 *   2. priority, then arrival (= sortIndex desc)  — the ordering the user controls
 *   3. calendar tasks are moved to the end        — AT-2351, see utils/CalendarTaskOrder.js
 *
 * Stage 3 runs last precisely BECAUSE priority would otherwise defeat it: a Must-do meeting used to
 * be lifted out of the calendar block no matter what its stored `sortIndex` said, which is one of
 * the ways AT-2270 leaked. The focused task is passed through so stage 1 survives stage 3.
 */
export const sortTasksByPriority = (tasks, focusedTaskId = null) => {
    if (!Array.isArray(tasks)) return []

    const tasksByPriority = tasks
        .map((task, index) => ({ task, index }))
        .sort((a, b) => {
            if (focusedTaskId) {
                const aIsFocused = a.task?.id === focusedTaskId
                const bIsFocused = b.task?.id === focusedTaskId
                if (aIsFocused !== bIsFocused) return aIsFocused ? -1 : 1
            }

            const priorityDifference = getTaskPriorityRank(b.task?.priority) - getTaskPriorityRank(a.task?.priority)
            return priorityDifference || a.index - b.index
        })
        .map(item => item.task)

    return orderCalendarTasksLast(tasksByPriority, focusedTaskId)
}

export const compareTasksByPriorityThenCompleted = (a, b) => {
    const priorityDifference = getTaskPriorityRank(b?.priority) - getTaskPriorityRank(a?.priority)
    return priorityDifference || (b?.completed || 0) - (a?.completed || 0)
}
