import moment from 'moment'
import { cloneDeep, flow, isEqual, orderBy, set as setProperty, size, sortBy } from 'lodash'

import { getDb, mapTaskData, mapGoalData, mapMilestoneData, globalWatcherUnsub } from './firestore'
import store from '../../redux/store'
import {
    setGlobalDataByProject,
    setOpenSubtasksMap,
    setOpenTasksMap,
    setTaskListWatchersVars,
    startLoadingData,
    stopLoadingData,
    updateSubtaskByTask,
    setLaterTasksExpanded,
    updateFilteredOpenTasks,
    updateThereAreHiddenNotMainTasks,
    updateInitialLoadingEndOpenTasks,
    updateInitialLoadingEndObservedTasks,
    setTodayEmptyGoalsTotalAmountInOpenTasksView,
    updateThereAreNotTasksInFirstDay,
    updateOpenTasks,
    setOpenMilestonesInProjectInTasks,
    setDoneMilestonesInProjectInTasks,
    setGoalsInProjectInTasks,
    setSomedayTasksExpanded,
} from '../../redux/actions'
import { FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import { BACKLOG_DATE_NUMERIC, BACKLOG_DATE_STRING } from '../../components/TaskListView/Utils/TasksHelper'
import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../components/Workstreams/WorkstreamHelper'
import { BACKLOG_MILESTONE_ID, DYNAMIC_PERCENT, getOwnerId } from '../../components/GoalsView/GoalsHelper'
import { ESTIMATION_0_MIN, getEstimationRealValue } from '../EstimationHelper'
import { filterOpenTasks } from '../../components/HashtagFilters/FilterHelpers/FilterTasks'

export const TODAY_DATE = '0'

export const DATE_TASK_INDEX = 0
export const AMOUNT_TASKS_INDEX = 1
export const ESTIMATION_TASKS_INDEX = 2
export const MAIN_TASK_INDEX = 3
export const MENTION_TASK_INDEX = 4
export const SUGGESTED_TASK_INDEX = 5
export const WORKFLOW_TASK_INDEX = 6
export const OBSERVED_TASKS_INDEX = 7
export const STREAM_AND_USER_TASKS_INDEX = 8
export const ACTIVE_GOALS_INDEX = 9
export const CALENDAR_TASK_INDEX = 10
export const EMAIL_TASK_INDEX = 11
export const EMPTY_SECTION_INDEX = 12

export const NOT_PARENT_GOAL_INDEX = '0'

let userOpenTasks = {}
let userObservedTasks = {}
let streamAndUserOpenTasks = {}

const activeMilestoneEmptyGoals = {}

export const WATCHER_VARS_DEFAULT = {
    storedTasks: {},
    estimationByDate: {},
    amountOfTasksByDate: {},
    tasksMap: {
        observedTasksById: {},
        userTasksById: {},
        streamAndUserTasksById: {},
    },
    subtasksByParentId: {},
    subtasksMap: { observedSubtasksById: {}, userSubtasksById: {}, streamAndUserSubtasksById: {} },
}

//OPEN TASKS WATCHERS
export const unwatchOpenTasks = (projectId, currentUserId) => {
    const { globalDataByProject } = store.getState()
    delete globalDataByProject[projectId]

    store.dispatch(setGlobalDataByProject(globalDataByProject))

    unwatch(projectId, currentUserId, userOpenTasks)
    unwatch(projectId, currentUserId, userObservedTasks)
    unwatch(projectId, currentUserId, streamAndUserOpenTasks)

    unwatchEmptyGoalsWatcher(projectId, currentUserId, activeMilestoneEmptyGoals)
}

export const watchOpenTasks = (projectId, callback, showLaterTasks, showSomedayTasks, keepMainDayData, instanceKey) => {
    const { currentUser, taskListWatchersVars, globalDataByProject } = store.getState()

    let storedTasks = {}
    let estimationByDate = {}
    let amountOfTasksByDate = {}
    let tasksMap = {
        observedTasksById: {},
        userTasksById: {},
        streamAndUserTasksById: {},
    }
    let goalsMap = {}

    let subtasksByParentId = {}
    let subtasksMap = { observedSubtasksById: {}, userSubtasksById: {}, streamAndUserSubtasksById: {} }

    // Reset vars at the beginning
    store.dispatch(
        setTaskListWatchersVars({
            ...taskListWatchersVars,
            storedTasks,
            estimationByDate,
            amountOfTasksByDate,
            tasksMap,
            subtasksByParentId,
            subtasksMap,
        })
    )

    if (keepMainDayData) {
        const currentGlobalData = globalDataByProject[projectId]
        const mainDayDate = TODAY_DATE

        const storedTasksMainDay = currentGlobalData.storedTasks[mainDayDate]
        storedTasks = storedTasksMainDay ? { [mainDayDate]: storedTasksMainDay } : {}

        const estimationMainDay = currentGlobalData.estimationByDate[mainDayDate]
        estimationByDate = estimationMainDay ? { [mainDayDate]: estimationMainDay } : {}

        const amountOfTasksMainDay = currentGlobalData.amountOfTasksByDate[mainDayDate]
        amountOfTasksByDate = amountOfTasksMainDay ? { [mainDayDate]: amountOfTasksMainDay } : {}

        const date = moment()
        const endOfDay = date.endOf('day').valueOf()

        tasksMap = {
            observedTasksById: flow([
                Object.entries,
                arr =>
                    arr.filter(([key, task]) => {
                        return task.dueDateByObserversIds[currentUser.uid] <= endOfDay
                    }),
                Object.fromEntries,
            ])(currentGlobalData.tasksMap.observedTasksById),
            userTasksById: flow([
                Object.entries,
                arr =>
                    arr.filter(([key, task]) => {
                        return task.dueDate <= endOfDay
                    }),
                Object.fromEntries,
            ])(currentGlobalData.tasksMap.userTasksById),
            streamAndUserTasksById: flow([
                Object.entries,
                arr =>
                    arr.filter(([key, task]) => {
                        return task.dueDate <= endOfDay
                    }),
                Object.fromEntries,
            ])(currentGlobalData.tasksMap.streamAndUserTasksById),
        }

        goalsMap = flow([
            Object.entries,
            arr =>
                arr.filter(([key, goal]) => {
                    return (
                        goal.assigneesReminderDate[currentUser.uid] !== BACKLOG_DATE_NUMERIC &&
                        goal.assigneesReminderDate[currentUser.uid] <= endOfDay
                    )
                }),
            Object.fromEntries,
        ])(currentGlobalData.goalsMap)
    }

    unwatchOpenTasks(projectId, currentUser.uid)
    const globalData = { storedTasks, estimationByDate, amountOfTasksByDate, tasksMap, goalsMap }

    store.dispatch(setGlobalDataByProject({ ...globalDataByProject, [projectId]: globalData }))

    watchUserOpenTasks(
        projectId,
        callback,
        storedTasks,
        estimationByDate,
        amountOfTasksByDate,
        tasksMap,
        false,
        instanceKey,
        showLaterTasks,
        showSomedayTasks,
        subtasksByParentId,
        subtasksMap
    )
    watchUserOpenTasks(
        projectId,
        callback,
        storedTasks,
        estimationByDate,
        amountOfTasksByDate,
        tasksMap,
        true,
        instanceKey,
        showLaterTasks,
        showSomedayTasks,
        subtasksByParentId,
        subtasksMap
    )

    watchStreamAndUserOpenTasksInBatches(
        projectId,
        callback,
        storedTasks,
        estimationByDate,
        amountOfTasksByDate,
        tasksMap,
        showLaterTasks,
        showSomedayTasks,
        subtasksByParentId,
        subtasksMap
    )

    watchEmptyGoals(
        projectId,
        callback,
        storedTasks,
        goalsMap,
        showLaterTasks,
        showSomedayTasks,
        estimationByDate,
        amountOfTasksByDate
    )

    // Save vars at the end
    store.dispatch(
        setTaskListWatchersVars({
            ...taskListWatchersVars,
            storedTasks,
            estimationByDate,
            amountOfTasksByDate,
            tasksMap,
            subtasksByParentId,
            subtasksMap,
        })
    )
}

const getOpenTasksQuery = (
    projectId,
    areObservedTasks,
    showLaterTasks,
    showSomedayTasks,
    currentUserId,
    loggedUser,
    endOfDay
) => {
    const { uid: loggedUserId, isAnonymous } = loggedUser
    let query = getDb().collection(`items/${projectId}/tasks`).where('inDone', '==', false)
    if (areObservedTasks) {
        query = query.where('observersIds', 'array-contains-any', [currentUserId])
    } else {
        const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

        query = query
            .where('currentReviewerId', '==', currentUserId)
            .where('isPublicFor', 'array-contains-any', allowUserIds)

        if (!showLaterTasks && !showSomedayTasks) query = query.where('dueDate', '<=', endOfDay)
        if (showLaterTasks && !showSomedayTasks) query = query.where('dueDate', '<', BACKLOG_DATE_NUMERIC)
    }
    return query
}

const watchUserOpenTasks = (
    projectId,
    callback,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    tasksMap,
    areObservedTasks,
    instanceKey,
    showLaterTasks,
    showSomedayTasks,
    subtasksByParentId,
    subtasksMap
) => {
    if (!areObservedTasks)
        setTimeout(() => {
            store.dispatch(startLoadingData())
        })
    const { currentUser, loggedUser } = store.getState()
    const currentUserId = currentUser.uid

    const date = moment()
    const endOfDay = date.endOf('day').valueOf()
    const dayDateFormated = TODAY_DATE

    let query = getOpenTasksQuery(
        projectId,
        areObservedTasks,
        showLaterTasks,
        showSomedayTasks,
        currentUserId,
        loggedUser,
        endOfDay
    )

    let cacheChanges = []
    const unsub = query.onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
        const changes = querySnapshot.docChanges()
        if (querySnapshot.metadata.fromCache) {
            cacheChanges = [...cacheChanges, ...changes]
        } else {
            const mergedChanges = [...cacheChanges, ...changes]

            let subtasks = { ...subtasksByParentId }

            if (mergedChanges.length > 0) {
                const { openTasksArray, subtasksByTasks } = processTaskChanges(
                    projectId,
                    mergedChanges,
                    loggedUser,
                    currentUserId,
                    endOfDay,
                    storedTasks,
                    estimationByDate,
                    amountOfTasksByDate,
                    tasksMap,
                    areObservedTasks,
                    false,
                    dayDateFormated,
                    showLaterTasks,
                    showSomedayTasks,
                    subtasksByParentId,
                    subtasksMap
                )
                subtasks = subtasksByTasks
                callback(openTasksArray, !areObservedTasks)
                store.dispatch(setOpenTasksMap(projectId, { ...tasksMap.observedTasksById, ...tasksMap.userTasksById }))
            } else if (Object.keys(storedTasks).length === 0) {
                callback([[dayDateFormated, 0, 0, [], [], [], [], [], [], [], [], [], []]], !areObservedTasks)
                store.dispatch(setOpenTasksMap(projectId, {}))
            } else if (areObservedTasks) {
                store.dispatch(updateInitialLoadingEndObservedTasks(instanceKey, true))
            }

            store.dispatch(stopLoadingData())

            store.dispatch(
                setOpenSubtasksMap(projectId, {
                    ...subtasksMap.observedSubtasksById,
                    ...subtasksMap.userSubtasksById,
                    ...subtasksMap.streamAndUserSubtasksById,
                })
            )

            store.dispatch(updateSubtaskByTask(instanceKey, subtasks))

            cacheChanges = []
        }
    })

    areObservedTasks
        ? (userObservedTasks[projectId] = { [currentUserId]: [unsub] })
        : (userOpenTasks[projectId] = { [currentUserId]: [unsub] })
}

export const getTaskTypeIndex = (task, areObservedTasks, areStreamAndUserTasks) => {
    const { genericData, suggestedBy, userIds, calendarData, gmailData } = task
    if (areObservedTasks) return OBSERVED_TASKS_INDEX
    if (areStreamAndUserTasks) return STREAM_AND_USER_TASKS_INDEX
    if (genericData) return MENTION_TASK_INDEX
    if (userIds.length > 1) return WORKFLOW_TASK_INDEX
    if (suggestedBy) return SUGGESTED_TASK_INDEX
    if (calendarData) return CALENDAR_TASK_INDEX
    if (gmailData) return EMAIL_TASK_INDEX
    return MAIN_TASK_INDEX
}

const processTaskChange = (
    projectId,
    loggedUser,
    currentUserId,
    endOfDay,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    tasksMap,
    areObservedTasks,
    areStreamAndUserTasks,
    dayDateFormated,
    showLaterTasks,
    showSomedayTasks,
    listsToSort,
    changeType,
    task
) => {
    const { uid: loggedUserId } = loggedUser

    const {
        estimations,
        stepHistory,
        suggestedBy,
        dueDate,
        dueDateByObserversIds,
        estimationsByObserverIds,
        userId,
        userIds,
        isPublicFor,
        parentGoalId,
        parentGoalIsPublicFor,
    } = task

    const taskParentGoalId =
        parentGoalId &&
        (parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) || parentGoalIsPublicFor.includes(loggedUserId))
            ? parentGoalId
            : NOT_PARENT_GOAL_INDEX
    const taskInBacklog = areObservedTasks
        ? dueDateByObserversIds[currentUserId] === Number.MAX_SAFE_INTEGER
        : dueDate === Number.MAX_SAFE_INTEGER
    const taskDueDate = areObservedTasks ? dueDateByObserversIds[currentUserId] : dueDate
    const taskIsTodayOrOverdue = taskDueDate <= endOfDay
    const taskIsLater = taskDueDate > endOfDay && !taskInBacklog

    const date = taskIsTodayOrOverdue
        ? dayDateFormated
        : taskInBacklog
        ? BACKLOG_DATE_STRING
        : moment(taskDueDate).format('YYYYMMDD')
    const taskTypeIndex = getTaskTypeIndex(task, areObservedTasks, areStreamAndUserTasks)
    const currentStepId = stepHistory[stepHistory.length - 1]

    const estimation = areObservedTasks
        ? estimationsByObserverIds[currentUserId]
            ? estimationsByObserverIds[currentUserId]
            : 0
        : estimations[currentStepId]
        ? estimations[currentStepId]
        : 0

    let innerGroupKey = ''
    if (taskTypeIndex === WORKFLOW_TASK_INDEX) {
        innerGroupKey = currentStepId
    } else if (taskTypeIndex === SUGGESTED_TASK_INDEX) {
        innerGroupKey = suggestedBy
    } else if (taskTypeIndex === OBSERVED_TASKS_INDEX) {
        innerGroupKey = userId
    } else if (taskTypeIndex === STREAM_AND_USER_TASKS_INDEX) {
        innerGroupKey = userId
    }
    const sortListKey = `${date}+${taskTypeIndex}+${innerGroupKey}+${taskParentGoalId}`
    const sortListValue = { date, taskTypeIndex, innerGroupKey, taskParentGoalId }

    let needToProcessTheTask = true
    if (taskTypeIndex === OBSERVED_TASKS_INDEX) {
        const isPublicForLoggedUser =
            isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || (!loggedUser.isAnonymous && isPublicFor.includes(loggedUserId))

        const needToBeListedInThisDate = showSomedayTasks || taskIsTodayOrOverdue || (showLaterTasks && taskIsLater)
        needToProcessTheTask = isPublicForLoggedUser && needToBeListedInThisDate
    }

    if (areStreamAndUserTasks) {
        needToProcessTheTask = userIds.length === 1
    }

    const addTask = () => {
        if (needToProcessTheTask) {
            if (!storedTasks[date]) {
                storedTasks[date] = {}
                estimationByDate[date] = ESTIMATION_0_MIN
                amountOfTasksByDate[date] = 0
            }

            estimationByDate[date] += getEstimationRealValue(projectId, estimation)

            amountOfTasksByDate[date]++

            if (innerGroupKey) {
                if (!storedTasks[date][taskTypeIndex]) storedTasks[date][taskTypeIndex] = {}
                if (!storedTasks[date][taskTypeIndex][innerGroupKey])
                    storedTasks[date][taskTypeIndex][innerGroupKey] = {}
                if (!storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId])
                    storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId] = []
                storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId].push(task)
                if (storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId].length > 1)
                    listsToSort[sortListKey] = sortListValue
            } else {
                if (!storedTasks[date][taskTypeIndex]) storedTasks[date][taskTypeIndex] = {}
                if (!storedTasks[date][taskTypeIndex][taskParentGoalId])
                    storedTasks[date][taskTypeIndex][taskParentGoalId] = []
                storedTasks[date][taskTypeIndex][taskParentGoalId].push(task)
                if (storedTasks[date][taskTypeIndex][taskParentGoalId].length > 1)
                    listsToSort[sortListKey] = sortListValue
            }

            //THE WORKFLOW ALGORITHM IS UPDATING THE TASK DIRECTLY (BAD PRACTICE) AND WE NEED TO CLONE THE TASK FOR NOT BEEN AFFECTED BY THIS
            //IS THE WORKLFOW IS REFACTORED WE CAN REMOVE TEH CLONE AND PUT THE TASK DIRECTLY
            if (areObservedTasks) {
                tasksMap.observedTasksById[task.id] = cloneDeep(task)
            } else if (areStreamAndUserTasks) {
                tasksMap.streamAndUserTasksById[task.id] = cloneDeep(task)
            } else {
                tasksMap.userTasksById[task.id] = cloneDeep(task)
            }
        }
    }

    const deleteTask = (date, taskTypeIndex, innerGroupKey, taskParentGoalId, estimation, notDeleteParentGoal) => {
        estimationByDate[date] -= getEstimationRealValue(projectId, estimation)

        amountOfTasksByDate[date]--

        if (areObservedTasks) {
            delete tasksMap.observedTasksById[task.id]
        } else if (areStreamAndUserTasks) {
            delete tasksMap.streamAndUserTasksById[task.id]
        } else {
            delete tasksMap.userTasksById[task.id]
        }

        const cleanDateData = amountTypesInDate => {
            if (amountTypesInDate === 0) {
                delete storedTasks[date]
                delete estimationByDate[date]
                delete amountOfTasksByDate[date]
            }
        }

        let amountTypesInDate
        if (innerGroupKey) {
            storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId] = storedTasks[date][taskTypeIndex][
                innerGroupKey
            ][taskParentGoalId].filter(taskItem => taskItem.id !== task.id)
            if (!notDeleteParentGoal && storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId].length === 0)
                delete storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId]
            if (Object.keys(storedTasks[date][taskTypeIndex][innerGroupKey]).length === 0)
                delete storedTasks[date][taskTypeIndex][innerGroupKey]
            const amountStepsInType = Object.keys(storedTasks[date][taskTypeIndex]).length
            if (amountStepsInType <= 1) delete listsToSort[sortListKey]
            if (Object.keys(storedTasks[date][taskTypeIndex]).length === 0) delete storedTasks[date][taskTypeIndex]
            amountTypesInDate = Object.keys(storedTasks[date]).length
            cleanDateData(amountTypesInDate)
        } else {
            storedTasks[date][taskTypeIndex][taskParentGoalId] = storedTasks[date][taskTypeIndex][
                taskParentGoalId
            ].filter(taskItem => taskItem.id !== task.id)
            if (!notDeleteParentGoal && storedTasks[date][taskTypeIndex][taskParentGoalId].length === 0)
                delete storedTasks[date][taskTypeIndex][taskParentGoalId]
            if (Object.keys(storedTasks[date][taskTypeIndex]).length === 0) delete storedTasks[date][taskTypeIndex]
            amountTypesInDate = Object.keys(storedTasks[date]).length
            if (amountTypesInDate <= 1) delete listsToSort[sortListKey]
            cleanDateData(amountTypesInDate)
        }
    }

    //PROCESS THE CHANGE
    if (changeType === 'modified') {
        const oldTask = areObservedTasks
            ? tasksMap.observedTasksById[task.id]
            : areStreamAndUserTasks
            ? tasksMap.streamAndUserTasksById[task.id]
            : tasksMap.userTasksById[task.id]

        const wasNeedToProcessTheTask = !!oldTask
        if (wasNeedToProcessTheTask) {
            const oldTaskInBacklog = areObservedTasks
                ? oldTask.dueDateByObserversIds[currentUserId] === Number.MAX_SAFE_INTEGER
                : oldTask.dueDate === Number.MAX_SAFE_INTEGER
            const oldTaskDueDate = areObservedTasks ? oldTask.dueDateByObserversIds[currentUserId] : oldTask.dueDate
            const oldTaskIsTodayOrOverdue = oldTaskDueDate <= endOfDay && !oldTaskInBacklog

            const oldDate = oldTaskIsTodayOrOverdue
                ? dayDateFormated
                : oldTaskInBacklog
                ? BACKLOG_DATE_STRING
                : moment(oldTaskDueDate).format('YYYYMMDD')

            const oldTaskTypeIndex = getTaskTypeIndex(oldTask, areObservedTasks, areStreamAndUserTasks)
            const oldStepHistory = oldTask.stepHistory
            const oldCurrentStepId = oldStepHistory[oldStepHistory.length - 1]
            const oldSuggestedBy = oldTask.suggestedBy
            const oldEstimation = areObservedTasks
                ? oldTask.estimationsByObserverIds[currentUserId]
                    ? oldTask.estimationsByObserverIds[currentUserId]
                    : 0
                : oldTask.estimations[oldCurrentStepId]
                ? oldTask.estimations[oldCurrentStepId]
                : 0
            const oldUserId = oldTask.userId
            const oldTaskParentGoalId =
                oldTask.parentGoalId &&
                (oldTask.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                    oldTask.parentGoalIsPublicFor.includes(loggedUserId))
                    ? oldTask.parentGoalId
                    : NOT_PARENT_GOAL_INDEX

            let oldInnerGroupKey = ''
            if (oldTaskTypeIndex === WORKFLOW_TASK_INDEX) {
                oldInnerGroupKey = oldCurrentStepId
            } else if (oldTaskTypeIndex === SUGGESTED_TASK_INDEX) {
                oldInnerGroupKey = oldSuggestedBy
            } else if (oldTaskTypeIndex === OBSERVED_TASKS_INDEX) {
                oldInnerGroupKey = oldUserId
            } else if (oldTaskTypeIndex === STREAM_AND_USER_TASKS_INDEX) {
                oldInnerGroupKey = oldUserId
            }
            deleteTask(
                oldDate,
                oldTaskTypeIndex,
                oldInnerGroupKey,
                oldTaskParentGoalId,
                oldEstimation,
                oldTaskParentGoalId === taskParentGoalId &&
                    oldInnerGroupKey === innerGroupKey &&
                    oldTaskTypeIndex === taskTypeIndex &&
                    oldDate === date
            )
        }
        addTask()
    } else if (changeType === 'added') {
        const notExistTask = areObservedTasks
            ? !tasksMap.observedTasksById[task.id]
            : areStreamAndUserTasks
            ? !tasksMap.streamAndUserTasksById[task.id]
            : !tasksMap.userTasksById[task.id]
        if (notExistTask) addTask()
    } else {
        if (needToProcessTheTask) deleteTask(date, taskTypeIndex, innerGroupKey, taskParentGoalId, estimation, false)
    }
}

const sortTasksListThatHaveNewTasks = (storedTasks, listsToSort) => {
    for (const sortListKey in listsToSort) {
        const { date, taskTypeIndex, innerGroupKey, taskParentGoalId } = listsToSort[sortListKey]
        if (
            taskTypeIndex === WORKFLOW_TASK_INDEX ||
            taskTypeIndex === SUGGESTED_TASK_INDEX ||
            taskTypeIndex === OBSERVED_TASKS_INDEX ||
            taskTypeIndex === STREAM_AND_USER_TASKS_INDEX
        ) {
            storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId] = orderBy(
                storedTasks[date][taskTypeIndex][innerGroupKey][taskParentGoalId],
                'sortIndex',
                'desc'
            )
        } else {
            storedTasks[date][taskTypeIndex][taskParentGoalId] = orderBy(
                storedTasks[date][taskTypeIndex][taskParentGoalId],
                'sortIndex',
                'desc'
            )
        }
    }
}

const generateOpenTasksArray = (storedTasks, dayDateFormated, amountOfTasksByDate, estimationByDate) => {
    const tasksByDateAndStep = Object.entries(storedTasks).sort((a, b) => a[0] - b[0])
    const openTasksArray = storedTasks[dayDateFormated]
        ? []
        : [[dayDateFormated, 0, 0, [], [], [], [], [], [], [], [], [], []]]

    for (let i = 0; i < tasksByDateAndStep.length; i++) {
        const dateElement = tasksByDateAndStep[i]
        const date = dateElement[0]
        const taskByType = dateElement[1]
        const amountTasks = amountOfTasksByDate[date]
        const estimationTasks = estimationByDate[date]
        const mainTasks = taskByType[MAIN_TASK_INDEX] ? Object.entries(taskByType[MAIN_TASK_INDEX]) : []
        const mentionTasks = taskByType[MENTION_TASK_INDEX] ? Object.entries(taskByType[MENTION_TASK_INDEX]) : []
        const activeGoals = taskByType[ACTIVE_GOALS_INDEX] ? taskByType[ACTIVE_GOALS_INDEX] : []
        const calendarTasks = taskByType[CALENDAR_TASK_INDEX] ? Object.entries(taskByType[CALENDAR_TASK_INDEX]) : []
        const emailTasks = taskByType[EMAIL_TASK_INDEX] ? Object.entries(taskByType[EMAIL_TASK_INDEX]) : []

        const suggestedTasks = []
        if (taskByType[SUGGESTED_TASK_INDEX]) {
            const suggestedTasksBySuggested = Object.entries(taskByType[SUGGESTED_TASK_INDEX])
            for (let n = 0; n < suggestedTasksBySuggested.length; n++) {
                const suggestedId = suggestedTasksBySuggested[n][0]
                const goalsElements = suggestedTasksBySuggested[n][1]
                const goalsElementsArray = Object.entries(goalsElements)
                suggestedTasks.push([suggestedId, goalsElementsArray])
            }
        }

        const workflowTasks = []
        if (taskByType[WORKFLOW_TASK_INDEX]) {
            const workflowTasksByStep = Object.entries(taskByType[WORKFLOW_TASK_INDEX])
            for (let n = 0; n < workflowTasksByStep.length; n++) {
                const stepId = workflowTasksByStep[n][0]
                const goalsElements = workflowTasksByStep[n][1]
                const goalsElementsArray = Object.entries(goalsElements)
                workflowTasks.push([stepId, goalsElementsArray])
            }
            for (let n = 0; n < workflowTasks.length; n++) {
                const stepElement = workflowTasks[n]
                stepElement[0] = stepElement[1][0][1][0].userId
            }
        }

        const observedTasks = []
        if (taskByType[OBSERVED_TASKS_INDEX]) {
            const observedTasksByAssignee = Object.entries(taskByType[OBSERVED_TASKS_INDEX])
            for (let n = 0; n < observedTasksByAssignee.length; n++) {
                const assigneeId = observedTasksByAssignee[n][0]
                const goalsElements = observedTasksByAssignee[n][1]
                const goalsElementsArray = Object.entries(goalsElements)
                observedTasks.push([assigneeId, goalsElementsArray])
            }
        }

        const streamAndUserTasks = []
        if (taskByType[STREAM_AND_USER_TASKS_INDEX]) {
            const streamAndUserTasksByAssignee = Object.entries(taskByType[STREAM_AND_USER_TASKS_INDEX])
            for (let n = 0; n < streamAndUserTasksByAssignee.length; n++) {
                const assigneeId = streamAndUserTasksByAssignee[n][0]
                const goalsElements = streamAndUserTasksByAssignee[n][1]
                const goalsElementsArray = Object.entries(goalsElements)
                streamAndUserTasks.push([assigneeId, goalsElementsArray])
            }
        }

        const emptyGoals = activeGoals.filter(goal => !mainTasks.map(data => data[0]).includes(goal.id))

        openTasksArray.push([
            date,
            amountTasks,
            estimationTasks,
            mainTasks,
            mentionTasks,
            suggestedTasks,
            workflowTasks,
            observedTasks,
            streamAndUserTasks,
            activeGoals,
            calendarTasks,
            emailTasks,
            emptyGoals,
        ])
    }

    return openTasksArray
}

const processSubtaskChange = (
    subtasksByParentId,
    subtasksMap,
    areObservedTasks,
    areStreamAndUserTasks,
    showLaterTasks,
    showSomedayTasks,
    currentUserId,
    loggedUser,
    endOfDay,
    subtasksListToSortParentsId,
    changeType,
    subtask
) => {
    const { uid: loggedUserId } = loggedUser

    const { parentId, dueDateByObserversIds, isPublicFor } = subtask

    let needToProcessTheTask = true
    if (areObservedTasks) {
        const taskInBacklog = dueDateByObserversIds[currentUserId] === BACKLOG_DATE_NUMERIC
        const taskIsTodayOrOverdue = dueDateByObserversIds[currentUserId] <= endOfDay
        const taskIsLater = dueDateByObserversIds[currentUserId] > endOfDay && !taskInBacklog

        const isPublicForLoggedUser =
            isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || (!loggedUser.isAnonymous && isPublicFor.includes(loggedUserId))

        const needToBeListedInThisDate = showSomedayTasks || taskIsTodayOrOverdue || (showLaterTasks && taskIsLater)
        needToProcessTheTask = isPublicForLoggedUser && needToBeListedInThisDate
    }

    const addSubtask = () => {
        if (needToProcessTheTask) {
            subtasksByParentId[parentId] = subtasksByParentId[parentId]
                ? subtasksByParentId[parentId].filter(taskItem => taskItem.id !== subtask.id)
                : []
            subtasksByParentId[parentId] = subtasksByParentId[parentId].concat(subtask)
            if (subtasksByParentId[parentId].length > 1) subtasksListToSortParentsId.add(parentId)
            areObservedTasks
                ? (subtasksMap.observedSubtasksById[subtask.id] = subtask)
                : areStreamAndUserTasks
                ? (subtasksMap.streamAndUserSubtasksById[subtask.id] = subtask)
                : (subtasksMap.userSubtasksById[subtask.id] = subtask)
        }
    }

    const deleteSubtask = parentId => {
        if (subtasksByParentId[parentId]) {
            subtasksByParentId[parentId] = subtasksByParentId[parentId].filter(taskItem => taskItem.id !== subtask.id)
            if (subtasksByParentId[parentId].length <= 1) {
                if (subtasksByParentId[parentId].length === 0) delete subtasksByParentId[parentId]
                subtasksListToSortParentsId.delete(parentId)
            }
        }
        areObservedTasks
            ? delete subtasksMap.observedSubtasksById[subtask.id]
            : areStreamAndUserTasks
            ? delete subtasksMap.streamAndUserSubtasksById[subtask.id]
            : delete subtasksMap.userSubtasksById[subtask.id]
    }

    if (changeType === 'added') {
        addSubtask()
    } else if (changeType === 'modified') {
        const oldSubtask = areObservedTasks
            ? subtasksMap.observedSubtasksById[subtask.id]
            : areStreamAndUserTasks
            ? subtasksMap.streamAndUserSubtasksById[subtask.id]
            : subtasksMap.userSubtasksById[subtask.id]

        const wasNeedToProcessTheTask = !!oldSubtask

        if (wasNeedToProcessTheTask) {
            const oldParentId = oldSubtask.parentId
            deleteSubtask(oldParentId)
        }
        addSubtask()
    } else {
        if (needToProcessTheTask) deleteSubtask(parentId)
    }
}

const getSubtaskInMap = (subtasksMap, areObservedTasks, areStreamAndUserTasks, taskId) => {
    const { observedSubtasksById, streamAndUserSubtasksById, userSubtasksById } = subtasksMap
    const subtask = areObservedTasks
        ? observedSubtasksById[taskId]
        : areStreamAndUserTasks
        ? streamAndUserSubtasksById[taskId]
        : userSubtasksById[taskId]
    return subtask
}

const processTaskChanges = (
    projectId,
    changes,
    loggedUser,
    currentUserId,
    endOfDay,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    tasksMap,
    areObservedTasks,
    areStreamAndUserTasks,
    dayDateFormated,
    showLaterTasks,
    showSomedayTasks,
    subtasksByParentId,
    subtasksMap
) => {
    const listsToSort = {}
    const subtasksListToSortParentsId = new Set()

    for (let change of changes) {
        const changeType = change.type
        const task = mapTaskData(change.doc.id, change.doc.data())
        if (task.parentId) {
            if (changeType === 'modified') {
                const oldSubtask = getSubtaskInMap(subtasksMap, areObservedTasks, areStreamAndUserTasks, task.id)
                if (!oldSubtask) {
                    processTaskChange(
                        projectId,
                        loggedUser,
                        currentUserId,
                        endOfDay,
                        storedTasks,
                        estimationByDate,
                        amountOfTasksByDate,
                        tasksMap,
                        areObservedTasks,
                        areStreamAndUserTasks,
                        dayDateFormated,
                        showLaterTasks,
                        showSomedayTasks,
                        listsToSort,
                        'removed',
                        task
                    )
                }
            }

            processSubtaskChange(
                subtasksByParentId,
                subtasksMap,
                areObservedTasks,
                areStreamAndUserTasks,
                showLaterTasks,
                showSomedayTasks,
                currentUserId,
                loggedUser,
                endOfDay,
                subtasksListToSortParentsId,
                changeType,
                task
            )
        } else {
            if (changeType === 'modified') {
                const oldSubtask = getSubtaskInMap(subtasksMap, areObservedTasks, areStreamAndUserTasks, task.id)
                if (oldSubtask) {
                    processSubtaskChange(
                        subtasksByParentId,
                        subtasksMap,
                        areObservedTasks,
                        areStreamAndUserTasks,
                        showLaterTasks,
                        showSomedayTasks,
                        currentUserId,
                        loggedUser,
                        endOfDay,
                        subtasksListToSortParentsId,
                        'removed',
                        oldSubtask
                    )
                }
            }
            processTaskChange(
                projectId,
                loggedUser,
                currentUserId,
                endOfDay,
                storedTasks,
                estimationByDate,
                amountOfTasksByDate,
                tasksMap,
                areObservedTasks,
                areStreamAndUserTasks,
                dayDateFormated,
                showLaterTasks,
                showSomedayTasks,
                listsToSort,
                changeType,
                task
            )
        }
    }

    sortTasksListThatHaveNewTasks(storedTasks, listsToSort)
    const openTasksArray = generateOpenTasksArray(storedTasks, dayDateFormated, amountOfTasksByDate, estimationByDate)

    for (let parentId of subtasksListToSortParentsId) {
        subtasksByParentId[parentId] = orderBy(subtasksByParentId[parentId], 'sortIndex', 'desc')
    }

    return { openTasksArray, subtasksByTasks: { ...subtasksByParentId } }
}

//COMMON UNWATCH FUNCTIONS

const unwatchSpecific = (projectId, currentUserId, assigneeUserId, watcher) => {
    if (watcher[projectId] && watcher[projectId][currentUserId] && watcher[projectId][currentUserId][assigneeUserId]) {
        watcher[projectId][currentUserId][assigneeUserId]()
        delete watcher[projectId][currentUserId][assigneeUserId]
    }
}

const unwatch = (projectId, currentUserId, watcher) => {
    if (watcher[projectId] && watcher[projectId][currentUserId]) {
        for (let unsubIndex in watcher[projectId][currentUserId]) {
            unwatchSpecific(projectId, currentUserId, unsubIndex, watcher)
        }
        if (size(watcher[projectId][currentUserId]) === 0) delete watcher[projectId][currentUserId]
        if (size(watcher[projectId]) === 0) delete watcher[projectId]
    }
}

// WORKSTREAMS MIXED BOARDS

const watchStreamAndUserOpenTasksInBatches = (
    projectId,
    callback,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    tasksMap,
    showLaterTasks,
    showSomedayTasks,
    subtasksByParentId,
    subtasksMap
) => {
    const { currentUser, loggedUser } = store.getState()
    const currentUserId = currentUser.uid
    const userIsStream = currentUserId.startsWith(WORKSTREAM_ID_PREFIX)

    let userIdList =
        currentUser.recorderUserId || userIsStream || !!currentUser.temperature
            ? []
            : [...(currentUser?.workstreams[projectId] || []), DEFAULT_WORKSTREAM_ID]

    for (let i = 0; i < userIdList.length; i++) {
        watchStreamAndUserOpenTasks(
            projectId,
            callback,
            storedTasks,
            estimationByDate,
            amountOfTasksByDate,
            tasksMap,
            showLaterTasks,
            showSomedayTasks,
            currentUser,
            loggedUser,
            userIdList[i],
            subtasksByParentId,
            subtasksMap
        )
    }
}

const getOpenStreamAndUserTasksQuery = (
    projectId,
    showLaterTasks,
    showSomedayTasks,
    endOfDay,
    loggedUser,
    assigneeUserId
) => {
    const { uid: loggedUserId, isAnonymous } = loggedUser
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    let query = getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', false)
        .where('userId', '==', assigneeUserId)
        .where('isPublicFor', 'array-contains-any', allowUserIds)

    if (!showLaterTasks && !showSomedayTasks) query = query.where('dueDate', '<=', endOfDay)
    if (showLaterTasks && !showSomedayTasks) query = query.where('dueDate', '<', BACKLOG_DATE_NUMERIC)

    return query
}

const watchStreamAndUserOpenTasks = (
    projectId,
    callback,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    tasksMap,
    showLaterTasks,
    showSomedayTasks,
    currentUser,
    loggedUser,
    assigneeUserId,
    subtasksByParentId,
    subtasksMap
) => {
    const { taskListWatchersVars } = store.getState()
    const currentUserId = currentUser.uid

    const date = moment()
    const endOfDay = date.endOf('day').valueOf()
    const dayDateFormated = TODAY_DATE

    let query = getOpenStreamAndUserTasksQuery(
        projectId,
        showLaterTasks,
        showSomedayTasks,
        endOfDay,
        loggedUser,
        assigneeUserId
    )

    let cacheChanges = []
    const unsub = query.onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
        const changes = querySnapshot.docChanges()
        if (querySnapshot.metadata.fromCache) {
            cacheChanges = [...cacheChanges, ...changes]
        } else {
            const mergedChanges = [...cacheChanges, ...changes]

            let subtasks = { ...subtasksByParentId }

            if (mergedChanges.length > 0) {
                const { openTasksArray, subtasksByTasks } = processTaskChanges(
                    projectId,
                    mergedChanges,
                    loggedUser,
                    currentUserId,
                    endOfDay,
                    storedTasks,
                    estimationByDate,
                    amountOfTasksByDate,
                    tasksMap,
                    false,
                    true,
                    dayDateFormated,
                    showLaterTasks,
                    showSomedayTasks,
                    subtasksByParentId,
                    subtasksMap
                )
                subtasks = subtasksByTasks
                callback(openTasksArray)
                store.dispatch(
                    setOpenTasksMap(projectId, {
                        ...tasksMap.observedTasksById,
                        ...tasksMap.userTasksById,
                        ...tasksMap.streamAndUserTasksById,
                    })
                )
            } else if (Object.keys(storedTasks).length === 0) {
                callback([[dayDateFormated, 0, 0, [], [], [], [], [], [], [], [], [], []]])
                store.dispatch(setOpenTasksMap(projectId, {}))
            }

            // Save vars at the end
            store.dispatch(
                setTaskListWatchersVars({
                    ...taskListWatchersVars,
                    storedTasks,
                    estimationByDate,
                    amountOfTasksByDate,
                    tasksMap,
                    subtasksByParentId,
                    subtasksMap,
                })
            )

            store.dispatch(
                setOpenSubtasksMap(projectId, {
                    ...subtasksMap.observedSubtasksById,
                    ...subtasksMap.userSubtasksById,
                    ...subtasksMap.streamAndUserSubtasksById,
                })
            )

            const instanceKey = projectId + currentUserId
            store.dispatch(updateSubtaskByTask(instanceKey, subtasks))

            cacheChanges = []
        }
    })

    setProperty(streamAndUserOpenTasks, [projectId, currentUserId, assigneeUserId], unsub)
}

export const removeWatchersForOneStreamAndUser = (projectId, currentUserId, assigneeUserId) => {
    unwatchSpecific(projectId, currentUserId, assigneeUserId, streamAndUserOpenTasks)
}

export const addWatchersForOneStreamAndUser = (
    projectId,
    callbackOpenTasks,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    tasksMap,
    subtasksByParentId,
    subtasksMap,
    showLaterTasks,
    showSomedayTasks,
    assigneeUserId
) => {
    const { currentUser, loggedUser } = store.getState()

    watchStreamAndUserOpenTasks(
        projectId,
        callbackOpenTasks,
        storedTasks,
        estimationByDate,
        amountOfTasksByDate,
        tasksMap,
        showLaterTasks,
        showSomedayTasks,
        currentUser,
        loggedUser,
        assigneeUserId,
        subtasksByParentId,
        subtasksMap
    )
}

////GOALS ////

function watchEmptyGoals(
    projectId,
    callback,
    storedTasks,
    goalsMap,
    showLaterTasks,
    showSomedayTasks,
    estimationByDate,
    amountOfTasksByDate
) {
    unwatchEmptyGoalsWatcher(projectId, currentUserId, activeMilestoneEmptyGoals)

    const { currentUser } = store.getState()
    const currentUserId = currentUser.uid
    const dayDateFormated = TODAY_DATE

    const date = moment()
    const endOfDay = date.endOf('day').valueOf()

    const ownerId = getOwnerId(projectId, currentUserId)
    let cacheChanges = []

    let query = getDb()
        .collection(`goals/${projectId}/items`)
        .where('progress', '!=', 100)
        .where('assigneesIds', 'array-contains-any', [currentUserId])
        .where('ownerId', '==', ownerId)

    const unsub = query.onSnapshot({ includeMetadataChanges: true }, querySnapshot => {
        const changes = querySnapshot.docChanges()
        if (querySnapshot.metadata.fromCache) {
            cacheChanges = [...cacheChanges, ...changes]
        } else {
            const mergedChanges = [...cacheChanges, ...changes]
            if (mergedChanges.length > 0) {
                const openTasksArray = processEmptyGoalChanges(
                    mergedChanges,
                    currentUserId,
                    endOfDay,
                    storedTasks,
                    estimationByDate,
                    amountOfTasksByDate,
                    goalsMap,
                    dayDateFormated,
                    showLaterTasks,
                    showSomedayTasks
                )
                callback(openTasksArray, false)

                querySnapshot.forEach(doc => {
                    const goal = mapGoalData(doc.id, doc.data())
                    const { progress, dynamicProgress } = goal
                    if (progress === DYNAMIC_PERCENT && dynamicProgress === 100) return
                })
            } else if (Object.keys(storedTasks).length === 0) {
                callback([[dayDateFormated, 0, 0, [], [], [], [], [], [], [], [], [], []]], false)
            }
            cacheChanges = []
        }
    })

    activeMilestoneEmptyGoals[projectId] = { [currentUserId]: unsub }
}

const processEmptyGoalChanges = (
    changes,
    currentUserId,
    endOfDay,
    storedTasks,
    estimationByDate,
    amountOfTasksByDate,
    goalsMap,
    dayDateFormated,
    showLaterTasks,
    showSomedayTasks
) => {
    const { uid: loggedUserId, isAnonymous } = store.getState().loggedUser

    for (let change of changes) {
        const goalId = change.id ? change.id : change.doc.id
        const type = change.type
        const goal = change.data ? change.data : mapGoalData(goalId, change.doc.data())
        const { assigneesReminderDate, isPublicFor, progress, dynamicProgress } = goal
        const userReminderDate = assigneesReminderDate[currentUserId]
        const goalInBacklog = userReminderDate === BACKLOG_DATE_NUMERIC
        const goalIsTodayOrOverdue = userReminderDate <= endOfDay
        const goalIsLater = userReminderDate > endOfDay && !goalInBacklog
        const date = goalIsTodayOrOverdue
            ? dayDateFormated
            : goalInBacklog
            ? BACKLOG_DATE_STRING
            : moment(userReminderDate).format('YYYYMMDD')

        const isPublic =
            isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || (!isAnonymous && isPublicFor.includes(loggedUserId))
        const isNotDynamicCompleted = progress !== DYNAMIC_PERCENT || dynamicProgress !== 100
        const needToBeListedInThisDate = showSomedayTasks || goalIsTodayOrOverdue || (showLaterTasks && goalIsLater)
        let needToProcessTheGoal = isPublic && isNotDynamicCompleted && needToBeListedInThisDate
        const addTask = () => {
            if (needToProcessTheGoal) {
                if (!storedTasks[date]) {
                    storedTasks[date] = {}
                    estimationByDate[date] = ESTIMATION_0_MIN
                    amountOfTasksByDate[date] = 0
                }

                if (!storedTasks[date][ACTIVE_GOALS_INDEX]) storedTasks[date][ACTIVE_GOALS_INDEX] = []
                storedTasks[date][ACTIVE_GOALS_INDEX].push(goal)
                goalsMap[goalId] = goal
            }
        }

        const deleteTask = date => {
            delete goalsMap[goalId]

            storedTasks[date][ACTIVE_GOALS_INDEX] = storedTasks[date][ACTIVE_GOALS_INDEX].filter(
                goalItem => goalItem.id !== goalId
            )

            if (Object.keys(storedTasks[date][ACTIVE_GOALS_INDEX]).length === 0) {
                delete storedTasks[date][ACTIVE_GOALS_INDEX]
                const amountTypesInDate = Object.keys(storedTasks[date]).length
                if (amountTypesInDate === 0) {
                    delete storedTasks[date]
                    delete estimationByDate[date]
                    delete amountOfTasksByDate[date]
                }
            }
        }

        //PROCESS THE CHANGE
        if (type === 'modified') {
            const oldGoal = goalsMap[goalId]

            const wasNeedToProcessTheTask = !!oldGoal
            if (wasNeedToProcessTheTask) {
                const oldUserReminderDate = oldGoal.assigneesReminderDate[currentUserId]

                const oldGoalInBacklog = oldUserReminderDate === BACKLOG_DATE_NUMERIC
                const oldGoalIsTodayOrOverdue = oldUserReminderDate <= endOfDay && !oldGoalInBacklog

                const oldDate = oldGoalIsTodayOrOverdue
                    ? dayDateFormated
                    : oldGoalInBacklog
                    ? BACKLOG_DATE_STRING
                    : moment(oldUserReminderDate).format('YYYYMMDD')

                deleteTask(oldDate)
            }
            addTask()
        } else if (type === 'added') {
            const notExistGoal = !goalsMap[goalId]
            if (notExistGoal) addTask()
        } else {
            if (needToProcessTheGoal) deleteTask(date)
        }
    }

    //CONVERT OBJECT IN ARRAYS
    const openTasksArray = generateOpenTasksArray(storedTasks, dayDateFormated, amountOfTasksByDate, estimationByDate)

    return openTasksArray
}

const unwatchEmptyGoalsWatcher = (projectId, currentUserId, watcher) => {
    if (watcher[projectId] && watcher[projectId][currentUserId]) {
        watcher[projectId][currentUserId]()
        delete watcher[projectId][currentUserId]
        if (Object.keys(watcher[projectId]).length === 0) delete watcher[projectId]
    }
}

export const contractOpenTasks = (projectId, instanceKey, openTasks, updateTaks) => {
    updateTaks([openTasks[0]], false)
    watchOpenTasks(projectId, updateTaks, false, false, true, instanceKey)
    store.dispatch([setLaterTasksExpanded(false), setSomedayTasksExpanded(false)])
}

export const contractSomedayOpenTasks = (projectId, instanceKey, openTasks, updateTaks) => {
    const allOpenTasks = [...openTasks]
    allOpenTasks.pop()
    updateTaks(allOpenTasks, false)
    watchOpenTasks(projectId, updateTaks, true, false, true, instanceKey)
    store.dispatch(setSomedayTasksExpanded(false))
}

export const filterOpTasks = (instanceKey, tasks) => {
    const { hashtagFilters } = store.getState()
    const filtersArray = Array.from(hashtagFilters.keys())
    const filteredOpenTasks = filtersArray.length > 0 ? filterOpenTasks(tasks) : tasks
    store.dispatch(updateFilteredOpenTasks(instanceKey, filteredOpenTasks))
}

export const updateOpTasks = (
    projectId,
    instanceKey,
    initialTasks,
    initialLoadingInOpenTasks,
    setProjectsHaveTasksInFirstDay,
    inSelectedProject
) => {
    const openTasks = inSelectedProject ? initialTasks : taskToShowInAllProjects(instanceKey, initialTasks)

    initialLoadingInOpenTasks
        ? store.dispatch(updateInitialLoadingEndOpenTasks(instanceKey, true))
        : store.dispatch(updateInitialLoadingEndObservedTasks(instanceKey, true))

    // Check if there are any visible tasks (main, email, calendar) or goals for the first day
    const thereAreNotTasksInFirstDay =
        openTasks.length === 0 ||
        (openTasks[0][AMOUNT_TASKS_INDEX] === 0 && openTasks[0][ACTIVE_GOALS_INDEX].length === 0)

    const todayEmptyGoalsAmount =
        openTasks.length === 0 || openTasks[0][ACTIVE_GOALS_INDEX].length === 0
            ? 0
            : openTasks[0][ACTIVE_GOALS_INDEX].length
    store.dispatch(setTodayEmptyGoalsTotalAmountInOpenTasksView(projectId, todayEmptyGoalsAmount))

    store.dispatch(updateThereAreNotTasksInFirstDay(instanceKey, thereAreNotTasksInFirstDay))

    updateAndFilterTasksTasks(instanceKey, openTasks)
    if (setProjectsHaveTasksInFirstDay)
        setProjectsHaveTasksInFirstDay(projectsHaveTasksInFirstDay => {
            // Use AMOUNT_TASKS_INDEX which now includes calendar tasks for project amount calculation
            const projectAmount = openTasks[0]
                ? openTasks[0][AMOUNT_TASKS_INDEX] + openTasks[0][ACTIVE_GOALS_INDEX].length
                : 0
            if (!isEqual(projectsHaveTasksInFirstDay[projectId], projectAmount)) {
                return {
                    ...projectsHaveTasksInFirstDay,
                    [projectId]: projectAmount,
                }
            }
            return projectsHaveTasksInFirstDay
        })
}

const taskToShowInAllProjects = (instanceKey, filteredOpenTasks) => {
    let hiddenTaskTypesExist = false

    // Determine if any tasks of the specifically "hidden" types exist
    for (const tasksByDate of filteredOpenTasks) {
        const typesToSumForHiddenCheck = [
            tasksByDate[MENTION_TASK_INDEX],
            tasksByDate[SUGGESTED_TASK_INDEX],
            tasksByDate[OBSERVED_TASKS_INDEX],
            tasksByDate[STREAM_AND_USER_TASKS_INDEX],
        ]

        for (const taskTypeGroupArray of typesToSumForHiddenCheck) {
            if (taskTypeGroupArray && taskTypeGroupArray.length > 0) {
                // taskTypeGroupArray is like [[groupId, goalsArray], [groupId, goalsArray]]
                for (const group of taskTypeGroupArray) {
                    // group is like [groupId, goalsArray]
                    const goalsArray = group[1]
                    if (goalsArray && goalsArray.length > 0) {
                        // goalsArray is like [[goalId, tasksArray], [goalId, tasksArray]]
                        for (const goalEntry of goalsArray) {
                            // goalEntry is like [goalId, tasksArray]
                            const tasksArray = goalEntry[1]
                            if (tasksArray && tasksArray.length > 0) {
                                hiddenTaskTypesExist = true
                                break // Found tasks in a hidden type
                            }
                        }
                    }
                    if (hiddenTaskTypesExist) break
                }
            }
            if (hiddenTaskTypesExist) break
        }
        if (hiddenTaskTypesExist) break // Found in this date, no need to check other dates
    }

    // Use nonCalendarTasksCount (main+email) in areHiddenNotMainTasks check
    // This means the arrow appears only if we're hiding tasks that aren't calendar tasks
    store.dispatch(updateThereAreHiddenNotMainTasks(instanceKey, hiddenTaskTypesExist))

    // Build taskToShow for display
    let taskToShow = []
    filteredOpenTasks.forEach(originalTasksByDate => {
        let currentMainTasksCount = 0
        if (originalTasksByDate[MAIN_TASK_INDEX]) {
            originalTasksByDate[MAIN_TASK_INDEX].forEach(tasksByGoal => {
                currentMainTasksCount += tasksByGoal[1].length
            })
        }

        let currentEmailTasksCount = 0
        if (originalTasksByDate[EMAIL_TASK_INDEX]) {
            originalTasksByDate[EMAIL_TASK_INDEX].forEach(tasksByGoal => {
                currentEmailTasksCount += tasksByGoal[1].length
            })
        }

        // Calculate calendar tasks count
        let currentCalendarTasksCount = 0
        if (originalTasksByDate[CALENDAR_TASK_INDEX]) {
            originalTasksByDate[CALENDAR_TASK_INDEX].forEach(tasksByGoal => {
                if (tasksByGoal && tasksByGoal[1] && Array.isArray(tasksByGoal[1])) {
                    currentCalendarTasksCount += tasksByGoal[1].length
                }
            })
        }

        // Calculate workflow tasks count
        let currentWorkflowTasksCount = 0
        if (originalTasksByDate[WORKFLOW_TASK_INDEX]) {
            originalTasksByDate[WORKFLOW_TASK_INDEX].forEach(tasksByGoal => {
                if (tasksByGoal && tasksByGoal[1] && Array.isArray(tasksByGoal[1])) {
                    currentWorkflowTasksCount += tasksByGoal[1].length
                }
            })
        }

        // Check if this date should be included in the output
        const shouldInclude =
            currentMainTasksCount > 0 ||
            currentEmailTasksCount > 0 ||
            currentCalendarTasksCount > 0 ||
            currentWorkflowTasksCount > 0

        // Modified condition to include days with any visible task type (main, email, calendar, or workflow)
        if (shouldInclude) {
            const newTasksByDateEntry = [...originalTasksByDate] // Start with a shallow copy

            // Set AMOUNT_TASKS_INDEX to include calendar and workflow tasks so the project is visible
            // This ensures projects with only calendar or workflow tasks are displayed in the All Projects view
            newTasksByDateEntry[AMOUNT_TASKS_INDEX] =
                currentMainTasksCount + currentEmailTasksCount + currentCalendarTasksCount + currentWorkflowTasksCount

            // Add a flag indicating whether this date has calendar tasks - will help with arrow logic
            newTasksByDateEntry.hasCalendarTasks = currentCalendarTasksCount > 0

            // Store the non-calendar count separately in a custom property that can be used for the arrow logic
            // Normal UI components won't use this, but our arrow logic can
            newTasksByDateEntry.nonCalendarTasksCount =
                currentMainTasksCount + currentEmailTasksCount + currentWorkflowTasksCount

            // Preserve task types that should be VISIBLE in "All Projects" view
            newTasksByDateEntry[MAIN_TASK_INDEX] = originalTasksByDate[MAIN_TASK_INDEX] || []
            newTasksByDateEntry[CALENDAR_TASK_INDEX] = originalTasksByDate[CALENDAR_TASK_INDEX] || [] // Display calendar tasks
            newTasksByDateEntry[EMAIL_TASK_INDEX] = originalTasksByDate[EMAIL_TASK_INDEX] || [] // Display email tasks
            newTasksByDateEntry[WORKFLOW_TASK_INDEX] = originalTasksByDate[WORKFLOW_TASK_INDEX] || [] // Display workflow tasks

            // Preserve Active Goals and Empty Goals as they are handled by projectAmount or UI separately
            newTasksByDateEntry[ACTIVE_GOALS_INDEX] = originalTasksByDate[ACTIVE_GOALS_INDEX] || []
            newTasksByDateEntry[EMPTY_SECTION_INDEX] = originalTasksByDate[EMPTY_SECTION_INDEX] || []

            // Clear task types that are HIDDEN in "All Projects" summary view
            newTasksByDateEntry[MENTION_TASK_INDEX] = []
            newTasksByDateEntry[SUGGESTED_TASK_INDEX] = []
            newTasksByDateEntry[OBSERVED_TASKS_INDEX] = []
            newTasksByDateEntry[STREAM_AND_USER_TASKS_INDEX] = []

            // ESTIMATION_TASKS_INDEX is kept from original.
            newTasksByDateEntry[ESTIMATION_TASKS_INDEX] = originalTasksByDate[ESTIMATION_TASKS_INDEX]

            taskToShow.push(newTasksByDateEntry)
        }
    })

    return taskToShow
}

export const updateAndFilterTasksTasks = (instanceKey, tasks) => {
    store.dispatch(updateOpenTasks(instanceKey, tasks))
    filterOpTasks(instanceKey, tasks)
}

export function watchAllMilestones(projectId, watcherKey) {
    const { currentUser } = store.getState()
    const ownerId = getOwnerId(projectId, currentUser.uid)

    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`goalsMilestones/${projectId}/milestonesItems`)
        .where('ownerId', '==', ownerId)
        .orderBy('date', 'asc')
        .onSnapshot(milestonesData => {
            const milestones = []
            const openMilestones = []
            let doneMilestone = []
            milestonesData.forEach(doc => {
                const milestone = mapMilestoneData(doc.id, doc.data())
                milestones.push(milestone)
                milestone.done ? doneMilestone.push(milestone) : openMilestones.push(milestone)
            })

            doneMilestone = sortBy(doneMilestone, [item => item.doneDate])
            doneMilestone.reverse()

            store.dispatch([
                setOpenMilestonesInProjectInTasks(projectId, openMilestones),
                setDoneMilestonesInProjectInTasks(projectId, doneMilestone),
            ])
        })
}

export function watchAllGoals(projectId, watcherKey) {
    const { currentUser, loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser
    const currentUserId = currentUser.uid

    const ownerId = getOwnerId(projectId, currentUserId)
    const allowUserIds = isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUserId]

    const query = getDb()
        .collection(`goals/${projectId}/items`)
        .where('isPublicFor', 'array-contains-any', allowUserIds)
        .where('ownerId', '==', ownerId)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(goalsData => {
        const goals = []
        goalsData.forEach(doc => {
            const goal = mapGoalData(doc.id, doc.data())
            goals.push(goal)
        })
        const goalsById = {}
        goals.forEach(goal => {
            goalsById[goal.id] = goal
        })
        store.dispatch(setGoalsInProjectInTasks(projectId, goalsById))
    })
}

export function sortGoalTasksGorups(projectId, openMilestones, doneMilestones, goalsById, assigneeId, tasksGroups) {
    if (openMilestones && doneMilestones && goalsById) {
        const milestones = [
            ...openMilestones,
            { id: `${BACKLOG_MILESTONE_ID}${projectId}`, date: BACKLOG_DATE_NUMERIC, done: false },
            ...doneMilestones,
        ]

        const checkedGoalsById = {}
        let sortedGoals = []

        milestones.forEach(milestone => {
            const { date: milestoneDate, id: milestoneId, done } = milestone

            const milestoneGoals = []

            tasksGroups.forEach(goalTasksData => {
                const goalId = goalTasksData[0]
                const goal = goalsById[goalId]
                if (goal) {
                    const {
                        startingMilestoneDate,
                        completionMilestoneDate,
                        parentDoneMilestoneIds,
                        progress,
                        dynamicProgress,
                    } = goal
                    if (
                        !checkedGoalsById[goalId] &&
                        ((done && parentDoneMilestoneIds.includes(milestoneId)) ||
                            (startingMilestoneDate <= milestoneDate &&
                                completionMilestoneDate >= milestoneDate &&
                                (milestoneDate !== BACKLOG_DATE_NUMERIC ||
                                    (progress !== 100 && (progress !== DYNAMIC_PERCENT || dynamicProgress !== 100)))))
                    ) {
                        milestoneGoals.push(goal)
                        checkedGoalsById[goalId] = goal
                    }
                }
            })

            milestoneGoals.sort(
                (a, b) =>
                    (b.sortIndexByMilestone[milestoneId]
                        ? b.sortIndexByMilestone[milestoneId]
                        : Number.MAX_SAFE_INTEGER) -
                    (a.sortIndexByMilestone[milestoneId]
                        ? a.sortIndexByMilestone[milestoneId]
                        : Number.MAX_SAFE_INTEGER)
            )

            sortedGoals = [...sortedGoals, ...milestoneGoals]
        })

        const assigneeGoals = sortedGoals.filter(goal => goal.assigneesIds.includes(assigneeId))
        const otherGoals = sortedGoals.filter(goal => !goal.assigneesIds.includes(assigneeId))
        sortedGoals = [...assigneeGoals, ...otherGoals]

        const goalsPositionId = {}
        goalsPositionId[NOT_PARENT_GOAL_INDEX] = sortedGoals.length
        sortedGoals.forEach((goal, index) => {
            goalsPositionId[goal.id] = index
        })

        return goalsPositionId
    }
}
