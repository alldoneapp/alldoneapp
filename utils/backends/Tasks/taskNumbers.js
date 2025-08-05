import moment from 'moment'
import { cloneDeep, isEqual } from 'lodash'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import store from '../../../redux/store'
import {
    setWorkflowTasksAmount,
    setDoneTasksAmount,
    setOpenTasksAmount,
    setSidebarNumbers,
} from '../../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../../components/Workstreams/WorkstreamHelper'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'

export const watchWorkflowTasksAmount = (projectIds, userId, watcherKeys) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const amountsByProject = { total: 0 }

    projectIds.forEach((projectId, index) => {
        globalWatcherUnsub[watcherKeys[index]] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('userId', '==', userId)
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('currentReviewerId', '!=', userId)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .onSnapshot(snapshot => {
                const newAmount = snapshot.docs.length
                const previousAmount = amountsByProject[projectId]
                if (newAmount !== previousAmount) {
                    if (previousAmount) amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId] = newAmount
                    store.dispatch(setWorkflowTasksAmount(amountsByProject.total))
                }
            })
    })
}

export const unwatchWorkflowTasksAmount = watcherKeys => {
    if (watcherKeys.length > 0) {
        watcherKeys.forEach(watcherKey => {
            globalWatcherUnsub[watcherKey]()
        })
        store.dispatch(setWorkflowTasksAmount(null))
    }
}

export const watchDoneTasksAmount = (projectIds, userId, watcherKeys) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const amountsByProject = { total: 0 }

    const dateEndToday = moment().endOf('day').valueOf()
    const dateStartToday = moment().startOf('day').valueOf()

    projectIds.forEach((projectId, index) => {
        globalWatcherUnsub[watcherKeys[index]] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('userId', '==', userId)
            .where('done', '==', true)
            .where('completed', '<=', dateEndToday)
            .where('completed', '>=', dateStartToday)
            .where('parentId', '==', null)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .onSnapshot(snapshot => {
                const newAmount = snapshot.docs.length
                const previousAmount = amountsByProject[projectId]
                if (newAmount !== previousAmount) {
                    if (previousAmount) amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId] = newAmount
                    store.dispatch(setDoneTasksAmount(amountsByProject.total))
                }
            })
    })
}

export const unwatchDoneTasksAmount = watcherKeys => {
    if (watcherKeys.length > 0) {
        watcherKeys.forEach(watcherKey => {
            globalWatcherUnsub[watcherKey]()
        })
        store.dispatch(setDoneTasksAmount(null))
    }
}

export const watchOpenTasksAmount = (
    projectIds,
    userId,
    countLaterTasks,
    countSomedayTasks,
    amountsByProject,
    watcherKeys
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    const dateEndToday = moment().endOf('day').valueOf()

    projectIds.forEach((projectId, index) => {
        let query = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('currentReviewerId', '==', userId)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
        if (!countLaterTasks && !countSomedayTasks) query = query.where('dueDate', '<=', dateEndToday)
        if (countLaterTasks && !countSomedayTasks) query = query.where('dueDate', '<', BACKLOG_DATE_NUMERIC)

        globalWatcherUnsub[watcherKeys[index]] = query.onSnapshot(snapshot => {
            if (!amountsByProject[projectId]) amountsByProject[projectId] = {}
            const newAmount = snapshot.docs.length
            const previousAmount = amountsByProject[projectId].normal ? amountsByProject[projectId].normal : 0

            if (newAmount !== previousAmount) {
                amountsByProject.total -= previousAmount
                amountsByProject.total += newAmount
                amountsByProject[projectId].normal = newAmount
                store.dispatch(setOpenTasksAmount(amountsByProject.total))
            }
        })
    })
}

export const unwatchOpenTasksAmount = watcherKeys => {
    watcherKeys.forEach(watcherKey => {
        globalWatcherUnsub[watcherKey]()
    })
    store.dispatch(setOpenTasksAmount(null))
}

export const watchObservedOpenTasksAmount = (
    projectIds,
    userId,
    countLaterTasks,
    countSomedayTasks,
    amountsByProject,
    watcherKeys
) => {
    projectIds.forEach((projectId, index) => {
        globalWatcherUnsub[watcherKeys[index]] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('observersIds', 'array-contains-any', [userId])
            .onSnapshot(snapshot => {
                let newAmount = 0
                snapshot.forEach(taskDoc => {
                    const needToCountTheTask = checkIfNeedCountObservedTasks(
                        mapTaskData(taskDoc.id, taskDoc.data()),
                        userId,
                        countLaterTasks,
                        countSomedayTasks
                    )
                    if (needToCountTheTask) newAmount++
                })

                if (!amountsByProject[projectId]) amountsByProject[projectId] = {}
                const previousAmount = amountsByProject[projectId].observed ? amountsByProject[projectId].observed : 0

                if (newAmount !== previousAmount) {
                    amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId].observed = newAmount
                    store.dispatch(setOpenTasksAmount(amountsByProject.total))
                }
            })
    })
}

const checkIfNeedCountObservedTasks = (task, userId, countLaterTasks, countSomedayTasks) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser
    const { dueDateByObserversIds, isPublicFor } = task
    const dateEndToday = moment().endOf('day').valueOf()

    const isPublicForLoggedUser =
        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || (!isAnonymous && isPublicFor.includes(loggedUserId))
    const taskIsTodayOrOverdue = dueDateByObserversIds[userId] <= dateEndToday
    const taskIsLaterTask = countLaterTasks && dueDateByObserversIds[userId] < BACKLOG_DATE_NUMERIC
    const needToBeListedInThisDates = countSomedayTasks || taskIsLaterTask || taskIsTodayOrOverdue
    const needToCountTheTask = isPublicForLoggedUser && needToBeListedInThisDates
    return needToCountTheTask
}

export const watchUserWorkstreamsOpenTasksAmount = (
    projectIds,
    userWorkstreams,
    countLaterTasks,
    countSomedayTasks,
    amountsByProject,
    watcherKeys
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    projectIds.forEach((projectId, index) => {
        const userWorkstreamIdsInProject =
            userWorkstreams && userWorkstreams[projectId] ? userWorkstreams[projectId] : []
        const userWorkstreamIds = [DEFAULT_WORKSTREAM_ID, ...userWorkstreamIdsInProject]

        const dateEndToday = moment().endOf('day').valueOf()

        userWorkstreamIds.forEach(wsId => {
            let query = getDb()
                .collection(`items/${projectId}/tasks`)
                .where('done', '==', false)
                .where('parentId', '==', null)
                .where('userId', '==', wsId)
                .where('currentReviewerId', '==', wsId)
                .where('isPublicFor', 'array-contains-any', allowUserIds)
            if (!countLaterTasks && !countSomedayTasks) query = query.where('dueDate', '<=', dateEndToday)
            if (countLaterTasks && !countSomedayTasks) query = query.where('dueDate', '<', BACKLOG_DATE_NUMERIC)

            globalWatcherUnsub[watcherKeys[index]] = query.onSnapshot(snapshot => {
                const newAmount = snapshot.docs.length
                if (!amountsByProject[projectId]) amountsByProject[projectId] = {}
                if (!amountsByProject[projectId].workstreams) amountsByProject[projectId].workstreams = {}
                if (!amountsByProject[projectId].workstreams[wsId]) amountsByProject[projectId].workstreams[wsId] = 0
                const previousAmount = amountsByProject[projectId].workstreams[wsId]

                if (newAmount !== previousAmount) {
                    amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId].workstreams[wsId] = newAmount
                    store.dispatch(setOpenTasksAmount(amountsByProject.total))
                }
            })
        })
    })
}

export const watchSidebarTasksAmount = (
    projectIds,
    workstreamsUsersIdsByProject,
    normalWatcherKeys,
    observedWatcherKeys
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    const dateEndToday = moment().endOf('day').valueOf()

    const usersTasksAmountByProject = {}
    const taskHistory = {}
    const observedTaskHistory = {}

    projectIds.forEach(projectId => {
        taskHistory[projectId] = {}
    })

    const increaseUserCount = (projectId, uid) => {
        usersTasksAmountByProject[projectId][uid]
            ? usersTasksAmountByProject[projectId][uid]++
            : (usersTasksAmountByProject[projectId][uid] = 1)
    }

    const packageAmountsInArray = () => {
        const usersTasksAmount = Object.values(usersTasksAmountByProject)
        usersTasksAmount.forEach((data, index) => {
            if (data.loadedRegular && data.loadedObserved) {
                const dataCopy = { ...data }
                delete dataCopy.loadedRegular
                delete dataCopy.loadedObserved
                const entries = Object.entries(dataCopy)
                usersTasksAmount[index] = entries.map(entry => {
                    entry[1] = entry[1].toString()
                    return entry
                })
            } else {
                usersTasksAmount[index] = [['loading']]
            }
        })
        return usersTasksAmount
    }

    const updateSidebarNumbers = (projectIds, amountsData) => {
        const { sidebarNumbers } = store.getState()
        const usersTodayTasksAmountsByProjects = {}
        projectIds.forEach((projectId, index) => {
            usersTodayTasksAmountsByProjects[projectId] = {}
            const usersAmounts = amountsData[index]
            if (usersAmounts?.[0]?.[0] === 'loading') {
                usersTodayTasksAmountsByProjects[projectId] = sidebarNumbers[projectId] ? sidebarNumbers[projectId] : {}
                usersTodayTasksAmountsByProjects.loading = true
            } else {
                usersAmounts &&
                    usersAmounts.forEach(usersAmountData => {
                        const uid = usersAmountData[0]
                        const amount = parseInt(usersAmountData[1])
                        usersTodayTasksAmountsByProjects[projectId][uid] = amount
                    })
            }
        })

        store.dispatch(setSidebarNumbers(usersTodayTasksAmountsByProjects))
    }

    projectIds.forEach((projectId, index) => {
        if (!usersTasksAmountByProject[projectId])
            usersTasksAmountByProject[projectId] = { loadedRegular: false, loadedObserved: false }
        const workstreamsUsersIds = workstreamsUsersIdsByProject[index]

        globalWatcherUnsub[normalWatcherKeys[index]] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('done', '==', false)
            .where('dueDate', '<=', dateEndToday)
            .where('parentId', '==', null)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .onSnapshot(snapshot => {
                const oldUsersTasksAmountByProject = cloneDeep(usersTasksAmountByProject)
                usersTasksAmountByProject[projectId].loadedRegular = true

                const needToCountInWorkstreamsUsers = task => {
                    const { userId } = task
                    return userId.startsWith(WORKSTREAM_ID_PREFIX)
                }

                const increaseWorksreamsUsersCount = (taskId, taskWsId) => {
                    let wsUsersIds = []
                    for (let i = 0; i < workstreamsUsersIds.length; i++) {
                        const wsData = workstreamsUsersIds[i]
                        const { wsId, userIds } = wsData
                        if (wsId === taskWsId) {
                            wsUsersIds = userIds
                            userIds.forEach(uid => {
                                usersTasksAmountByProject[projectId][uid]
                                    ? usersTasksAmountByProject[projectId][uid]++
                                    : (usersTasksAmountByProject[projectId][uid] = 1)
                            })
                            break
                        }
                    }
                    taskHistory[projectId][taskId].wsUsersIds = wsUsersIds
                }

                const decreaseWorksreamsUsersCount = wsUsersIds => {
                    wsUsersIds.forEach(uid => {
                        usersTasksAmountByProject[projectId][uid]--
                    })
                }

                const changes = snapshot.docChanges()
                changes.forEach(change => {
                    const taskId = change.doc.id
                    const task = mapTaskData(taskId, change.doc.data())
                    const { userIds, userId } = task
                    const lastUid = userIds[userIds.length - 1]

                    if (change.type === 'added') {
                        taskHistory[projectId][taskId] = { previousUid: lastUid, /*wsIds: [],*/ wsUsersIds: [] }
                        increaseUserCount(projectId, lastUid)
                        if (needToCountInWorkstreamsUsers(task)) increaseWorksreamsUsersCount(taskId, userId)
                    } else if (change.type === 'removed') {
                        if (taskHistory[projectId][taskId]) {
                            usersTasksAmountByProject[projectId][lastUid]--
                            decreaseWorksreamsUsersCount(taskHistory[projectId][taskId].wsUsersIds)
                            delete taskHistory[projectId][taskId]
                        }
                    } else {
                        if (taskHistory[projectId][taskId]) {
                            const previousUid = taskHistory[projectId][taskId].previousUid
                            if (
                                previousUid !== lastUid ||
                                taskHistory[projectId][taskId].wsUsersIds.length > 0 !==
                                    needToCountInWorkstreamsUsers(task)
                            ) {
                                decreaseWorksreamsUsersCount(taskHistory[projectId][taskId].wsUsersIds)
                                taskHistory[projectId][taskId].wsUsersIds = []
                                if (needToCountInWorkstreamsUsers(task)) increaseWorksreamsUsersCount(taskId, userId)
                            }
                            if (previousUid !== lastUid) {
                                usersTasksAmountByProject[projectId][previousUid]--
                                taskHistory[projectId][taskId].previousUid = lastUid
                                increaseUserCount(projectId, lastUid)
                            }
                        }
                    }
                })
                if (!isEqual(oldUsersTasksAmountByProject, usersTasksAmountByProject)) {
                    updateSidebarNumbers(projectIds, packageAmountsInArray())
                }
            })

        globalWatcherUnsub[observedWatcherKeys[index]] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('observersIds', '!=', [])
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .onSnapshot(snapshot => {
                const oldUsersTasksAmountByProject = cloneDeep(usersTasksAmountByProject)
                usersTasksAmountByProject[projectId].loadedObserved = true
                const addTask = (taskId, task) => {
                    const { dueDateByObserversIds, observersIds } = task
                    const observersIdsCounted = []
                    for (let observerId of observersIds) {
                        const needToCountInObserver = dueDateByObserversIds[observerId] < dateEndToday
                        if (needToCountInObserver) {
                            increaseUserCount(projectId, observerId)
                            observersIdsCounted.push(observerId)
                        }
                    }
                    if (observersIdsCounted.length > 0)
                        observedTaskHistory[taskId] = {
                            observersIds: observersIdsCounted,
                        }
                }

                const removeTask = taskId => {
                    const oldTaskData = observedTaskHistory[taskId]
                    if (oldTaskData) {
                        const { observersIds } = oldTaskData
                        observersIds.forEach(observerId => {
                            usersTasksAmountByProject[projectId][observerId]--
                        })
                        delete observedTaskHistory[taskId]
                    }
                }

                const changes = snapshot.docChanges()
                changes.forEach(change => {
                    const taskId = change.doc.id
                    const task = mapTaskData(taskId, change.doc.data())

                    if (change.type === 'added') {
                        addTask(taskId, task)
                    } else if (change.type === 'removed') {
                        removeTask(taskId)
                    } else {
                        removeTask(taskId)
                        addTask(taskId, task)
                    }
                })
                if (!isEqual(oldUsersTasksAmountByProject, usersTasksAmountByProject))
                    updateSidebarNumbers(projectIds, packageAmountsInArray())
            })
    })
}

export const unwatchSidebarTasksAmount = watcherKeys => {
    watcherKeys.forEach(watcherKey => {
        globalWatcherUnsub[watcherKey]()
    })
    store.dispatch(setSidebarNumbers({ loading: false }))
}
