import moment from 'moment'
import { orderBy } from 'lodash'

import {
    OBSERVED_TASKS_MY_DAY_TYPE,
    TO_ATTEND_TASKS_MY_DAY_TYPE,
    WORKSTREAM_TASKS_MY_DAY_TYPE,
} from '../../../../utils/backends/Tasks/myDayTasks'
import ProjectHelper, { ALL_PROJECTS_INDEX } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { DEFAULT_WORKSTREAM_ID } from '../../../Workstreams/WorkstreamHelper'
import store from '../../../../redux/store'
import { updateUserDataDirectly } from '../../../../utils/backends/Users/usersFirestore'
import { getDb, mapTaskData, mapUserData } from '../../../../utils/backends/firestore'
import {
    getTaskAutoEstimation,
    OPEN_STEP,
    TOGGLE_INDEX_DONE,
    TOGGLE_INDEX_OPEN,
    TOGGLE_INDEX_PENDING,
} from '../../../TaskListView/Utils/TasksHelper'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import { sortTaskByTime, sortTaskByTimeForSortingMode } from './myDayOpenTasksIntervals'
import { objectIsLocked } from '../../../Guides/guidesHelper'

export const TIME_FOR_CHECK_ACTIVE_TASK_ESTIMATION = 300000 //5 minutes

export const checkIfInMyDay = (
    selectedProjectIndex,
    showAllProjectsByTime,
    route,
    selectedSidebarTab,
    taskViewToggleIndex
) => {
    return (
        selectedProjectIndex === ALL_PROJECTS_INDEX &&
        showAllProjectsByTime &&
        route === DV_TAB_ROOT_TASKS &&
        selectedSidebarTab === DV_TAB_ROOT_TASKS &&
        (taskViewToggleIndex === TOGGLE_INDEX_OPEN ||
            taskViewToggleIndex === TOGGLE_INDEX_PENDING ||
            taskViewToggleIndex === TOGGLE_INDEX_DONE)
    )
}

export const checkIfInMyDayOpenTab = (
    selectedProjectIndex,
    showAllProjectsByTime,
    route,
    selectedSidebarTab,
    taskViewToggleIndex
) => {
    return (
        selectedProjectIndex === ALL_PROJECTS_INDEX &&
        showAllProjectsByTime &&
        route === DV_TAB_ROOT_TASKS &&
        selectedSidebarTab === DV_TAB_ROOT_TASKS &&
        taskViewToggleIndex === TOGGLE_INDEX_OPEN
    )
}

const getLastStateOfUserAndActiveTask = async (userId, transaction) => {
    let activeTask

    const userRef = getDb().doc(`/users/${userId}`)
    const userData = (await transaction.get(userRef)).data()
    const userLastState = userData ? mapUserData(userId, userData, false) : null

    if (userLastState) {
        const { activeTaskId, activeTaskProjectId } = userLastState
        if (activeTaskId && activeTaskProjectId) {
            const taskRef = getDb().doc(`items/${activeTaskProjectId}/tasks/${activeTaskId}`)
            const taskData = (await transaction.get(taskRef)).data()
            activeTask = taskData ? mapTaskData(activeTaskId, taskData) : null
        }
    }

    return { userLastState, activeTask }
}

export const processTaskEstimationWhenTimePass = async () => {
    getDb().runTransaction(async transaction => {
        const { loggedUser } = store.getState()
        const { userLastState, activeTask } = await getLastStateOfUserAndActiveTask(loggedUser.uid, transaction)

        if (userLastState) {
            const {
                activeTaskId,
                activeTaskProjectId,
                activeTaskStartingDate,
                activeTaskInitialEndingDate,
            } = userLastState

            const currentTime = moment().valueOf()
            const endOfWorkTime = moment().endOf('day').valueOf()
            const stillInWorkTime = currentTime < endOfWorkTime

            if (stillInWorkTime && activeTask && !activeTask.calendarData) {
                const { estimation, currentStepId, isObservedTask, isToReviewTask } = getEstimationToUse(
                    activeTask,
                    loggedUser.uid
                )

                if (getTaskAutoEstimation(activeTaskProjectId, estimation, activeTask.autoEstimation)) {
                    const MILLISECONDS_IN_MINUTE = 60000

                    if (currentTime > activeTaskInitialEndingDate) {
                        const { startDate } = getRoundedStartAndEndDates(activeTaskStartingDate, estimation)

                        const newEstimation = Math.floor((currentTime - startDate.valueOf()) / MILLISECONDS_IN_MINUTE)

                        if (newEstimation > estimation) {
                            const { estimationsByObserverIds, estimations } = activeTask

                            const taskData =
                                !isToReviewTask && isObservedTask
                                    ? {
                                          estimationsByObserverIds: {
                                              ...estimationsByObserverIds,
                                              [loggedUser.uid]: newEstimation,
                                          },
                                          metaData: { estimationExtendedInMyDay: true },
                                      }
                                    : {
                                          estimations: { ...estimations, [currentStepId]: newEstimation },
                                          metaData: { estimationExtendedInMyDay: true },
                                      }

                            transaction.update(
                                getDb().doc(`items/${activeTaskProjectId}/tasks/${activeTaskId}`),
                                taskData
                            )
                        }
                    }
                }
            }
        }
    })
}

const extractStartAndEndDateFromTask = task => {
    if (task.time) return task.time
    if (task.completedTime) {
        const { startTime, endTime } = task.completedTime
        return { startDate: moment(startTime), endDate: moment(endTime) }
    }
}

export const getPixelPerMinute = differenceTime => {
    let PIXEL_FOR_HOUR

    if (differenceTime <= 30) {
        PIXEL_FOR_HOUR = 150
    } else if (differenceTime <= 60) {
        PIXEL_FOR_HOUR = 120
    } else if (differenceTime <= 120) {
        PIXEL_FOR_HOUR = 90
    } else if (differenceTime <= 240) {
        PIXEL_FOR_HOUR = 60
    } else if (differenceTime <= 480) {
        PIXEL_FOR_HOUR = 50
    } else {
        PIXEL_FOR_HOUR = 40
    }

    const MINUTES_IN_HOUR = 60
    return PIXEL_FOR_HOUR / MINUTES_IN_HOUR
}

export const convertEstimationToPixels = task => {
    const INPUT_PADDING = 36
    const QUARTER_OF_HOUR = 15

    const { startDate, endDate } = extractStartAndEndDateFromTask(task)
    const differenceTime = endDate.diff(startDate, 'minutes')

    const pixelPerMinute = getPixelPerMinute(differenceTime)
    const MIN_HEIGHT_IN_CALENDAR_STYEL = pixelPerMinute * QUARTER_OF_HOUR

    if (differenceTime > QUARTER_OF_HOUR) {
        return pixelPerMinute * differenceTime + INPUT_PADDING
    } else {
        return MIN_HEIGHT_IN_CALENDAR_STYEL + INPUT_PADDING
    }
}

export const getEstimationToUse = (task, userId) => {
    const {
        stepHistory,
        estimations,
        estimationsByObserverIds,
        dueDateByObserversIds,
        userIds,
        currentReviewerId,
        dueDate,
        inDone,
    } = task

    const endOfDay = moment().endOf('day').valueOf()

    const isObservedTask = dueDateByObserversIds[userId] <= endOfDay && !inDone
    const isToReviewTask = userIds.length > 1 && currentReviewerId === userId && dueDate <= endOfDay && !inDone
    const isPending = userIds.length > 1 && currentReviewerId !== userId && dueDate <= endOfDay && !inDone

    if (inDone) {
        return { estimation: estimations[OPEN_STEP] || 0, inDone }
    } else if (isPending) {
        return { estimation: estimations[OPEN_STEP] || 0, isPending }
    } else if (isObservedTask && !isToReviewTask) {
        return { estimation: estimationsByObserverIds[userId] || 0, isObservedTask }
    } else {
        const currentStepId = stepHistory[stepHistory.length - 1]
        return { estimation: estimations[currentStepId] || 0, currentStepId, isToReviewTask }
    }
}

export const resetActiveTaskDatesIfTaskChanges = (oldTaskId, newActiveTask, userId) => {
    const newTaskId = newActiveTask ? newActiveTask.id : ''
    const newTaskProjectId = newActiveTask ? newActiveTask.projectId : ''

    if (oldTaskId !== newTaskId) {
        const newDate = moment().valueOf()

        const data = {
            activeTaskStartingDate: newDate,
            activeTaskInitialEndingDate: newDate,
            activeTaskId: newTaskId,
            activeTaskProjectId: newTaskProjectId,
        }

        if (newTaskId) {
            const { estimation } = getEstimationToUse(newActiveTask, userId)
            const { endDate } = getRoundedStartAndEndDates(newDate, estimation)

            data.activeTaskInitialEndingDate = endDate.valueOf()
        }

        updateUserDataDirectly(userId, data)
    }
}

const generateSubtasksMapAndEstimationData = (tasks, subtasksMapData) => {
    const subtasksMapByProject = {}
    const subtasksMapById = {}

    tasks.forEach(task => {
        const { projectId } = task

        if (subtasksMapData[task.id]) {
            if (subtasksMapByProject[projectId]) {
                subtasksMapByProject[projectId][task.id] = orderBy(
                    subtasksMapData[task.id],
                    [subtask => subtask.sortIndex],
                    ['desc']
                )
            } else {
                subtasksMapByProject[projectId] = {
                    [task.id]: orderBy(subtasksMapData[task.id], [subtask => subtask.sortIndex], ['desc']),
                }
            }
            subtasksMapByProject[projectId][task.id].forEach(subtask => {
                subtasksMapById[subtask.id] = subtask
            })
        }
    })

    return { subtasksMapByProject, subtasksMapById }
}

const extractAllTasksAndSubtasks = (user, projectIds, workstreams, todayTasks, administratorUserId, projectUsers) => {
    let allTasks = []
    let subtasksMap = {}

    for (let i = 0; i < projectIds.length; i++) {
        const projectId = projectIds[i]
        if (todayTasks[projectId]) {
            const taskInProject = []

            const workstreamIds = workstreams[projectId]
                ? [DEFAULT_WORKSTREAM_ID, ...workstreams[projectId]]
                : [DEFAULT_WORKSTREAM_ID]

            const toAttendTasks = todayTasks[projectId][TO_ATTEND_TASKS_MY_DAY_TYPE]
            const observedTasks = todayTasks[projectId][OBSERVED_TASKS_MY_DAY_TYPE]
            const workstreamTasks = todayTasks[projectId][WORKSTREAM_TASKS_MY_DAY_TYPE]

            taskInProject.push(...toAttendTasks.tasks)
            subtasksMap = { ...subtasksMap, ...toAttendTasks.subtasksMap }

            taskInProject.push(...observedTasks.tasks)
            subtasksMap = { ...subtasksMap, ...observedTasks.subtasksMap }

            for (let n = 0; n < workstreamIds.length; n++) {
                const workstreamId = workstreamIds[n]
                const wsTasks = workstreamTasks[workstreamId]
                if (wsTasks) {
                    taskInProject.push(...wsTasks.tasks)
                    subtasksMap = { ...subtasksMap, ...wsTasks.subtasksMap }
                }
            }

            if (projectId === user.inFocusTaskProjectId) {
                const focusedTaskIndex = taskInProject.findIndex(task => task.id === user.inFocusTaskId)
                if (focusedTaskIndex > 0) {
                    const focusedTask = taskInProject[focusedTaskIndex]
                    taskInProject.splice(focusedTaskIndex, 1)
                    taskInProject.unshift(focusedTask)
                }
            }
            allTasks.push(...taskInProject)
        }
    }

    const allTasksMap = {}
    allTasks = allTasks.filter(task => {
        if (allTasksMap[task.id]) return false

        const isLocked = objectIsLocked(
            task.projectId,
            user.unlockedKeysByGuides,
            task.lockKey,
            user.ownerId,
            user,
            administratorUserId,
            projectUsers
        )

        if (isLocked) {
            delete subtasksMap[task.id]
            return false
        }

        allTasksMap[task.id] = true
        return true
    })

    return { allTasks, subtasksMap }
}

const extractDataFromTasksObject = (user, loggedUserProjectsMap, allTasks, subtasksMap) => {
    const {
        selectedTasks,
        otherTasks,
        selectedTasksForSortingMode,
        otherTasksForSortingMode,
    } = selectTasksAndAddTimeIntervale(allTasks, user, loggedUserProjectsMap)

    const { subtasksMapByProject, subtasksMapById } = generateSubtasksMapAndEstimationData(
        [...selectedTasks, ...otherTasks],
        subtasksMap
    )

    return {
        selectedTasks,
        otherTasks,
        subtasksMapByProject,
        subtasksMapById,
        selectedTasksForSortingMode,
        otherTasksForSortingMode,
    }
}

export const selectTasksAndAddTimeIntervale = (tasks, user, loggedUserProjectsMap) => {
    const sortedTasks = orderBy(tasks, [task => task.sortIndex], ['desc'])

    const { selectedTasks, otherTasks } = sortTaskByTime(sortedTasks, user, loggedUserProjectsMap)

    const {
        selectedTasks: selectedTasksForSortingMode,
        otherTasks: otherTasksForSortingMode,
    } = sortTaskByTimeForSortingMode(sortedTasks, user, loggedUserProjectsMap)

    return { selectedTasks, otherTasks, selectedTasksForSortingMode, otherTasksForSortingMode }
}

export const getRoundedStartAndEndDates = (baseDate, estimation) => {
    const MIN_ESTIMATION = 15

    const startDate = roundDate(baseDate)

    const baseEndDate = moment(startDate).add(estimation > MIN_ESTIMATION ? estimation : MIN_ESTIMATION, 'minutes')
    const endDate = roundDate(baseEndDate)

    return { startDate, endDate, movedToNextDay: endDate.isAfter(startDate, 'day') }
}

export const roundDate = date => {
    const baseDate = moment(date)

    const startOfHour = moment(date).startOf('hour')
    const quarterOfHour = moment(date).startOf('hour').add(15, 'minutes')
    const middleOfHour = moment(date).startOf('hour').add(30, 'minutes')
    const quarterToHour = moment(date).startOf('hour').add(45, 'minutes')
    const endOfHour = moment(date).startOf('hour').add(1, 'hour')

    const startOfHourDifference = Math.abs(startOfHour.diff(baseDate, 'minutes'))
    const quarterOfHourDifference = Math.abs(quarterOfHour.diff(baseDate, 'minutes'))
    const middleOfHourDifference = Math.abs(middleOfHour.diff(baseDate, 'minutes'))
    const quarterToHourDifference = Math.abs(quarterToHour.diff(baseDate, 'minutes'))
    const endOfHourDifference = Math.abs(endOfHour.diff(baseDate, 'minutes'))

    let roundedDate

    const CLOSE_MINUTES_BOUNDRY = 5

    if (startOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = startOfHour
    } else if (quarterOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = quarterOfHour
    } else if (middleOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = middleOfHour
    } else if (quarterToHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = quarterToHour
    } else if (endOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = endOfHour
    } else if (baseDate.isBefore(quarterOfHour)) {
        roundedDate = quarterOfHour
    } else if (baseDate.isBefore(middleOfHour)) {
        roundedDate = middleOfHour
    } else if (baseDate.isBefore(quarterToHour)) {
        roundedDate = quarterToHour
    } else {
        roundedDate = endOfHour
    }

    return roundedDate
}

export const addProjectDataToMyDayData = (
    projectId,
    tasksType,
    workstreamId,
    tasks,
    subtasksMap,
    myDayAllTodayTasks
) => {
    const newMyDayAllTodayTasks = { ...myDayAllTodayTasks }

    if (!newMyDayAllTodayTasks[projectId]) {
        newMyDayAllTodayTasks[projectId] = {
            [TO_ATTEND_TASKS_MY_DAY_TYPE]: { tasks: [], subtasksMap: {} },
            [OBSERVED_TASKS_MY_DAY_TYPE]: { tasks: [], subtasksMap: {} },
            [WORKSTREAM_TASKS_MY_DAY_TYPE]: {},
        }
    }

    if (workstreamId) {
        newMyDayAllTodayTasks[projectId] = {
            ...newMyDayAllTodayTasks[projectId],
            [tasksType]: {
                ...newMyDayAllTodayTasks[projectId][tasksType],
                [workstreamId]: { tasks, subtasksMap },
            },
        }
    } else {
        newMyDayAllTodayTasks[projectId] = {
            ...newMyDayAllTodayTasks[projectId],
            [tasksType]: {
                tasks,
                subtasksMap,
                loaded: true,
            },
        }
    }

    return newMyDayAllTodayTasks
}

export const updateDataLoadedState = (myDayAllTodayTasks, user, loggedUserProjectsMap) => {
    const newMyDayAllTodayTasks = { ...myDayAllTodayTasks }

    const { projectIds, guideProjectIds, archivedProjectIds, templateProjectIds, workstreams } = user

    const userProjectIds = ProjectHelper.getNormalAndGuideProjects(
        projectIds,
        guideProjectIds,
        archivedProjectIds,
        templateProjectIds,
        loggedUserProjectsMap
    )

    let allProjectsLoaded = true

    userProjectIds.forEach(projectId => {
        const projectData = newMyDayAllTodayTasks[projectId]

        if (projectData) {
            if (!projectData.loaded) {
                let projectLoaded = true

                if (!projectData[TO_ATTEND_TASKS_MY_DAY_TYPE].loaded || !projectData[OBSERVED_TASKS_MY_DAY_TYPE].loaded)
                    projectLoaded = false

                if (projectLoaded) {
                    const workstreamsIds = workstreams[projectId]
                    const workstreamsToLoadIds = workstreamsIds
                        ? [DEFAULT_WORKSTREAM_ID, ...workstreamsIds]
                        : [DEFAULT_WORKSTREAM_ID]

                    workstreamsToLoadIds.forEach(workstreamId => {
                        if (!projectData[WORKSTREAM_TASKS_MY_DAY_TYPE][workstreamId]) projectLoaded = false
                    })
                }

                if (projectLoaded) {
                    newMyDayAllTodayTasks[projectId] = { ...newMyDayAllTodayTasks[projectId], loaded: true }
                } else {
                    allProjectsLoaded = false
                }
            }
        } else {
            allProjectsLoaded = false
        }
    })

    if (allProjectsLoaded) newMyDayAllTodayTasks.loaded = true

    return newMyDayAllTodayTasks
}

export const processMyDayData = (user, projectsMap, todayTasks, administratorUserId, projectUsers) => {
    const { projectIds, guideProjectIds, archivedProjectIds, templateProjectIds, workstreams } = user

    const sortedLoggedUserProjectIds = ProjectHelper.getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop(
        projectIds,
        guideProjectIds,
        archivedProjectIds,
        templateProjectIds,
        projectsMap,
        user.uid,
        user.inFocusTaskProjectId
    )

    const { allTasks, subtasksMap } = extractAllTasksAndSubtasks(
        user,
        sortedLoggedUserProjectIds,
        workstreams,
        todayTasks,
        administratorUserId,
        projectUsers
    )

    const {
        selectedTasks,
        otherTasks,
        subtasksMapByProject,
        subtasksMapById,
        selectedTasksForSortingMode,
        otherTasksForSortingMode,
    } = extractDataFromTasksObject(user, projectsMap, allTasks, subtasksMap)

    return {
        myDaySelectedTasks: selectedTasks,
        myDayOtherTasks: otherTasks,
        myDayOpenSubtasksMap: subtasksMapByProject,
        myDaySortingSubtasksMap: subtasksMapById,
        myDaySortingSelectedTasks: selectedTasksForSortingMode,
        myDaySortingOtherTasks: otherTasksForSortingMode,
    }
}

export const getProjectIdWhereCalendarIsConnected = apisConnected => {
    let projectIdWhereCalendarIsConnected = ''

    if (apisConnected) {
        const entries = Object.entries(apisConnected)
        entries.forEach(entry => {
            const projectId = entry[0]
            const isClendarConnected = entry[1].calendar
            if (isClendarConnected) projectIdWhereCalendarIsConnected = projectId
        })
    }

    return projectIdWhereCalendarIsConnected
}

export const getProjectIdWhereGmailIsConnected = apisConnected => {
    let projectIdWhereGmailIsConnected = ''

    if (apisConnected) {
        const entries = Object.entries(apisConnected)
        entries.forEach(entry => {
            const projectId = entry[0]
            const isGmailConnected = entry[1].gmail
            if (isGmailConnected) projectIdWhereGmailIsConnected = projectId
        })
    }

    return projectIdWhereGmailIsConnected
}
