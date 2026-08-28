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

export async function watchDoneTasks(projectId, userId, watcherKey) {
    const startOfToday = moment().startOf('day').valueOf()
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const accessReaderId = isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', userId)
        .where('inDone', '==', true)
        .where('readerIds', 'array-contains', accessReaderId)
        .where('completed', '>=', startOfToday)
        .orderBy('completed', 'desc')
        .onSnapshot(docs => {
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
