import store from '../../../redux/store'
import { matchSearch } from '../HashtagFiltersHelper'
import {
    CALENDAR_TASK_INDEX,
    EMAIL_TASK_INDEX,
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
    WORKFLOW_TASK_INDEX,
} from '../../../utils/backends/openTasks'
import { cloneDeep } from 'lodash'

/**
 * Determine if a task match with the term list
 *
 * @param task
 * @returns {boolean}
 */
export const taskMatchHashtagFilters = task => {
    const termList = Array.from(store.getState().hashtagFilters.keys())
    const subtaskNames = task.subtaskNames && task.subtaskNames.length > 0 ? task.subtaskNames.join(' ') : ''

    // Task name [or sub tasks names] have any of the terms in the list inside
    return (
        termList.length === 0 ||
        matchSearch(task.name, termList) ||
        // Sub Tasks names have any of the terms in the list inside
        matchSearch(subtaskNames, termList)
    )
}

export const filterOpenTasks = openTasks => {
    const filteredTasks = cloneDeep(openTasks)

    for (let dateIndex in filteredTasks) {
        const mainTasks = filteredTasks[dateIndex][MAIN_TASK_INDEX]
        const mentionTasks = filteredTasks[dateIndex][MENTION_TASK_INDEX]
        const calendarTasks = filteredTasks[dateIndex][CALENDAR_TASK_INDEX]
        const emailTasksTasks = filteredTasks[dateIndex][EMAIL_TASK_INDEX]
        const suggestedTasks = filteredTasks[dateIndex][SUGGESTED_TASK_INDEX]
        const workflowTasks = filteredTasks[dateIndex][WORKFLOW_TASK_INDEX]
        const observedTasks = filteredTasks[dateIndex][OBSERVED_TASKS_INDEX]
        const streamAndUserTasks = filteredTasks[dateIndex][STREAM_AND_USER_TASKS_INDEX]

        filteredTasks[dateIndex][MAIN_TASK_INDEX] = filterTasksListByGoals(mainTasks)
        filteredTasks[dateIndex][MENTION_TASK_INDEX] = filterTasksListByGoals(mentionTasks)
        filteredTasks[dateIndex][CALENDAR_TASK_INDEX] = filterTasksListByGoals(calendarTasks)
        filteredTasks[dateIndex][EMAIL_TASK_INDEX] = filterTasksListByGoals(emailTasksTasks)
        filteredTasks[dateIndex][SUGGESTED_TASK_INDEX] = filterTasksByUsers(suggestedTasks)
        filteredTasks[dateIndex][WORKFLOW_TASK_INDEX] = filterTasksByUsers(workflowTasks)
        filteredTasks[dateIndex][OBSERVED_TASKS_INDEX] = filterTasksByUsers(observedTasks)
        filteredTasks[dateIndex][STREAM_AND_USER_TASKS_INDEX] = filterTasksByUsers(streamAndUserTasks)
    }

    return filteredTasks
}

const filterTasksByUsers = mainTasks => {
    const finalTasks = []
    let index = 0
    for (let userIndex in mainTasks) {
        const tasks = filterTasksListByGoals(mainTasks[userIndex][1])

        if (tasks.length > 0) {
            finalTasks[index] = [mainTasks[userIndex][0], tasks]
            index++
        }
    }
    return finalTasks
}

const filterTasksListByGoals = mainTasks => {
    const finalTasks = []
    let index = 0
    for (let goalIndex in mainTasks) {
        const tasks = mainTasks[goalIndex][1].filter(task => taskMatchHashtagFilters(task))

        if (tasks.length > 0) {
            finalTasks[index] = [mainTasks[goalIndex][0], tasks]
            index++
        }
    }
    return finalTasks
}

export const filterPendingTasks = pendingTasks => {
    const filteredTasks = cloneDeep(pendingTasks)
    const finalTasks = []
    let indexDate = 0

    for (let dateIdx in filteredTasks) {
        const steps = filteredTasks[dateIdx][1]
        const finalTasksStep = []
        let indexStep = 0

        for (let stepIdx in steps) {
            const tasks = steps[stepIdx][1].filter(task => taskMatchHashtagFilters(task))

            if (tasks.length > 0) {
                finalTasksStep[indexStep] = [steps[stepIdx][0], tasks]
                indexStep++
            }
        }

        if (finalTasksStep.length > 0) {
            finalTasks[indexDate] = [filteredTasks[dateIdx][0], finalTasksStep]
            indexDate++
        }
    }

    return finalTasks
}

export const filterDoneTasks = doneTasks => {
    const filteredTasks = cloneDeep(doneTasks)
    const finalTasks = []
    let index = 0

    for (let dateIdx in filteredTasks) {
        const tasks = filteredTasks[dateIdx][1].filter(task => taskMatchHashtagFilters(task))

        if (tasks.length > 0) {
            finalTasks[index] = [filteredTasks[dateIdx][0], tasks]
            index++
        }
    }

    return finalTasks
}
