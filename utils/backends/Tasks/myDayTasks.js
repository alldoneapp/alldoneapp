import moment from 'moment'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import { getRoleIdsVisibleToField } from '../firestoreAccess'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { setMyDayAllTodayTasks } from '../../../redux/actions'
import store from '../../../redux/store'
import { OPTIMISTIC_TASK_REMOVED, subscribeToOptimisticTaskCreates } from './optimisticTaskCreate'

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

/** AT-2342 - mirrors the `watchTasksToAttend` query for an optimistically published task. */
export const matchesTasksToAttendQuery = (taskData, userId, endOfDay) =>
    !!taskData &&
    taskData.inDone === false &&
    taskData.currentReviewerId === userId &&
    Number.isFinite(taskData.dueDate) &&
    taskData.dueDate <= endOfDay

export async function watchTasksToAttend(projectId, userId, watcherKey) {
    const endOfDay = moment().endOf('day').valueOf()
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const accessReaderId = isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId

    // Same full-rebuild shape as the goal list: the optimistic task is one more document in the
    // list this watcher already re-derives from scratch, and it drops out again the moment the
    // real snapshot carries its id.
    let latestDocs = []
    let hasRealSnapshot = false
    const pendingDocsById = new Map()

    const emit = () => {
        const realIds = new Set(latestDocs.map(doc => doc.id))
        pendingDocsById.forEach((_, taskId) => {
            if (realIds.has(taskId)) pendingDocsById.delete(taskId)
        })
        const docs = pendingDocsById.size > 0 ? [...latestDocs, ...pendingDocsById.values()] : latestDocs

        const tasks = []
        const subtasksMap = {}

        docs.forEach(doc => {
            const task = mapTaskData(doc.id, doc.data())
            task.projectId = projectId
            addTaskToContainers(tasks, subtasksMap, task)
        })
        store.dispatch(setMyDayAllTodayTasks(projectId, TO_ATTEND_TASKS_MY_DAY_TYPE, '', tasks, subtasksMap))
    }

    const unsubOptimistic = subscribeToOptimisticTaskCreates(projectId, change => {
        if (!matchesTasksToAttendQuery(change.doc.data(), userId, endOfDay)) return
        change.type === OPTIMISTIC_TASK_REMOVED
            ? pendingDocsById.delete(change.doc.id)
            : pendingDocsById.set(change.doc.id, change.doc)
        // Same reason as the goal list: publishing before the first snapshot would replace this
        // project's whole My Day contribution with the single new task.
        if (hasRealSnapshot) emit()
    })

    const unsub = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('currentReviewerId', '==', userId)
        .where('readerIds', 'array-contains', accessReaderId)
        .where('dueDate', '<=', endOfDay)
        .orderBy('dueDate', 'desc')
        .onSnapshot(querySnapshot => {
            // The parameter is a QuerySnapshot (the original code just called `.forEach` on it).
            // Materialise it once so the optimistic path can re-emit without a second snapshot.
            if (Array.isArray(querySnapshot.docs)) {
                latestDocs = querySnapshot.docs
            } else {
                const collected = []
                querySnapshot.forEach(doc => collected.push(doc))
                latestDocs = collected
            }
            hasRealSnapshot = true
            emit()
        })

    globalWatcherUnsub[watcherKey] = () => {
        unsubOptimistic()
        unsub()
    }
}

export async function watchObservedTasks(projectId, userId, watcherKey) {
    const endOfDay = moment().endOf('day').valueOf()
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const accessReaderId = isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where(getRoleIdsVisibleToField(String(accessReaderId)), 'array-contains', userId)
        .onSnapshot(docs => {
            const tasks = []
            const subtasksMap = {}

            docs.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                const { isPublicFor, dueDateByObserversIds } = task
                if (
                    task.inDone === false &&
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
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const accessReaderId = isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('userId', '==', workstreamId)
        .where('readerIds', 'array-contains', accessReaderId)
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
