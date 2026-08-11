import moment from 'moment'

import { getDb, mapTaskData, globalWatcherUnsub } from './firestore'
import store from '../../redux/store'
import { startLoadingData, stopLoadingData, updateUserProject } from '../../redux/actions'
import { checkIfSelectedAllProjects } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import TasksHelper, { OPEN_STEP } from '../../components/TaskListView/Utils/TasksHelper'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../EstimationHelper'

export const AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON = 15

export function watchTodayDoneTasks(project, watcherKey, callback) {
    setTimeout(() => {
        store.dispatch(startLoadingData())
    })
    const { currentUser, loggedUser, selectedProjectIndex } = store.getState()
    const projectId = project.id
    const currentUserId = currentUser.uid
    const loggedUserId = loggedUser.uid
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    const now = moment()
    const endOfToday = now.endOf('day').valueOf()
    const startOfToday = now.startOf('day').valueOf()
    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', currentUserId)
        .where('inDone', '==', true)
        .where('completed', '<=', endOfToday)
        .where('completed', '>=', startOfToday)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .orderBy('completed', 'desc')
        .orderBy('sortIndex', 'desc')
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            if (!querySnapshot.metadata.fromCache) {
                const tasks = {}
                const todaySubtasksByTask = {}
                const estimationByDate = {}

                let lastDoneTimestamp = moment('01-01-1970', 'DD-MM-YYYY').valueOf()
                if (querySnapshot.docs.length) {
                    lastDoneTimestamp = querySnapshot.docs[0].data().completed
                    const date = now.format('YYYYMMDD')
                    tasks[date] = []
                    estimationByDate[date] = ESTIMATION_0_MIN
                    for (const doc of querySnapshot.docs) {
                        const task = mapTaskData(doc.id, doc.data())

                        if (task.parentId) {
                            todaySubtasksByTask[task.parentId]
                                ? todaySubtasksByTask[task.parentId].push(task)
                                : (todaySubtasksByTask[task.parentId] = [task])
                        } else {
                            tasks[date].push(task)
                            estimationByDate[date] += getEstimationRealValue(projectId, task.estimations[OPEN_STEP])
                        }
                    }
                }

                inAllProjects && store.dispatch(updateUserProject({ ...project, lastDoneDate: lastDoneTimestamp }))

                const tasksByDate = Object.entries(tasks).sort((a, b) => b[0] - a[0])
                store.dispatch(stopLoadingData())

                callback(tasksByDate, todaySubtasksByTask, estimationByDate)
            }
        })
}

export function watchEarlierDoneTasks(project, tasksAmountToWatch, watcherKey, callback) {
    setTimeout(() => {
        store.dispatch(startLoadingData())
    })
    const { currentUser, loggedUser, selectedProjectIndex } = store.getState()
    const projectId = project.id
    const currentUserId = currentUser.uid
    const loggedUserId = loggedUser.uid
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    const now = moment()
    const endOfToday = now.endOf('day').valueOf()

    let storedTasks = {}
    let tasksById = {}
    let estimationByDate = {}

    const updateLastTwoWeeksTasks = changes => {
        const tasks = { ...storedTasks }
        const datesToSort = new Set()
        let lastDoneDate = project.lastDoneDate ? project.lastDoneDate : 0
        let lastEditedDateRemoved = false

        for (let change of changes) {
            const taskId = change.doc.id
            const type = change.type
            const taskAdded = type === 'added'
            const taskModified = type === 'modified'

            const task = mapTaskData(taskId, change.doc.data())
            const completedTimestamp = task.completed
            const date = moment(completedTimestamp).format('YYYYMMDD')

            if (taskModified) {
                const oldTask = tasksById[taskId]
                estimationByDate[date] -= getEstimationRealValue(projectId, oldTask.estimations[OPEN_STEP])
                tasks[date] = tasks[date].filter(taskItem => taskItem.id !== taskId)
                estimationByDate[date] += getEstimationRealValue(projectId, task.estimations[OPEN_STEP])
                tasks[date] = tasks[date].concat(task)
                tasksById[taskId] = task
                if (tasks[date].length > 1) datesToSort.add(date)
                if (inAllProjects && lastDoneDate < completedTimestamp) lastDoneDate = completedTimestamp
            } else if (taskAdded) {
                tasksById[taskId] = task
                if (inAllProjects && lastDoneDate < completedTimestamp) lastDoneDate = completedTimestamp
                if (!tasks[date]) tasks[date] = []
                if (!estimationByDate[date]) estimationByDate[date] = ESTIMATION_0_MIN
                estimationByDate[date] += getEstimationRealValue(projectId, task.estimations[OPEN_STEP])
                tasks[date] = tasks[date].concat(task)
                if (tasks[date].length > 1) datesToSort.add(date)
            } else {
                estimationByDate[date] -= getEstimationRealValue(projectId, task.estimations[OPEN_STEP])
                tasks[date] = tasks[date].filter(taskItem => taskItem.id !== taskId)
                delete tasksById[taskId]
                if (tasks[date].length <= 1) {
                    if (tasks[date].length === 0) {
                        delete tasks[date]
                        delete estimationByDate[date]
                    }
                    datesToSort.delete(date)
                }
                if (inAllProjects && lastDoneDate === completedTimestamp) {
                    lastEditedDateRemoved = true
                }
            }
        }

        for (let date of datesToSort) {
            tasks[date].sort(TasksHelper.sortWorkflowAndDoneTasksFn)
        }

        const dates = Object.keys(tasks)

        if (inAllProjects) {
            if (dates.length === 0) {
                lastDoneDate = moment('01-01-1970', 'DD-MM-YYYY').valueOf()
            } else if (lastEditedDateRemoved) {
                const tasksList = Object.values(tasks).flat()
                tasksList.sort(TasksHelper.sortWorkflowAndDoneTasksFn)
                lastDoneDate = tasksList[0].completed
            }
            store.dispatch(updateUserProject({ ...project, lastDoneDate }))
        }

        storedTasks = tasks
    }

    const getEarlierCompletedDateToCheck = docs => {
        if (docs.length > 0) {
            return docs[docs.length - 1].data().completed
        } else {
            return moment().valueOf()
        }
    }

    let cacheChanges = []
    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', currentUserId)
        .where('done', '==', true)
        .where('completed', '<=', endOfToday)
        .where('parentId', '==', null)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .orderBy('completed', 'desc')
        .limit(tasksAmountToWatch)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            const changes = querySnapshot.docChanges()
            if (querySnapshot.metadata.fromCache) {
                cacheChanges = [...cacheChanges, ...changes]
            } else {
                const mergedChanges = [...cacheChanges, ...changes]
                if (mergedChanges.length > 0) {
                    updateLastTwoWeeksTasks(mergedChanges)
                    const tasksByDate = Object.entries(storedTasks).sort((a, b) => b[0] - a[0])
                    const earlierCompletedDateToCheck = getEarlierCompletedDateToCheck(querySnapshot.docs)
                    callback(tasksByDate, estimationByDate, querySnapshot.docs.length, earlierCompletedDateToCheck)
                    cacheChanges = []
                }
                store.dispatch(stopLoadingData())
            }
        })
}

export function watchEarlierDoneSubtasks(project, watcherKey, callback, completedDateToCheck) {
    let subtasksByParentId = {}

    const updateLastTwoWeeksSubtasks = changes => {
        const subtasks = { ...subtasksByParentId }
        const subtasksListToSortParentsId = new Set()

        for (let change of changes) {
            const subtaskId = change.doc.id
            const type = change.type

            const subtask = mapTaskData(subtaskId, change.doc.data())
            const parentId = subtask.parentId

            if (type === 'modified') {
                subtasks[parentId] = subtasks[parentId].filter(taskItem => taskItem.id !== subtaskId)
                subtasks[parentId] = subtasks[parentId].concat(subtask)
                if (subtasks[parentId].length > 1) subtasksListToSortParentsId.add(parentId)
            } else if (type === 'added') {
                if (!subtasks[parentId]) subtasks[parentId] = []
                subtasks[parentId] = subtasks[parentId].concat(subtask)
                if (subtasks[parentId].length > 1) subtasksListToSortParentsId.add(parentId)
            } else {
                subtasks[parentId] = subtasks[parentId].filter(taskItem => taskItem.id !== subtaskId)
                if (subtasks[parentId].length <= 1) {
                    if (subtasks[parentId].length === 0) delete subtasks[parentId]
                    subtasksListToSortParentsId.delete(parentId)
                }
            }
        }

        for (let parentId of subtasksListToSortParentsId) {
            subtasks[parentId].sort(TasksHelper.sortSubtasks)
        }

        subtasksByParentId = subtasks
    }

    let cacheChanges = []

    const { currentUser, loggedUser } = store.getState()
    const projectId = project.id
    const currentUserId = currentUser.uid
    const loggedUserId = loggedUser.uid
    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', currentUserId)
        .where('parentDone', '==', true)
        .where('completed', '>=', completedDateToCheck)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
            const changes = querySnapshot.docChanges()
            if (querySnapshot.metadata.fromCache) {
                cacheChanges = [...cacheChanges, ...changes]
            } else {
                const mergedChanges = [...cacheChanges, ...changes]
                if (mergedChanges.length > 0) updateLastTwoWeeksSubtasks(mergedChanges)
                store.dispatch(stopLoadingData())
                callback(subtasksByParentId)
                cacheChanges = []
            }
        })
}

export function watchIfNeedToShowTheShowMoreButton(projectId, watcherKey, callback, completedDateToCheck) {
    const { currentUser, loggedUser } = store.getState()
    const currentUserId = currentUser.uid
    const loggedUserId = loggedUser.uid

    const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('userId', '==', currentUserId)
        .where('inDone', '==', true)
        .where('completed', '<', completedDateToCheck)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .limit(1)
        .onSnapshot(querySnapshot => {
            callback(querySnapshot.docs.length > 0)
        })
}
