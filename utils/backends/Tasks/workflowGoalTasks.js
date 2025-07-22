import moment from 'moment'
import { cloneDeep } from 'lodash'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import store from '../../../redux/store'
import {
    startLoadingData,
    stopLoadingData,
    setGoalWorkflowTasksData,
    setGoalWorkflowSubtasksByParent,
} from '../../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import TasksHelper, { OPEN_STEP } from '../../../components/TaskListView/Utils/TasksHelper'
import { chronoEntriesOrder } from '../../HelperFunctions'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../../EstimationHelper'

let userTasksInWorkflow = {}
let userWorkflowSubtasksUnsubs = {}

export const watchWorkflowGoalTasks = (projectId, goalId, watcherKey) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('done', '==', false)
        .where('parentId', '==', null)
        .where('completed', '!=', null)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        const { workflowTasksArray } = processTasks(projectId, snapshot.docs)
        store.dispatch(setGoalWorkflowTasksData(workflowTasksArray))
    })
}

const processTasks = (projectId, docs) => {
    const tasksByDate = {}
    const estimationByDate = {}
    const amountOfTasksByDate = {}
    const tasksMap = {}

    docs.forEach(doc => {
        const taskId = doc.id
        const task = mapTaskData(taskId, doc.data())
        const { estimations, stepHistory, completed } = task

        const date = moment(completed).format('YYYYMMDD')
        const currentStepId = stepHistory[stepHistory.length - 1]

        const estimation = estimations[OPEN_STEP] ? estimations[OPEN_STEP] : 0

        if (!tasksByDate[date]) {
            tasksByDate[date] = {}
            estimationByDate[date] = ESTIMATION_0_MIN
            amountOfTasksByDate[date] = 0
        }

        amountOfTasksByDate[date]++
        estimationByDate[date] += getEstimationRealValue(projectId, estimation)

        if (!tasksByDate[date][currentStepId]) tasksByDate[date][currentStepId] = []

        tasksByDate[date][currentStepId].push(task)

        tasksMap[taskId] = cloneDeep(task)
    })

    Object.keys(tasksByDate).forEach(date => {
        Object.keys(tasksByDate[date]).forEach(currentStepId => {
            tasksByDate[date][currentStepId].sort(TasksHelper.sortWorkflowAndDoneTasksFn)
        })
    })

    const workflowTasksArray = generateWorkflowTasksArray(tasksByDate, amountOfTasksByDate, estimationByDate)

    return { workflowTasksArray }
}

const generateWorkflowTasksArray = (tasksByDate, amountOfTasksByDate, estimationByDate) => {
    const tasksByDateAndStep = Object.entries(tasksByDate).sort((a, b) => b[0] - a[0])
    const workflowTasksArray = []

    for (let i = 0; i < tasksByDateAndStep.length; i++) {
        const dateElement = tasksByDateAndStep[i]
        const date = dateElement[0]
        const taskBySteps = Object.entries(dateElement[1])
        taskBySteps.sort(chronoEntriesOrder)

        const amountTasks = amountOfTasksByDate[date]
        const estimationTasks = estimationByDate[date]

        workflowTasksArray.push([date, amountTasks, estimationTasks, taskBySteps])
    }

    return workflowTasksArray
}

export const watchWorkflowGoalSubtasks = (projectId, goalId, watcherKey) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('parentDone', '==', false)
        .where('isSubtask', '==', true)
        .where('completed', '!=', null)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        const { workflowSubtasksByParent } = processSubtaskChanges(snapshot.docs)
        store.dispatch([setGoalWorkflowSubtasksByParent(workflowSubtasksByParent)])
    })
}

const processSubtaskChanges = docs => {
    const workflowSubtasksByParent = {}
    const subtasksMap = {}

    docs.forEach(doc => {
        const subtaskId = doc.id
        const subtask = mapTaskData(subtaskId, doc.data())
        const { parentId } = subtask

        if (!workflowSubtasksByParent[parentId]) workflowSubtasksByParent[parentId] = []
        workflowSubtasksByParent[parentId].push(subtask)
        subtasksMap[subtaskId] = cloneDeep(subtask)
    })

    Object.keys(workflowSubtasksByParent).forEach(parentId => {
        workflowSubtasksByParent[parentId].sort(TasksHelper.sortSubtasks)
    })

    return { workflowSubtasksByParent }
}
