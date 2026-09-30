import moment from 'moment'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import { setMyDayDoneTasks } from '../../../redux/actions'
import store from '../../../redux/store'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

function addTaskToContainers(tasks, subtasksMap, task) {
    const { parentId } = task
    if (parentId) {
        subtasksMap[parentId] ? subtasksMap[parentId].push(task) : (subtasksMap[parentId] = [task])
    } else {
        tasks.push(task)
    }
}

/**
 * A user's tasks (and done-parent subtasks) completed since the start of today in one project.
 *
 * Shared by the My Day done list and the board's done-tasks counter (watchDoneTasksAmount), so the
 * two are one Firestore server target per project instead of two. Keep the clause order and the
 * explicit order: both are part of the query's identity.
 */
export const getTasksCompletedTodayQuery = (projectId, userId, readerId, startOfToday) =>
    getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('inDone', '==', true)
        .where('readerIds', 'array-contains', readerId)
        .where('completed', '>=', startOfToday)
        .orderBy('completed', 'desc')

export async function watchDoneTasks(projectId, userId, watcherKey) {
    const startOfToday = moment().startOf('day').valueOf()
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const accessReaderId = isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId

    globalWatcherUnsub[watcherKey] = getTasksCompletedTodayQuery(
        projectId,
        userId,
        accessReaderId,
        startOfToday
    ).onSnapshot(docs => {
        const tasks = []
        const subtasksMap = {}

        docs.forEach(doc => {
            const task = mapTaskData(doc.id, doc.data())
            task.projectId = projectId
            addTaskToContainers(tasks, subtasksMap, task)
        })
        store.dispatch(setMyDayDoneTasks(projectId, tasks, subtasksMap))
    })
}
