import moment from 'moment'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import { setMyDayWorkflowTasks } from '../../../redux/actions'
import store from '../../../redux/store'

function addTaskToContainers(tasks, subtasksMap, task) {
    const { parentId } = task
    if (parentId) {
        subtasksMap[parentId] ? subtasksMap[parentId].push(task) : (subtasksMap[parentId] = [task])
    } else {
        tasks.push(task)
    }
}

export async function watchPendingTasksToReview(projectId, userId, watcherKey) {
    const endOfDay = moment().endOf('day').valueOf()

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('inDone', '==', false)
        .where('completed', '<=', endOfDay)
        .orderBy('completed', 'desc')
        .onSnapshot(docs => {
            const tasks = []
            const subtasksMap = {}

            docs.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                const { currentReviewerId } = task
                if (currentReviewerId !== userId) {
                    task.projectId = projectId
                    addTaskToContainers(tasks, subtasksMap, task)
                }
            })
            store.dispatch(setMyDayWorkflowTasks(projectId, tasks, subtasksMap))
        })
}
