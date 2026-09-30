import moment from 'moment'
import { cloneDeep, isEqual } from 'lodash'

import { getDb, globalWatcherUnsub, mapTaskData } from '../firestore'
import { getRoleIdsVisibleToField } from '../firestoreAccess'
import store from '../../../redux/store'
import {
    setWorkflowTasksAmount,
    setDoneTasksAmount,
    setOpenTasksAmount,
    setOpenTasksAmountLoaded,
    setSidebarNumbers,
} from '../../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../../components/Workstreams/WorkstreamHelper'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'
import { getTasksCompletedTodayQuery } from './myDayDoneTasks'

const countDocs = (snapshot, predicate) => snapshot.docs.filter(doc => predicate(doc.data() || {})).length

export const watchWorkflowTasksAmount = (projectIds, userId, watcherKeys) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser
    const currentUser = store.getState().currentUser
    const assistantOwner = currentUser?.uid === userId && !!currentUser.temperature

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const amountsByProject = { total: 0 }

    projectIds.forEach((projectId, index) => {
        const query = getDb()
            .collection(`items/${projectId}/tasks`)
            .where('userId', '==', userId)
            .where('done', '==', false)
            .where('parentId', '==', null)
            .where('currentReviewerId', '!=', userId)
            .where('readerIds', 'array-contains', allowUserIds[allowUserIds.length - 1])

        globalWatcherUnsub[watcherKeys[index]] = query.onSnapshot(snapshot => {
            const newAmount = assistantOwner
                ? snapshot.docs.filter(doc => doc.data()?.workflowTask === true).length
                : snapshot.docs.length
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
        // The same query as the My Day done list (one server target for both); a top-level task's
        // inDone always equals done, so filtering here gives exactly the old done==true count.
        globalWatcherUnsub[watcherKeys[index]] = getTasksCompletedTodayQuery(
            projectId,
            userId,
            allowUserIds[allowUserIds.length - 1],
            dateStartToday
        ).onSnapshot(snapshot => {
            const newAmount = countDocs(
                snapshot,
                task => task.done === true && task.parentId === null && task.completed <= dateEndToday
            )
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

/**
 * AT-2445 — every open-task count watcher reports its FIRST snapshot through this callback so the
 * board can tell "the inbox is empty" apart from "the inbox has not been counted yet".
 *
 * It is handed a token that is unique per QUERY, not per project: the workstream watcher opens one
 * query per workstream id, and counting projects there would report ready while queries are still
 * outstanding. The error branch reports too — a listener that was rejected is never going to
 * contribute a count, and leaving it outstanding would keep a genuinely empty board from ever
 * showing its congrats.
 */
/**
 * The open, top-level tasks of a project that are due today or overdue, for every assignee.
 *
 * Built in ONE place so that every counter asking a question about today uses a byte-identical
 * query. Firestore serves identical queries (same filters in the same order, same values) from a
 * single server target, so the sidebar numbers, today's open-task amount and today's workstream
 * amounts cost one listener per project instead of up to 2 + one per workstream. Callers filter the
 * assignee on the client. Do not reorder the clauses: the order is part of the query's identity.
 */
export const getTodayOpenTasksQuery = (projectId, readerId, dateEndToday) =>
    getDb()
        .collection(`items/${projectId}/tasks`)
        .where('done', '==', false)
        .where('dueDate', '<=', dateEndToday)
        .where('parentId', '==', null)
        .where('readerIds', 'array-contains', readerId)

const reportWatcherSettled = (onQuerySettled, token) => {
    if (typeof onQuerySettled === 'function') onQuerySettled(token)
}

export const watchOpenTasksAmount = (
    projectIds,
    userId,
    countLaterTasks,
    countSomedayTasks,
    amountsByProject,
    watcherKeys,
    onQuerySettled
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const dateEndToday = moment().endOf('day').valueOf()

    const readerId = allowUserIds[allowUserIds.length - 1]
    const countsTodayOnly = !countLaterTasks && !countSomedayTasks

    projectIds.forEach((projectId, index) => {
        let query
        if (countsTodayOnly) {
            // Shares the sidebar's per-project listener; see getTodayOpenTasksQuery.
            query = getTodayOpenTasksQuery(projectId, readerId, dateEndToday)
        } else {
            query = getDb()
                .collection(`items/${projectId}/tasks`)
                .where('done', '==', false)
                .where('parentId', '==', null)
                .where('currentReviewerId', '==', userId)
                .where('readerIds', 'array-contains', readerId)
            if (countLaterTasks && !countSomedayTasks) query = query.where('dueDate', '<', BACKLOG_DATE_NUMERIC)
        }

        globalWatcherUnsub[watcherKeys[index]] = query.onSnapshot(
            snapshot => {
                if (!amountsByProject[projectId]) amountsByProject[projectId] = {}
                const newAmount = countsTodayOnly
                    ? countDocs(snapshot, task => task.currentReviewerId === userId)
                    : snapshot.docs.length
                const previousAmount = amountsByProject[projectId].normal ? amountsByProject[projectId].normal : 0

                if (newAmount !== previousAmount) {
                    amountsByProject.total -= previousAmount
                    amountsByProject.total += newAmount
                    amountsByProject[projectId].normal = newAmount
                    store.dispatch(setOpenTasksAmount(amountsByProject.total))
                }
                reportWatcherSettled(onQuerySettled, watcherKeys[index])
            },
            () => reportWatcherSettled(onQuerySettled, watcherKeys[index])
        )
    })

    return watcherKeys.slice()
}

export const unwatchOpenTasksAmount = watcherKeys => {
    watcherKeys.forEach(watcherKey => {
        globalWatcherUnsub[watcherKey]()
    })
    store.dispatch(setOpenTasksAmount(null))
    // AT-2445: the total is about to be rebuilt from zero, so the board must stop trusting it until
    // the new watchers have reported. Resetting the amount without resetting this flag is exactly
    // the hole this change closes.
    store.dispatch(setOpenTasksAmountLoaded(false))
}

export const watchObservedOpenTasksAmount = (
    projectIds,
    userId,
    countLaterTasks,
    countSomedayTasks,
    amountsByProject,
    watcherKeys,
    onQuerySettled
) => {
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser
    const accessReaderId = isAnonymous ? FEED_PUBLIC_FOR_ALL : loggedUserId
    projectIds.forEach((projectId, index) => {
        globalWatcherUnsub[watcherKeys[index]] = getDb()
            .collection(`items/${projectId}/tasks`)
            .where(getRoleIdsVisibleToField(String(accessReaderId)), 'array-contains', userId)
            .onSnapshot(
                snapshot => {
                    let newAmount = 0
                    snapshot.forEach(taskDoc => {
                        const task = mapTaskData(taskDoc.id, taskDoc.data())
                        const needToCountTheTask =
                            task.done === false &&
                            task.parentId === null &&
                            checkIfNeedCountObservedTasks(task, userId, countLaterTasks, countSomedayTasks)
                        if (needToCountTheTask) newAmount++
                    })

                    if (!amountsByProject[projectId]) amountsByProject[projectId] = {}
                    const previousAmount = amountsByProject[projectId].observed
                        ? amountsByProject[projectId].observed
                        : 0

                    if (newAmount !== previousAmount) {
                        amountsByProject.total -= previousAmount
                        amountsByProject.total += newAmount
                        amountsByProject[projectId].observed = newAmount
                        store.dispatch(setOpenTasksAmount(amountsByProject.total))
                    }
                    reportWatcherSettled(onQuerySettled, watcherKeys[index])
                },
                () => reportWatcherSettled(onQuerySettled, watcherKeys[index])
            )
    })

    return watcherKeys.slice()
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
    watcherKeys,
    onQuerySettled
) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
    const readerId = allowUserIds[allowUserIds.length - 1]
    const queryTokens = []
    const countsTodayOnly = !countLaterTasks && !countSomedayTasks

    const applyWorkstreamAmount = (projectId, wsId, newAmount) => {
        if (!amountsByProject[projectId]) amountsByProject[projectId] = {}
        if (!amountsByProject[projectId].workstreams) amountsByProject[projectId].workstreams = {}
        if (!amountsByProject[projectId].workstreams[wsId]) amountsByProject[projectId].workstreams[wsId] = 0
        const previousAmount = amountsByProject[projectId].workstreams[wsId]
        if (newAmount === previousAmount) return false
        amountsByProject.total -= previousAmount
        amountsByProject.total += newAmount
        amountsByProject[projectId].workstreams[wsId] = newAmount
        return true
    }

    projectIds.forEach((projectId, index) => {
        const userWorkstreamIdsInProject =
            userWorkstreams && userWorkstreams[projectId] ? userWorkstreams[projectId] : []
        const userWorkstreamIds = [DEFAULT_WORKSTREAM_ID, ...userWorkstreamIdsInProject]

        const dateEndToday = moment().endOf('day').valueOf()

        if (countsTodayOnly) {
            // One shared listener per project answers every workstream at once (and is the same
            // server target as the sidebar numbers). It used to be one query per workstream id, all
            // stored under this single watcher key, so only the last of them could be unsubscribed.
            const queryToken = watcherKeys[index]
            queryTokens.push(queryToken)
            globalWatcherUnsub[watcherKeys[index]] = getTodayOpenTasksQuery(
                projectId,
                readerId,
                dateEndToday
            ).onSnapshot(
                snapshot => {
                    let changed = false
                    userWorkstreamIds.forEach(wsId => {
                        const amount = countDocs(
                            snapshot,
                            task => task.userId === wsId && task.currentReviewerId === wsId
                        )
                        if (applyWorkstreamAmount(projectId, wsId, amount)) changed = true
                    })
                    if (changed) store.dispatch(setOpenTasksAmount(amountsByProject.total))
                    reportWatcherSettled(onQuerySettled, queryToken)
                },
                () => reportWatcherSettled(onQuerySettled, queryToken)
            )
            return
        }

        const unsubscribers = []
        userWorkstreamIds.forEach(wsId => {
            let query = getDb()
                .collection(`items/${projectId}/tasks`)
                .where('done', '==', false)
                .where('parentId', '==', null)
                .where('userId', '==', wsId)
                .where('currentReviewerId', '==', wsId)
                .where('readerIds', 'array-contains', readerId)
            if (countLaterTasks && !countSomedayTasks) query = query.where('dueDate', '<', BACKLOG_DATE_NUMERIC)

            // One token per QUERY: this watcher opens one listener per workstream id but stores them
            // all under a single watcher key, so a per-project token would report ready while other
            // workstreams of the same project were still outstanding.
            const queryToken = `${watcherKeys[index]}:${wsId}`
            queryTokens.push(queryToken)

            unsubscribers.push(
                query.onSnapshot(
                    snapshot => {
                        if (applyWorkstreamAmount(projectId, wsId, snapshot.docs.length))
                            store.dispatch(setOpenTasksAmount(amountsByProject.total))
                        reportWatcherSettled(onQuerySettled, queryToken)
                    },
                    () => reportWatcherSettled(onQuerySettled, queryToken)
                )
            )
        })
        // All of this project's workstream listeners live under one watcher key.
        globalWatcherUnsub[watcherKeys[index]] = () => unsubscribers.forEach(unsubscribe => unsubscribe())
    })

    return queryTokens
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

    // Workstreams are filled progressively after the task-count listeners have
    // already started. Keep the mapping replaceable so that membership changes
    // can reuse the task history below instead of recreating every Firestore
    // listener for every project.
    let currentWorkstreamsUsersIdsByProject = workstreamsUsersIdsByProject
    const usersTasksAmountByProject = {}
    const taskHistory = {}
    const observedTaskHistory = {}
    const projectIndexById = new Map(projectIds.map((projectId, index) => [projectId, index]))

    projectIds.forEach(projectId => {
        taskHistory[projectId] = {}
    })

    const increaseUserCount = (projectId, uid) => {
        usersTasksAmountByProject[projectId][uid]
            ? usersTasksAmountByProject[projectId][uid]++
            : (usersTasksAmountByProject[projectId][uid] = 1)
    }

    const decreaseUserCount = (projectId, uid) => {
        if (!uid || !usersTasksAmountByProject[projectId]) return
        const currentAmount = usersTasksAmountByProject[projectId][uid] || 0
        usersTasksAmountByProject[projectId][uid] = Math.max(0, currentAmount - 1)
    }

    const getWorkstreamUserIds = (projectId, workstreamId) => {
        const projectIndex = projectIndexById.get(projectId)
        const workstreams = currentWorkstreamsUsersIdsByProject?.[projectIndex] || []
        const workstream = workstreams.find(data => data.wsId === workstreamId)
        return Array.isArray(workstream?.userIds) ? workstream.userIds : []
    }

    const setTaskWorkstreamUsers = (projectId, taskId, workstreamId) => {
        const history = taskHistory[projectId]?.[taskId]
        if (!history) return

        const previousUserIds = history.wsUsersIds || []
        const nextUserIds = workstreamId ? getWorkstreamUserIds(projectId, workstreamId) : []
        if (history.workstreamId === workstreamId && isEqual(previousUserIds, nextUserIds)) return

        previousUserIds.forEach(uid => decreaseUserCount(projectId, uid))
        nextUserIds.forEach(uid => increaseUserCount(projectId, uid))
        history.workstreamId = workstreamId
        history.wsUsersIds = [...nextUserIds]
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

        globalWatcherUnsub[normalWatcherKeys[index]] = getTodayOpenTasksQuery(
            projectId,
            allowUserIds[allowUserIds.length - 1],
            dateEndToday
        ).onSnapshot(snapshot => {
            const oldUsersTasksAmountByProject = cloneDeep(usersTasksAmountByProject)
            usersTasksAmountByProject[projectId].loadedRegular = true

            const needToCountInWorkstreamsUsers = task => {
                const { userId } = task
                return typeof userId === 'string' && userId.startsWith(WORKSTREAM_ID_PREFIX)
            }

            const changes = snapshot.docChanges()
            changes.forEach(change => {
                const taskId = change.doc.id
                const task = mapTaskData(taskId, change.doc.data())
                const { userId, currentReviewerId } = task
                const lastUid = currentReviewerId

                if (change.type === 'added') {
                    taskHistory[projectId][taskId] = {
                        previousUid: lastUid,
                        workstreamId: null,
                        wsUsersIds: [],
                    }
                    increaseUserCount(projectId, lastUid)
                    if (needToCountInWorkstreamsUsers(task)) setTaskWorkstreamUsers(projectId, taskId, userId)
                } else if (change.type === 'removed') {
                    const history = taskHistory[projectId][taskId]
                    if (history) {
                        decreaseUserCount(projectId, history.previousUid)
                        setTaskWorkstreamUsers(projectId, taskId, null)
                        delete taskHistory[projectId][taskId]
                    }
                } else {
                    const history = taskHistory[projectId][taskId]
                    if (history) {
                        const previousUid = history.previousUid
                        const nextWorkstreamId = needToCountInWorkstreamsUsers(task) ? userId : null
                        setTaskWorkstreamUsers(projectId, taskId, nextWorkstreamId)
                        if (previousUid !== lastUid) {
                            decreaseUserCount(projectId, previousUid)
                            history.previousUid = lastUid
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
            .where('readerIds', 'array-contains', allowUserIds[allowUserIds.length - 1])
            .onSnapshot(snapshot => {
                const oldUsersTasksAmountByProject = cloneDeep(usersTasksAmountByProject)
                usersTasksAmountByProject[projectId].loadedObserved = true
                const addTask = (taskId, task) => {
                    const { dueDateByObserversIds, observersIds } = task
                    const observersIdsCounted = []
                    for (let observerId of observersIds) {
                        const needToCountInObserver = dueDateByObserversIds[observerId] <= dateEndToday
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

    return {
        // Reassign only the workstream-derived portion of each affected task's
        // count. Direct and observed counts, listener ownership and confirmed
        // sidebar values stay intact throughout the boot-time warm-up.
        updateWorkstreamsUsersIdsByProject(nextWorkstreamsUsersIdsByProject) {
            const oldUsersTasksAmountByProject = cloneDeep(usersTasksAmountByProject)
            const previousWorkstreamsUsersIdsByProject = currentWorkstreamsUsersIdsByProject
            currentWorkstreamsUsersIdsByProject = nextWorkstreamsUsersIdsByProject

            projectIds.forEach((projectId, index) => {
                if (
                    isEqual(
                        previousWorkstreamsUsersIdsByProject?.[index] || [],
                        nextWorkstreamsUsersIdsByProject?.[index] || []
                    )
                ) {
                    return
                }
                Object.entries(taskHistory[projectId] || {}).forEach(([taskId, history]) => {
                    if (history.workstreamId) {
                        setTaskWorkstreamUsers(projectId, taskId, history.workstreamId)
                    }
                })
            })

            if (!isEqual(oldUsersTasksAmountByProject, usersTasksAmountByProject)) {
                updateSidebarNumbers(projectIds, packageAmountsInArray())
            }
        },
    }
}

export const clearSidebarTasksAmount = () => store.dispatch(setSidebarNumbers({ loading: false }))

export const unwatchSidebarTasksAmount = (watcherKeys, { clearNumbers = true } = {}) => {
    watcherKeys.forEach(watcherKey => {
        globalWatcherUnsub[watcherKey]()
    })
    if (clearNumbers) clearSidebarTasksAmount()
}
