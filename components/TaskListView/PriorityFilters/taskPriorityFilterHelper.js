import { cloneDeep } from 'lodash'

import store from '../../../redux/store'
import {
    ACTIVE_GOALS_INDEX,
    AMOUNT_TASKS_INDEX,
    CALENDAR_TASK_INDEX,
    DATE_TASK_INDEX,
    EMAIL_TASK_INDEX,
    EMPTY_SECTION_INDEX,
    ESTIMATION_TASKS_INDEX,
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
    TODAY_DATE,
    WORKFLOW_TASK_INDEX,
} from '../../../utils/backends/openTasks'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../../../utils/EstimationHelper'
import { normalizeTaskPriority, TASK_PRIORITY_NONE } from '../../../utils/TaskPriority'
import { getVmSessionDocId } from '../../../utils/backends/Assistants/vmSessionStatusHelper'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'

// Resolved at call time, NOT at module scope: openTasks.js imports this module
// (for filterOpTasks), so during the circular module init these constants are
// still undefined — capturing them eagerly would freeze [undefined, ...] and
// silently break the filter and the counts.
const getTasksByGoalIndexes = () => [MAIN_TASK_INDEX, MENTION_TASK_INDEX, CALENDAR_TASK_INDEX, EMAIL_TASK_INDEX]
const getTasksByUserIndexes = () => [
    SUGGESTED_TASK_INDEX,
    WORKFLOW_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
]

const taskMatchesPriorityFilters = (task, selectedPriorities) =>
    selectedPriorities.includes(normalizeTaskPriority(task.priority))

const taskMatchesVmStateFilters = (task, selectedVmStates, vmStatesByTask) =>
    selectedVmStates.includes(vmStatesByTask[getVmSessionDocId(task.projectId, task.id)])

// A parent counts as matching when one of its subtasks matches, mirroring how
// the hashtag filter matches parents by subtask names — the subtask can only be
// shown through its parent row.
const taskOrSubtasksMatchPriorityFilters = (task, selectedPriorities, subtasksByParentId) => {
    if (taskMatchesPriorityFilters(task, selectedPriorities)) return true
    const subtasks = (subtasksByParentId && subtasksByParentId[task.id]) || []
    return subtasks.some(subtask => taskMatchesPriorityFilters(subtask, selectedPriorities))
}

const taskOrSubtasksMatchVmStateFilters = (task, selectedVmStates, vmStatesByTask, subtasksByParentId) => {
    if (taskMatchesVmStateFilters(task, selectedVmStates, vmStatesByTask)) return true
    const subtasks = (subtasksByParentId && subtasksByParentId[task.id]) || []
    return subtasks.some(subtask => taskMatchesVmStateFilters(subtask, selectedVmStates, vmStatesByTask))
}

const getTaskEstimationValue = (task, isObservedTask, currentUserId) => {
    if (isObservedTask) {
        return task.estimationsByObserverIds?.[currentUserId] || 0
    }
    const stepHistory = task.stepHistory || []
    const currentStepId = stepHistory[stepHistory.length - 1]
    return task.estimations?.[currentStepId] || 0
}

const filterTasksByGoals = (tasksByGoal, taskMatches) => {
    const finalTasks = []
    for (let goalIndex in tasksByGoal) {
        const tasks = tasksByGoal[goalIndex][1].filter(taskMatches)
        if (tasks.length > 0) finalTasks.push([tasksByGoal[goalIndex][0], tasks])
    }
    return finalTasks
}

const filterTasksByUsers = (tasksByUser, taskMatches) => {
    const finalTasks = []
    for (let userIndex in tasksByUser) {
        const tasks = filterTasksByGoals(tasksByUser[userIndex][1], taskMatches)
        if (tasks.length > 0) finalTasks.push([tasksByUser[userIndex][0], tasks])
    }
    return finalTasks
}

const sumSectionTasks = (section, callback) => {
    getTasksByGoalIndexes().forEach(typeIndex => {
        const tasksByGoal = section[typeIndex] || []
        tasksByGoal.forEach(goalEntry => {
            goalEntry[1].forEach(task => callback(task, false))
        })
    })
    getTasksByUserIndexes().forEach(typeIndex => {
        const tasksByUser = section[typeIndex] || []
        tasksByUser.forEach(userEntry => {
            userEntry[1].forEach(goalEntry => {
                goalEntry[1].forEach(task => callback(task, typeIndex === OBSERVED_TASKS_INDEX))
            })
        })
    })
}

/**
 * Filters the open-tasks date sections down to the tasks matching the selected
 * priorities, recalculating the per-date amount and estimation so the date
 * headers stay accurate. Date sections left without tasks and without goal rows
 * are dropped, except the today section in the selected-project view (it hosts
 * the add-task / empty-inbox UI).
 */
const filterOpenTasksSections = (openTasks, taskMatches) => {
    const { currentUser, selectedProjectIndex } = store.getState()
    const currentUserId = currentUser.uid
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    const filteredSections = []
    cloneDeep(openTasks).forEach(section => {
        getTasksByGoalIndexes().forEach(typeIndex => {
            section[typeIndex] = filterTasksByGoals(section[typeIndex] || [], taskMatches)
        })
        getTasksByUserIndexes().forEach(typeIndex => {
            section[typeIndex] = filterTasksByUsers(section[typeIndex] || [], taskMatches)
        })

        let amount = 0
        let estimation = ESTIMATION_0_MIN
        sumSectionTasks(section, (task, isObservedTask) => {
            amount++
            estimation += getEstimationRealValue(
                task.projectId,
                getTaskEstimationValue(task, isObservedTask, currentUserId)
            )
        })
        section[AMOUNT_TASKS_INDEX] = amount
        section[ESTIMATION_TASKS_INDEX] = estimation

        const hasGoalRows =
            (section[EMPTY_SECTION_INDEX] || []).length > 0 || (section[ACTIVE_GOALS_INDEX] || []).length > 0
        const keepTodaySection = inSelectedProject && section[DATE_TASK_INDEX] === TODAY_DATE
        if (amount > 0 || hasGoalRows || keepTodaySection) filteredSections.push(section)
    })

    return filteredSections
}

export const filterOpenTasksSectionsByPriority = (openTasks, selectedPriorities, subtasksByParentId) => {
    if (!selectedPriorities || selectedPriorities.length === 0) return openTasks
    return filterOpenTasksSections(openTasks, task =>
        taskOrSubtasksMatchPriorityFilters(task, selectedPriorities, subtasksByParentId)
    )
}

export const filterOpenTasksSectionsByVmState = (openTasks, selectedVmStates, vmStatesByTask, subtasksByParentId) => {
    if (!selectedVmStates || selectedVmStates.length === 0) return openTasks
    return filterOpenTasksSections(openTasks, task =>
        taskOrSubtasksMatchVmStateFilters(task, selectedVmStates, vmStatesByTask, subtasksByParentId)
    )
}

/**
 * Counts the tasks per priority across a list of project instances, each a
 * `{ sections, subtasksByParentId }` pair. Subtasks of listed parents count by
 * their own priority, since a prioritized subtask is reachable through the
 * filter (it shows its parent row). `prioritized` is the number of tasks with
 * a real priority — the filter line only shows itself when it is above zero.
 */
export const collectTaskPriorityCounts = instances => {
    const counts = {}
    let total = 0
    const countTask = task => {
        const priority = normalizeTaskPriority(task.priority)
        counts[priority] = (counts[priority] || 0) + 1
        total++
    }
    instances.forEach(instance => {
        if (!instance) return
        const { sections, subtasksByParentId } = instance
        ;(sections || []).forEach(section => {
            sumSectionTasks(section, task => {
                countTask(task)
                const subtasks = (subtasksByParentId && subtasksByParentId[task.id]) || []
                subtasks.forEach(countTask)
            })
        })
    })
    const prioritized = total - (counts[TASK_PRIORITY_NONE] || 0)
    return { counts, total, prioritized }
}

export const collectTaskVmStateCounts = (instances, vmStatesByTask) => {
    const counts = {}
    let total = 0
    let available = 0
    const countTask = task => {
        const vmState = vmStatesByTask[getVmSessionDocId(task.projectId, task.id)]
        if (vmState) {
            counts[vmState] = (counts[vmState] || 0) + 1
            available++
        }
        total++
    }
    instances.forEach(instance => {
        if (!instance) return
        const { sections, subtasksByParentId } = instance
        ;(sections || []).forEach(section => {
            sumSectionTasks(section, task => {
                countTask(task)
                const subtasks = (subtasksByParentId && subtasksByParentId[task.id]) || []
                subtasks.forEach(countTask)
            })
        })
    })
    return { counts, total, available }
}

export const collectTaskVmSessionRefs = instances => {
    const refsByKey = {}
    const collectTask = task => {
        if (!task.projectId || !task.id) return
        const key = getVmSessionDocId(task.projectId, task.id)
        refsByKey[key] = { key, projectId: task.projectId, taskId: task.id }
    }
    instances.forEach(instance => {
        if (!instance) return
        const { sections, subtasksByParentId } = instance
        ;(sections || []).forEach(section => {
            sumSectionTasks(section, task => {
                collectTask(task)
                const subtasks = (subtasksByParentId && subtasksByParentId[task.id]) || []
                subtasks.forEach(collectTask)
            })
        })
    })
    return Object.values(refsByKey)
}
