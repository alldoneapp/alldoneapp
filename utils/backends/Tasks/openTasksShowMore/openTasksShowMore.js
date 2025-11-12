import moment from 'moment'

import { getDb, globalWatcherUnsub, mapGoalData, mapTaskData } from '../../firestore'
import { FEED_PUBLIC_FOR_ALL } from '../../../../components/Feeds/Utils/FeedsConstants'
import { BACKLOG_DATE_NUMERIC } from '../../../../components/TaskListView/Utils/TasksHelper'
import { DYNAMIC_PERCENT, getOwnerId } from '../../../../components/GoalsView/GoalsHelper'
import {
    GOALS_MY_DAY_TYPE,
    OBSERVED_TASKS_MY_DAY_TYPE,
    TO_ATTEND_TASKS_MY_DAY_TYPE,
    WORKSTREAM_TASKS_MY_DAY_TYPE,
} from '../myDayTasks'
import { setOpenTasksShowMoreDataInProject } from '../../../../redux/actions'
import store from '../../../../redux/store'

const getProjectDataStructure = (projectId, newOpenTasksShowMoreData) => {
    if (newOpenTasksShowMoreData[projectId]) return newOpenTasksShowMoreData[projectId]
    return {
        [TO_ATTEND_TASKS_MY_DAY_TYPE]: { hasTomorrowTasks: false, hasFutureTasks: false, hasSomedayTasks: false },
        [OBSERVED_TASKS_MY_DAY_TYPE]: { hasTomorrowTasks: false, hasFutureTasks: false, hasSomedayTasks: false },
        [WORKSTREAM_TASKS_MY_DAY_TYPE]: {},
        [GOALS_MY_DAY_TYPE]: { hasTomorrowTasks: false, hasFutureTasks: false, hasSomedayTasks: false },
        hasTomorrowTasks: false,
        hasFutureTasks: false,
        hasSomedayTasks: false,
    }
}

const updateProjectData = (
    newOpenTasksShowMoreData,
    projectId,
    tasksType,
    workstreamId,
    inSomeday,
    hasTasks,
    inTomorrow
) => {
    let projectData = getProjectDataStructure(projectId, newOpenTasksShowMoreData)

    if (tasksType === WORKSTREAM_TASKS_MY_DAY_TYPE) {
        let data = projectData[tasksType][workstreamId] || {
            hasTomorrowTasks: false,
            hasFutureTasks: false,
            hasSomedayTasks: false,
        }
        data = { ...data }
        if (inSomeday) {
            data.hasSomedayTasks = hasTasks
        } else if (inTomorrow) {
            data.hasTomorrowTasks = hasTasks
        } else {
            data.hasFutureTasks = hasTasks
        }

        projectData = {
            ...projectData,
            [tasksType]: {
                ...projectData[tasksType],
                [workstreamId]: data,
            },
        }
    } else {
        let data = { ...projectData[tasksType] }
        if (inSomeday) {
            data.hasSomedayTasks = hasTasks
        } else if (inTomorrow) {
            data.hasTomorrowTasks = hasTasks
        } else {
            data.hasFutureTasks = hasTasks
        }

        projectData = { ...projectData, [tasksType]: data }
    }

    newOpenTasksShowMoreData[projectId] = projectData
}

const updateGlobalData = (newOpenTasksShowMoreData, projectId, hasTasks, propertyName) => {
    const projectData = newOpenTasksShowMoreData[projectId]
    if (hasTasks) {
        projectData[propertyName] = true
        newOpenTasksShowMoreData[propertyName] = true
    } else {
        if (
            projectData[TO_ATTEND_TASKS_MY_DAY_TYPE][propertyName] ||
            projectData[OBSERVED_TASKS_MY_DAY_TYPE][propertyName] ||
            projectData[GOALS_MY_DAY_TYPE][propertyName]
        ) {
            projectData[propertyName] = true
            newOpenTasksShowMoreData[propertyName] = true
        } else {
            const workstreamsData = projectData[WORKSTREAM_TASKS_MY_DAY_TYPE]
            const workstreamIds = Object.keys(workstreamsData)
            const someHasTasks = workstreamIds.some(id => workstreamsData[id][propertyName])
            if (someHasTasks) {
                projectData[propertyName] = true
                newOpenTasksShowMoreData[propertyName] = true
            } else {
                projectData[propertyName] = false

                const projectIds = Object.keys(newOpenTasksShowMoreData)
                const someHasTasks = projectIds.some(id => newOpenTasksShowMoreData[id][propertyName])
                newOpenTasksShowMoreData[propertyName] = someHasTasks
            }
        }
    }
}

export const addProjectDataToOpenTasksShowMoreData = (
    projectId,
    tasksType,
    workstreamId,
    openTasksShowMoreData,
    inSomeday,
    hasTasks,
    inTomorrow
) => {
    const newOpenTasksShowMoreData = { ...openTasksShowMoreData }
    updateProjectData(newOpenTasksShowMoreData, projectId, tasksType, workstreamId, inSomeday, hasTasks, inTomorrow)

    if (inSomeday) {
        updateGlobalData(newOpenTasksShowMoreData, projectId, hasTasks, 'hasSomedayTasks')
    } else if (inTomorrow) {
        updateGlobalData(newOpenTasksShowMoreData, projectId, hasTasks, 'hasTomorrowTasks')
    } else {
        updateGlobalData(newOpenTasksShowMoreData, projectId, hasTasks, 'hasFutureTasks')
    }
    return newOpenTasksShowMoreData
}

const getAllowUserIds = (loggedUserId, isAnonymous) => {
    return isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]
}

const getBaseQuery = projectId => {
    return getDb().collection(`items/${projectId}/tasks`).where('inDone', '==', false).where('parentId', '==', null)
}

const getBaseQueryForTasksToAttend = (projectId, boardUserId, allowUserIds) => {
    return getBaseQuery(projectId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .where('currentReviewerId', '==', boardUserId)
}

const getBaseQueryForWorkstreamTasks = (projectId, workstreamId, allowUserIds) => {
    return getBaseQuery(projectId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .where('userId', '==', workstreamId)
}

export async function watchIfThereAreTomorrowTasksToAttend(
    projectId,
    boardUserId,
    isAnonymous,
    loggedUserId,
    watcherKey
) {
    const endOfDay = moment().endOf('day').valueOf()
    const endOfTomorrow = moment().endOf('day').add(1, 'day').valueOf()
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreTomorrowTasks = null

    globalWatcherUnsub[watcherKey] = getBaseQueryForTasksToAttend(projectId, boardUserId, allowUserIds)
        .where('dueDate', '>', endOfDay)
        .where('dueDate', '<=', endOfTomorrow)
        .limit(1)
        .onSnapshot(snapshot => {
            const thereAreTomorrowTasks = snapshot.docs.length > 0

            if (oldThereAreTomorrowTasks !== thereAreTomorrowTasks) {
                oldThereAreTomorrowTasks = thereAreTomorrowTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        TO_ATTEND_TASKS_MY_DAY_TYPE,
                        null,
                        false,
                        thereAreTomorrowTasks,
                        true
                    )
                )
            }
        })
}

export async function watchIfThereAreFutureTasksToAttend(
    projectId,
    boardUserId,
    isAnonymous,
    loggedUserId,
    watcherKey
) {
    const endOfDay = moment().endOf('day').valueOf()
    const endOfTomorrow = moment().endOf('day').add(1, 'day').valueOf()
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreFutureTasks = null

    globalWatcherUnsub[watcherKey] = getBaseQueryForTasksToAttend(projectId, boardUserId, allowUserIds)
        .where('dueDate', '>', endOfTomorrow)
        .where('dueDate', '<', BACKLOG_DATE_NUMERIC)
        .limit(1)
        .onSnapshot(snapshot => {
            const thereAreFutureTasks = snapshot.docs.length > 0

            if (oldThereAreFutureTasks !== thereAreFutureTasks) {
                oldThereAreFutureTasks = thereAreFutureTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        TO_ATTEND_TASKS_MY_DAY_TYPE,
                        null,
                        false,
                        thereAreFutureTasks
                    )
                )
            }
        })
}

export async function watchIfThereAreSomedayTasksToAttend(
    projectId,
    boardUserId,
    isAnonymous,
    loggedUserId,
    watcherKey
) {
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreSomedayTasks = null

    globalWatcherUnsub[watcherKey] = getBaseQueryForTasksToAttend(projectId, boardUserId, allowUserIds)
        .where('dueDate', '==', BACKLOG_DATE_NUMERIC)
        .limit(1)
        .onSnapshot(snapshot => {
            const thereAreSomedayTasks = snapshot.docs.length > 0

            if (oldThereAreSomedayTasks !== thereAreSomedayTasks) {
                oldThereAreSomedayTasks = thereAreSomedayTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        TO_ATTEND_TASKS_MY_DAY_TYPE,
                        null,
                        true,
                        thereAreSomedayTasks
                    )
                )
            }
        })
}

export async function watchIfThereAreFutureAndSomedayObservedTasks(
    projectId,
    boardUserId,
    isAnonymous,
    loggedUserId,
    watcherKey
) {
    const endOfDay = moment().endOf('day').valueOf()
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreFutureTasks = null
    let oldThereAreSomedayTasks = null

    globalWatcherUnsub[watcherKey] = getBaseQuery(projectId)
        .where('observersIds', 'array-contains-any', [boardUserId])
        .onSnapshot(snapshot => {
            let thereAreFutureTasks = false
            let thereAreSomedayTasks = false

            snapshot.forEach(doc => {
                const task = mapTaskData(doc.id, doc.data())
                const { isPublicFor, dueDateByObserversIds } = task

                if (dueDateByObserversIds[boardUserId] === BACKLOG_DATE_NUMERIC) {
                    if (isPublicFor.some(item => allowUserIds.includes(item))) {
                        thereAreSomedayTasks = true
                    }
                } else if (dueDateByObserversIds[boardUserId] > endOfDay) {
                    if (isPublicFor.some(item => allowUserIds.includes(item))) {
                        thereAreFutureTasks = true
                    }
                }
            })

            if (oldThereAreFutureTasks !== thereAreFutureTasks) {
                oldThereAreFutureTasks = thereAreFutureTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        OBSERVED_TASKS_MY_DAY_TYPE,
                        null,
                        false,
                        thereAreFutureTasks
                    )
                )
            }
            if (oldThereAreSomedayTasks !== thereAreSomedayTasks) {
                oldThereAreSomedayTasks = thereAreSomedayTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        OBSERVED_TASKS_MY_DAY_TYPE,
                        null,
                        true,
                        thereAreSomedayTasks
                    )
                )
            }
        })
}

export async function watchIfThereAreFutureWorkstreamTasks(
    projectId,
    workstreamId,
    isAnonymous,
    loggedUserId,
    watcherKey
) {
    const endOfDay = moment().endOf('day').valueOf()
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreFutureTasks = null

    globalWatcherUnsub[watcherKey] = getBaseQueryForWorkstreamTasks(projectId, workstreamId, allowUserIds)
        .where('dueDate', '>', endOfDay)
        .where('dueDate', '<', BACKLOG_DATE_NUMERIC)
        .limit(1)
        .onSnapshot(snapshot => {
            const thereAreFutureTasks = snapshot.docs.length > 0

            if (oldThereAreFutureTasks !== thereAreFutureTasks) {
                oldThereAreFutureTasks = thereAreFutureTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        WORKSTREAM_TASKS_MY_DAY_TYPE,
                        workstreamId,
                        false,
                        thereAreFutureTasks
                    )
                )
            }
        })
}

export async function watchIfThereAreSomedayWorkstreamTasks(
    projectId,
    workstreamId,
    isAnonymous,
    loggedUserId,
    watcherKey
) {
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreSomedayTasks = null

    globalWatcherUnsub[watcherKey] = getBaseQueryForWorkstreamTasks(projectId, workstreamId, allowUserIds)
        .where('dueDate', '==', BACKLOG_DATE_NUMERIC)
        .limit(1)
        .onSnapshot(snapshot => {
            const thereAreSomedayTasks = snapshot.docs.length > 0

            if (oldThereAreSomedayTasks !== thereAreSomedayTasks) {
                oldThereAreSomedayTasks = thereAreSomedayTasks
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        WORKSTREAM_TASKS_MY_DAY_TYPE,
                        workstreamId,
                        true,
                        thereAreSomedayTasks
                    )
                )
            }
        })
}

export const watchIfThereAreFutureAndSomedayEmptyGoals = (
    projectId,
    boardUserId,
    isAnonymous,
    loggedUserId,
    watcherKey
) => {
    const endOfDay = moment().endOf('day').valueOf()
    const ownerId = getOwnerId(projectId, boardUserId)
    const allowUserIds = getAllowUserIds(loggedUserId, isAnonymous)
    let oldThereAreFutureEmptyGoals = null
    let oldThereAreSomedayEmptyGoals = null

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goals/${projectId}/items`)
        .where('progress', '!=', 100)
        .where('assigneesIds', 'array-contains-any', [boardUserId])
        .where('ownerId', '==', ownerId)
        .onSnapshot(docs => {
            let thereAreFutureEmptyGoals = false
            let thereAreSomedayEmptyGoals = false
            docs.forEach(doc => {
                if (!thereAreFutureEmptyGoals && !thereAreSomedayEmptyGoals) {
                    const goal = mapGoalData(doc.id, doc.data())
                    const { assigneesReminderDate, progress, dynamicProgress, isPublicFor } = goal
                    const isDynamicCompletedGoal = progress === DYNAMIC_PERCENT && dynamicProgress === 100
                    const isPublic = isPublicFor.some(item => allowUserIds.includes(item))

                    const isLaterGoal =
                        assigneesReminderDate[boardUserId] > endOfDay &&
                        assigneesReminderDate[boardUserId] < BACKLOG_DATE_NUMERIC
                    if (!isDynamicCompletedGoal && isLaterGoal && isPublic) thereAreFutureEmptyGoals = true
                    const isSomedayGoal = assigneesReminderDate[boardUserId] === BACKLOG_DATE_NUMERIC
                    if (!isDynamicCompletedGoal && isSomedayGoal && isPublic) thereAreSomedayEmptyGoals = true
                }
            })
            if (oldThereAreFutureEmptyGoals !== thereAreFutureEmptyGoals) {
                oldThereAreFutureEmptyGoals = thereAreFutureEmptyGoals
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        GOALS_MY_DAY_TYPE,
                        null,
                        false,
                        thereAreFutureEmptyGoals
                    )
                )
            }
            if (oldThereAreSomedayEmptyGoals !== thereAreSomedayEmptyGoals) {
                oldThereAreSomedayEmptyGoals = thereAreSomedayEmptyGoals
                store.dispatch(
                    setOpenTasksShowMoreDataInProject(
                        projectId,
                        GOALS_MY_DAY_TYPE,
                        null,
                        true,
                        thereAreSomedayEmptyGoals
                    )
                )
            }
        })
}
