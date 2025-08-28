import moment from 'moment'
import { cloneDeep, orderBy } from 'lodash'

import { getDb, mapTaskData, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { BACKLOG_DATE_STRING, OPEN_STEP } from '../../../components/TaskListView/Utils/TasksHelper'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../../EstimationHelper'
import { setGoalOpenSubtasksByParent, setGoalOpenTasksData } from '../../../redux/actions'

export const DATE_TASK_INDEX = 0
export const AMOUNT_TASKS_INDEX = 1
export const ESTIMATION_TASKS_INDEX = 2
export const MAIN_TASK_INDEX = 3
export const MENTION_TASK_INDEX = 4
export const SUGGESTED_TASK_INDEX = 5
export const CALENDAR_TASK_INDEX = 6
export const EMAIL_TASK_INDEX = 7

export const watchOpenGoalTasks = (projectId, goalId, watcherKey) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('done', '==', false)
        .where('parentId', '==', null)
        .where('completed', '==', null)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        const { openTasksArray } = processTasks(projectId, snapshot.docs)
        store.dispatch(setGoalOpenTasksData(openTasksArray))
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
        const { estimations, dueDate, calendarData } = task

        const taskTypeIndex = getTaskTypeIndex(task)

        if (
            taskTypeIndex === CALENDAR_TASK_INDEX &&
            moment(calendarData.start.dateTime || calendarData.start.date).format('DDMMYYYY') !==
                moment().format('DDMMYYYY')
        ) {
            return
        }

        const endOfDay = moment().endOf('day').valueOf()
        const taskIsTodayOrOverdue = dueDate <= endOfDay
        const taskInBacklog = dueDate === Number.MAX_SAFE_INTEGER

        const date = taskIsTodayOrOverdue
            ? moment().format('YYYYMMDD')
            : taskInBacklog
            ? BACKLOG_DATE_STRING
            : moment(dueDate).format('YYYYMMDD')

        const estimation = estimations[OPEN_STEP] ? estimations[OPEN_STEP] : 0

        if (!tasksByDate[date]) {
            tasksByDate[date] = {}
            estimationByDate[date] = ESTIMATION_0_MIN
            amountOfTasksByDate[date] = 0
        }

        amountOfTasksByDate[date]++
        estimationByDate[date] += getEstimationRealValue(projectId, estimation)

        if (!tasksByDate[date][taskTypeIndex]) tasksByDate[date][taskTypeIndex] = []

        tasksByDate[date][taskTypeIndex].push(task)

        tasksMap[taskId] = cloneDeep(task)
    })

    Object.keys(tasksByDate).forEach(date => {
        Object.keys(tasksByDate[date]).forEach(taskTypeIndex => {
            tasksByDate[date][taskTypeIndex] = orderBy(tasksByDate[date][taskTypeIndex], 'sortIndex', 'desc')
        })
    })

    const openTasksArray = generateOpenTasksArray(tasksByDate, amountOfTasksByDate, estimationByDate)

    return { openTasksArray }
}

const getTaskTypeIndex = task => {
    const { genericData, suggestedBy, calendarData, gmailData } = task
    if (genericData) return MENTION_TASK_INDEX
    if (suggestedBy) return SUGGESTED_TASK_INDEX
    if (calendarData) return CALENDAR_TASK_INDEX
    if (gmailData) return EMAIL_TASK_INDEX
    return MAIN_TASK_INDEX
}

const generateOpenTasksArray = (tasksByDate, amountOfTasksByDate, estimationByDate) => {
    const tasksByDateAndStep = Object.entries(tasksByDate).sort((a, b) => a[0] - b[0])
    const openTasksArray = []
    for (let i = 0; i < tasksByDateAndStep.length; i++) {
        const dateElement = tasksByDateAndStep[i]
        const date = dateElement[0]
        const taskByType = dateElement[1]
        const amountTasks = amountOfTasksByDate[date]
        const estimationTasks = estimationByDate[date]
        const mainTasks = taskByType[MAIN_TASK_INDEX] ? taskByType[MAIN_TASK_INDEX] : []
        const mentionTasks = taskByType[MENTION_TASK_INDEX] ? taskByType[MENTION_TASK_INDEX] : []
        const calendarTasks = taskByType[CALENDAR_TASK_INDEX] ? taskByType[CALENDAR_TASK_INDEX] : []
        const emailTasks = taskByType[EMAIL_TASK_INDEX] ? taskByType[EMAIL_TASK_INDEX] : []
        const suggestedTasks = taskByType[SUGGESTED_TASK_INDEX] ? taskByType[SUGGESTED_TASK_INDEX] : []

        openTasksArray.push([
            date,
            amountTasks,
            estimationTasks,
            mainTasks,
            mentionTasks,
            suggestedTasks,
            calendarTasks,
            emailTasks,
        ])
    }

    return openTasksArray
}

export const watchOpenGoalSubtasks = (projectId, goalId, watcherKey) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('parentDone', '==', false)
        .where('parentId', '!=', null)
        .where('completed', '==', null)
        .where('parentGoalId', '==', goalId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        const { openSubtasksByParent } = processSubtasks(snapshot.docs)
        store.dispatch([setGoalOpenSubtasksByParent(openSubtasksByParent)])
    })
}

const processSubtasks = docs => {
    const openSubtasksByParent = {}
    const subtasksMap = {}

    docs.forEach(doc => {
        const subtaskId = doc.id
        const subtask = mapTaskData(subtaskId, doc.data())
        const { parentId } = subtask

        if (!openSubtasksByParent[parentId]) openSubtasksByParent[parentId] = []
        openSubtasksByParent[parentId].push(subtask)
        subtasksMap[subtaskId] = cloneDeep(subtask)
    })

    Object.keys(openSubtasksByParent).forEach(parentId => {
        openSubtasksByParent[parentId] = orderBy(openSubtasksByParent[parentId], 'sortIndex', 'desc')
    })

    return { openSubtasksByParent }
}
