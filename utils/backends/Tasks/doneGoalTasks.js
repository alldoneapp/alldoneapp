import moment from 'moment'
import { cloneDeep } from 'lodash'

import { getDb, mapTaskData, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import TasksHelper, { OPEN_STEP } from '../../../components/TaskListView/Utils/TasksHelper'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../../EstimationHelper'
import {
    setGoalDoneSubtasksByParent,
    setGoalDoneTasksData,
    setGoalDoneTasksExpandedAmount,
} from '../../../redux/actions'
import { AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON } from '../doneTasks'

export const watchDoneGoalTasks = (projectId, goalId, watcherKey) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let firstUpdate = true

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('done', '==', true)
        .where('parentId', '==', null)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        const { doneTasksArray } = processTaskChanges(projectId, snapshot.docs)

        store.dispatch(setGoalDoneTasksData(doneTasksArray))

        if (firstUpdate) {
            const amountFirstDay = doneTasksArray.length > 0 ? doneTasksArray[0][1] : 0
            let amount = -amountFirstDay
            doneTasksArray.forEach(taskData => {
                amount += taskData[1]
            })

            store.dispatch(
                setGoalDoneTasksExpandedAmount(
                    Math.ceil(amount / AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON) *
                        AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON
                )
            )
            firstUpdate = false
        }
    })
}

const processTaskChanges = (projectId, docs) => {
    const tasksByDate = {}
    const estimationByDate = {}
    const amountOfTasksByDate = {}
    const tasksMap = {}

    docs.forEach(doc => {
        const taskId = doc.id
        const task = mapTaskData(taskId, doc.data())
        const { estimations, completed } = task

        const date = moment(completed).format('YYYYMMDD')

        const estimation = estimations[OPEN_STEP] ? estimations[OPEN_STEP] : 0

        if (!tasksByDate[date]) {
            tasksByDate[date] = []
            estimationByDate[date] = ESTIMATION_0_MIN
            amountOfTasksByDate[date] = 0
        }

        tasksByDate[date].push(task)
        estimationByDate[date] += getEstimationRealValue(projectId, estimation)
        amountOfTasksByDate[date]++

        tasksMap[taskId] = cloneDeep(task)
    })

    Object.keys(tasksByDate).forEach(date => {
        tasksByDate[date].sort(TasksHelper.sortWorkflowAndDoneTasksFn)
    })

    const doneTasksArray = generateDoneTasksArray(tasksByDate, amountOfTasksByDate, estimationByDate)

    return { doneTasksArray }
}

const generateDoneTasksArray = (tasksByDate, amountOfTasksByDate, estimationByDate) => {
    const tasksByDateAndStep = Object.entries(tasksByDate).sort((a, b) => b[0] - a[0])

    const doneTasksArray = []

    for (let i = 0; i < tasksByDateAndStep.length; i++) {
        const dateElement = tasksByDateAndStep[i]
        const date = dateElement[0]
        const tasks = dateElement[1]
        const amountTasks = amountOfTasksByDate[date]
        const estimationTasks = estimationByDate[date]

        doneTasksArray.push([date, amountTasks, estimationTasks, tasks])
    }

    return doneTasksArray
}

export const watchDoneGoalSubtasks = (projectId, goalId, watcherKey) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('parentDone', '==', true)
        .where('isSubtask', '==', true)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        const { doneSubtasksByParent } = processSubtaskChanges(snapshot.docs)

        store.dispatch([setGoalDoneSubtasksByParent(doneSubtasksByParent)])
    })
}

const processSubtaskChanges = docs => {
    const doneSubtasksByParent = {}
    const subtasksMap = {}

    docs.forEach(doc => {
        const subtaskId = doc.id
        const subtask = mapTaskData(subtaskId, doc.data())
        const { parentId } = subtask

        if (!doneSubtasksByParent[parentId]) doneSubtasksByParent[parentId] = []
        doneSubtasksByParent[parentId].push(subtask)
        subtasksMap[subtaskId] = cloneDeep(subtask)
    })

    Object.keys(doneSubtasksByParent).forEach(parentId => {
        doneSubtasksByParent[parentId].sort(TasksHelper.sortSubtasks)
    })

    return { doneSubtasksByParent }
}
