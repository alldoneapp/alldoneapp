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

export const sortTasksByPriority = (tasks, focusedTaskId = null) => {
    if (!Array.isArray(tasks)) return []

    return tasks
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
}
