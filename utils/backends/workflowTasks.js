import moment from 'moment'
import { getDb, mapTaskData } from './firestore'

import store from '../../redux/store'
import { startLoadingData, stopLoadingData } from '../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import TasksHelper, { OPEN_STEP } from '../../components/TaskListView/Utils/TasksHelper'
import { chronoEntriesOrder } from '../HelperFunctions'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../EstimationHelper'

let userTasksInWorkflow = {}

const processTaskChange = (
    projectId,
    tasksById,
    estimationByDate,
    amountOfTasksByDate,
    tasks,
    listsToSort,
    task,
    changeType
) => {
    const taskAdded = changeType === 'added'
    const taskModified = changeType === 'modified'

    const { completed, stepHistory, estimations } = task
    const date = moment(completed).format('YYYYMMDD')
    const currentStepId = stepHistory[stepHistory.length - 1]
    const sortListKey = { date, currentStepId }

    const addTask = () => {
        if (!tasks[date]) {
            tasks[date] = {}
            estimationByDate[date] = ESTIMATION_0_MIN
            amountOfTasksByDate[date] = 0
        }
        if (!tasks[date][currentStepId]) tasks[date] = { ...tasks[date], [currentStepId]: [] }
        estimationByDate[date] += getEstimationRealValue(projectId, estimations[OPEN_STEP])
        amountOfTasksByDate[date]++
        tasks[date] = { ...tasks[date], [currentStepId]: tasks[date][currentStepId].concat(task) }
        if (tasks[date][currentStepId].length > 1) listsToSort.add(sortListKey)
        tasksById[task.id] = task
    }

    const deleteTask = (date, stepId, estimation) => {
        tasks[date] = {
            ...tasks[date],
            [stepId]: tasks[date][stepId].filter(taskItem => taskItem.id !== task.id),
        }
        if (tasks[date][stepId].length === 0) delete tasks[date][stepId]
        const amountStepsInDate = Object.keys(tasks[date]).length
        estimationByDate[date] -= getEstimationRealValue(projectId, estimation)
        amountOfTasksByDate[date]--
        if (amountStepsInDate <= 1) {
            if (amountStepsInDate === 0) {
                delete tasks[date]
                delete estimationByDate[date]
                delete amountOfTasksByDate[date]
            }
            listsToSort.delete(sortListKey)
        }

        delete tasksById[task.id]
    }

    if (taskModified) {
        const oldTask = tasksById[task.id]
        const oldDate = moment(oldTask.completed).format('YYYYMMDD')
        const oldStepHistory = oldTask.stepHistory
        const oldCurrentStepId = oldStepHistory[oldStepHistory.length - 1]
        const oldEstimation = oldTask.estimations[OPEN_STEP]
        deleteTask(oldDate, oldCurrentStepId, oldEstimation)
        addTask()
    } else if (taskAdded) {
        addTask()
    } else {
        deleteTask(date, currentStepId, estimations[OPEN_STEP])
    }
}

const processSubtaskChange = (subtasksByParentId, subtasksById, subtasksListToSortParentsId, subtask, changeType) => {
    const { parentId } = subtask

    const addSubtask = () => {
        if (!subtasksByParentId[parentId]) subtasksByParentId[parentId] = []
        subtasksByParentId[parentId] = subtasksByParentId[parentId].concat(subtask)
        subtasksById[subtask.id] = subtask
        if (subtasksByParentId[parentId].length > 1) subtasksListToSortParentsId.add(parentId)
    }

    const deleteTask = () => {
        subtasksByParentId[parentId] = subtasksByParentId[parentId].filter(taskItem => taskItem.id !== subtask.id)

        if (subtasksByParentId[parentId].length <= 1) {
            if (subtasksByParentId[parentId].length === 0) delete subtasksByParentId[parentId]
            subtasksListToSortParentsId.delete(parentId)
        }
        delete subtasksById[subtask.id]
    }

    if (changeType === 'modified') {
        deleteTask()
        addSubtask()
    } else if (changeType === 'added') {
        addSubtask()
    } else {
        deleteTask()
    }
}

export function watchTasksInWorkflow(projectId, taskCallback, subtaskCallback) {
    setTimeout(() => {
        store.dispatch(startLoadingData())
    })
    const { currentUser, loggedUser } = store.getState()
    const currentUserId = currentUser.uid
    const loggedUserId = loggedUser.uid

    unwatchTasksInWorkflow(projectId)

    let storedTasks = {}
    let tasksById = {}
    let estimationByDate = {}
    let amountOfTasksByDate = {}

    let subtasksByParentId = {}
    let subtasksById = {}

    const processTaskChanges = (
        projectId,
        changes,
        storedTasks,
        tasksById,
        estimationByDate,
        amountOfTasksByDate,
        subtasksById,
        subtasksByParentId
    ) => {
        const tasks = { ...storedTasks }
        const listsToSort = new Set()

        const subtasks = { ...subtasksByParentId }
        const subtasksListToSortParentsId = new Set()

        for (let change of changes) {
            const task = mapTaskData(change.doc.id, change.doc.data())
            const changeType = change.type

            if (task.parentId) {
                processSubtaskChange(subtasks, subtasksById, subtasksListToSortParentsId, task, changeType)
            } else {
                processTaskChange(
                    projectId,
                    tasksById,
                    estimationByDate,
                    amountOfTasksByDate,
                    tasks,
                    listsToSort,
                    task,
                    changeType
                )
            }
        }

        for (let { date, currentStepId } of listsToSort) {
            tasks[date][currentStepId].sort(TasksHelper.sortWorkflowAndDoneTasksFn)
        }

        for (let parentId of subtasksListToSortParentsId) {
            subtasks[parentId].sort(TasksHelper.sortSubtasks)
        }

        return { tasks, subtasks }
    }

    let cacheChanges = []
    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    const unsub = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', currentUserId)
        .where('inDone', '==', false)
        .where('currentReviewerId', '!=', currentUserId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            const changes = querySnapshot.docChanges()
            if (querySnapshot.metadata.fromCache) {
                cacheChanges = [...cacheChanges, ...changes]
            } else {
                const mergedChanges = [...cacheChanges, ...changes]
                if (mergedChanges.length > 0) {
                    const { tasks, subtasks } = processTaskChanges(
                        projectId,
                        mergedChanges,
                        storedTasks,
                        tasksById,
                        estimationByDate,
                        amountOfTasksByDate,
                        subtasksById,
                        subtasksByParentId
                    )

                    storedTasks = tasks
                    subtasksByParentId = subtasks

                    const tasksByDateAndStep = Object.entries(tasks).sort((a, b) => b[0] - a[0])
                    for (let i = 0; i < tasksByDateAndStep.length; i++) {
                        const element = tasksByDateAndStep[i]
                        const date = element[0]
                        const tasksByStep = Object.entries(element[1])
                        tasksByStep.sort(chronoEntriesOrder)
                        tasksByDateAndStep[i] = [date, tasksByStep]
                    }

                    taskCallback(tasksByDateAndStep, estimationByDate, amountOfTasksByDate)
                    subtaskCallback(subtasks)

                    cacheChanges = []
                }
                store.dispatch(stopLoadingData())
            }
        })

    userTasksInWorkflow[projectId] = { [currentUserId]: unsub }
}

export function unwatchTasksInWorkflow(projectId) {
    const currentUserId = store.getState().currentUser.uid
    if (userTasksInWorkflow[projectId] && userTasksInWorkflow[projectId][currentUserId]) {
        userTasksInWorkflow[projectId][currentUserId]()
        delete userTasksInWorkflow[projectId]
    }
}
