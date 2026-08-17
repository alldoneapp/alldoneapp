import moment from 'moment'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { setMyDayAllTodayTasks } from '../../../redux/actions'
import store from '../../../redux/store'

export const TO_ATTEND_TASKS_MY_DAY_TYPE = 'TO_ATTEND_TASKS_MY_DAY_TYPE'
export const OBSERVED_TASKS_MY_DAY_TYPE = 'OBSERVED_TASKS_MY_DAY_TYPE'
export const WORKSTREAM_TASKS_MY_DAY_TYPE = 'WORKSTREAM_TASKS_MY_DAY_TYPE'
export const GOALS_MY_DAY_TYPE = 'GOALS_MY_DAY_TYPE'

function addTaskToContainers(tasks, subtasksMap, task) {
    const { parentId } = task
    if (parentId) {
        subtasksMap[parentId] ? subtasksMap[parentId].push(task) : (subtasksMap[parentId] = [task])
    } else {
        tasks.push(task)
    }
}

export async function watchTasksToAttend(projectId, userId, watcherKey) {
    const endOfDay = moment().endOf('day').valueOf()

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('currentReviewerId', '==', userId)
        .where('dueDate', '<=', endOfDay)
        .orderBy('dueDate', 'desc')
        .onSnapshot(docs => {
            const tasks = []
            const subtasksMap = {}

            docs.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                task.projectId = projectId
                addTaskToContainers(tasks, subtasksMap, task)
            })
            store.dispatch(setMyDayAllTodayTasks(projectId, TO_ATTEND_TASKS_MY_DAY_TYPE, '', tasks, subtasksMap))
        })
}

export async function watchObservedTasks(projectId, userId, watcherKey) {
    const endOfDay = moment().endOf('day').valueOf()

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('observersIds', 'array-contains-any', [userId])
        .onSnapshot(docs => {
            const tasks = []
            const subtasksMap = {}

            docs.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                const { isPublicFor, dueDateByObserversIds } = task
                if (
                    dueDateByObserversIds[userId] <= endOfDay &&
                    (isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || isPublicFor.includes(userId))
                ) {
                    task.projectId = projectId
                    addTaskToContainers(tasks, subtasksMap, task)
                }
            })
            store.dispatch(setMyDayAllTodayTasks(projectId, OBSERVED_TASKS_MY_DAY_TYPE, '', tasks, subtasksMap))
        })
}

export async function watchWorkstreamTasks(projectId, userId, workstreamId, watcherKey) {
    const endOfDay = moment().endOf('day').valueOf()

    const allowUserIds = [FEED_PUBLIC_FOR_ALL, userId]

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('userId', '==', workstreamId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .where('dueDate', '<=', endOfDay)
        .orderBy('dueDate', 'desc')
        .onSnapshot(docs => {
            const tasks = []
            const subtasksMap = {}

            docs.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                task.projectId = projectId
                addTaskToContainers(tasks, subtasksMap, task)
            })
            store.dispatch(
                setMyDayAllTodayTasks(projectId, WORKSTREAM_TASKS_MY_DAY_TYPE, workstreamId, tasks, subtasksMap)
            )
        })
}
