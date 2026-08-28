import moment from 'moment'
import { cloneDeep, orderBy } from 'lodash'

import { getDb, mapTaskData, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { BACKLOG_DATE_STRING, OPEN_STEP } from '../../../components/TaskListView/Utils/TasksHelper'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../../EstimationHelper'
import { setGoalOpenSubtasksByParent, setGoalOpenTasksData } from '../../../redux/actions'
import { sortTasksByPriority } from '../../TaskPriority'
import { OPTIMISTIC_TASK_REMOVED, subscribeToOptimisticTaskCreates } from './optimisticTaskCreate'

export const DATE_TASK_INDEX = 0
export const AMOUNT_TASKS_INDEX = 1
export const ESTIMATION_TASKS_INDEX = 2
export const MAIN_TASK_INDEX = 3
export const MENTION_TASK_INDEX = 4
export const SUGGESTED_TASK_INDEX = 5
// AT-2377: the calendar bucket is back, which is what gives a goal its own Calendar section.
// The old email bucket (7) stays retired - it rendered nowhere on the open-tasks board.
export const CALENDAR_TASK_INDEX = 6

/**
 * AT-2342 - mirrors the `watchOpenGoalTasks` query for an optimistically published task.
 * Note this list keys on `done`/`parentId`/`completed`, NOT the `inDone` the open board uses,
 * and a task only lands here when `parentGoalId` was already set at write time.
 */
export const matchesOpenGoalTasksQuery = (taskData, goalId, allowUserIds) =>
    !!taskData &&
    taskData.done === false &&
    (taskData.parentId === null || taskData.parentId === undefined) &&
    (taskData.completed === null || taskData.completed === undefined) &&
    taskData.parentGoalId === goalId &&
    Array.isArray(taskData.isPublicFor) &&
    taskData.isPublicFor.some(id => allowUserIds.includes(id))

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
        .where('readerIds', 'array-contains', allowUserIds[allowUserIds.length - 1])

    // This watcher rebuilds its whole output from the document list on every snapshot, so the
    // optimistic insert is simply an extra document in that list. Reconciliation is therefore
    // free: as soon as the real snapshot carries the id, `emit` drops the pending copy and the
    // rebuild runs on the real document alone - the two can never both be rendered.
    let latestDocs = []
    let hasRealSnapshot = false
    const pendingDocsById = new Map()

    const emit = () => {
        const realIds = new Set(latestDocs.map(doc => doc.id))
        pendingDocsById.forEach((_, taskId) => {
            if (realIds.has(taskId)) pendingDocsById.delete(taskId)
        })
        const docs = pendingDocsById.size > 0 ? [...latestDocs, ...pendingDocsById.values()] : latestDocs
        const { openTasksArray } = processTasks(projectId, docs)
        store.dispatch(setGoalOpenTasksData(openTasksArray))
    }

    const unsubOptimistic = subscribeToOptimisticTaskCreates(projectId, change => {
        if (!matchesOpenGoalTasksQuery(change.doc.data(), goalId, allowUserIds)) return
        change.type === OPTIMISTIC_TASK_REMOVED
            ? pendingDocsById.delete(change.doc.id)
            : pendingDocsById.set(change.doc.id, change.doc)
        // Before the first snapshot this rebuild would publish a list holding ONLY the new task,
        // i.e. a goal that appears to have lost everything else. The task is still queued in
        // `pendingDocsById` and the imminent first snapshot renders it together with the rest.
        if (hasRealSnapshot) emit()
    })

    const unsub = query.onSnapshot(snapshot => {
        latestDocs = snapshot.docs
        hasRealSnapshot = true
        emit()
    })

    globalWatcherUnsub[watcherKey] = () => {
        unsubOptimistic()
        unsub()
    }
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

        // A goal only ever lists today's calendar events.
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
            const taskList = orderBy(tasksByDate[date][taskTypeIndex], 'sortIndex', 'desc')
            // AT-2377: the Calendar section sorts chronologically; priority must not reorder it.
            tasksByDate[date][taskTypeIndex] =
                Number(taskTypeIndex) === CALENDAR_TASK_INDEX ? taskList : sortTasksByPriority(taskList)
        })
    })

    const openTasksArray = generateOpenTasksArray(tasksByDate, amountOfTasksByDate, estimationByDate)

    return { openTasksArray }
}

const getTaskTypeIndex = task => {
    const { genericData, suggestedBy, calendarData } = task
    if (genericData) return MENTION_TASK_INDEX
    if (suggestedBy) return SUGGESTED_TASK_INDEX
    // AT-2377: meetings render in the goal's own Calendar section.
    if (calendarData) return CALENDAR_TASK_INDEX
    // Inbox-summary email tasks deliberately stay in the main list.
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
        const suggestedTasks = taskByType[SUGGESTED_TASK_INDEX] ? taskByType[SUGGESTED_TASK_INDEX] : []
        const calendarTasks = taskByType[CALENDAR_TASK_INDEX] ? taskByType[CALENDAR_TASK_INDEX] : []

        openTasksArray.push([
            date,
            amountTasks,
            estimationTasks,
            mainTasks,
            mentionTasks,
            suggestedTasks,
            calendarTasks,
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
        .where('readerIds', 'array-contains', allowUserIds[allowUserIds.length - 1])

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
        openSubtasksByParent[parentId] = sortTasksByPriority(
            orderBy(openSubtasksByParent[parentId], 'sortIndex', 'desc')
        )
    })

    return { openSubtasksByParent }
}
