import { cloneDeep, orderBy } from 'lodash'
import moment from 'moment'

import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import {
    setDraggingParentTaskId,
    isDragging,
    setProjectsSortIndex,
    setMyDaySelectedAndOtherTasks,
    setMyDaySubtasksInTask,
} from '../../redux/actions'
import { updateSortTaskIndex, updateListTasksSortIndex } from '../../utils/backends/Tasks/dragTasksFirestore'
import { generateSortIndex, getDb } from '../../utils/backends/firestore'
import { generateSortIndexForTaskInFocus } from '../../utils/backends/Tasks/tasksFirestore'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { BatchWrapper } from '../../functions/BatchWrapper/batchWrapper'
import { setProjectSortIndex } from '../../utils/backends/Projects/projectsFirestore'
import { selectTasksAndAddTimeIntervale } from '../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'

const LIST_TYPE_TASK = 0
const LIST_TYPE_SUBTASK = 1
const SOURCE_AND_DESTINATION_LISTS_ARE_EQUALS = 0
const SOURCE_AND_DESTINATION_ARE_NOT_EQUALS_SUBTASKS_LISTS = 1
const SOURCE_IS_SUBTASK_LIST_AND_DESTINATION_IS_TASK_LIST = 2
const SOURCE_IS_TASK_LIST_AND_DESTINATION_IS_SUBTASK_LIST = 3

export const getTasksAndExpandedSubtasks = (
    taskList,
    myDayOpenSubtasksMap,
    tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
    draggingParentTaskId
) => {
    const mixedTaskList = []
    for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i]
        const { id, projectId } = task
        mixedTaskList.push(task)

        const subtaskList = myDayOpenSubtasksMap[projectId]?.[id]

        if (tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode[id] && subtaskList && draggingParentTaskId !== id) {
            mixedTaskList.push(...subtaskList)
        }
    }
    return mixedTaskList
}

const getDatesAndTasksByDate = () => {
    const { myDaySortingSelectedTasks, myDaySortingOtherTasks } = store.getState()

    const todayDate = moment().format('YYYYMMDD')

    const dates = [todayDate]
    const tasksByDate = { [todayDate]: myDaySortingSelectedTasks }

    myDaySortingOtherTasks.forEach(task => {
        const { estimatedDateFormated } = task
        if (!tasksByDate[estimatedDateFormated]) {
            dates.push(estimatedDateFormated)
            tasksByDate[estimatedDateFormated] = []
        }
        tasksByDate[estimatedDateFormated].push(task)
    })

    return { dates, tasksByDate }
}

const getTasksAcrossAllDatesAndWithExpandedSubtasksByDate = (dates, tasksByDate) => {
    const {
        myDayOpenSubtasksMap,
        tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
        draggingParentTaskId,
    } = store.getState()

    const tasksAcrossAllDates = []
    const tasksAndExpandedSubtasksByDate = {}
    const tasksAndExpandedSubtasksAcrossAllDates = []

    for (let i = 0; i < dates.length; i++) {
        const date = dates[i]
        tasksAndExpandedSubtasksByDate[date] = getTasksAndExpandedSubtasks(
            tasksByDate[date],
            myDayOpenSubtasksMap,
            tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
            draggingParentTaskId
        )
        tasksAndExpandedSubtasksAcrossAllDates.push(...tasksAndExpandedSubtasksByDate[date])
        tasksAcrossAllDates.push(...tasksByDate[date])
    }

    return { tasksAcrossAllDates, tasksAndExpandedSubtasksByDate, tasksAndExpandedSubtasksAcrossAllDates }
}

const getDatesAndTasksAndSubtasksExpandedByDate = () => {
    const { dates, tasksByDate } = getDatesAndTasksByDate()
    const {
        tasksAcrossAllDates,
        tasksAndExpandedSubtasksByDate,
        tasksAndExpandedSubtasksAcrossAllDates,
    } = getTasksAcrossAllDatesAndWithExpandedSubtasksByDate(dates, tasksByDate)

    return {
        dates,
        tasksAcrossAllDates,
        tasksAndExpandedSubtasksByDate,
        tasksAndExpandedSubtasksAcrossAllDates,
    }
}

const convertIndexInTasksAndExpandedSubtasksInDateToIndexInTasksAndExpandedSubtasksAcrossAllDates = (
    indexInDateWithExpandedSubtasks,
    indexDate,
    dates,
    tasksAndExpandedSubtasksByDate
) => {
    let indexInAllDatesList = 0
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i]
        if (date === indexDate) {
            indexInAllDatesList += indexInDateWithExpandedSubtasks
            break
        } else {
            const tasks = tasksAndExpandedSubtasksByDate[date]
            indexInAllDatesList += tasks.length
        }
    }
    return indexInAllDatesList
}

const getIndexesInTasksAndExpandedSubtasksAcrossAllDates = (
    sourceIndexInDateWithExpandedSubtasks,
    sourceDate,
    destinationIndexInDateWithExpandedSubtasks,
    destinationDate,
    dates,
    tasksAndExpandedSubtasksByDate
) => {
    const sourceIndexInDateWithExpandedSubtasksAcrossAllDates = convertIndexInTasksAndExpandedSubtasksInDateToIndexInTasksAndExpandedSubtasksAcrossAllDates(
        sourceIndexInDateWithExpandedSubtasks,
        sourceDate,
        dates,
        tasksAndExpandedSubtasksByDate
    )
    let destinationIndexInDateWithExpandedSubtasksAcrossAllDates = convertIndexInTasksAndExpandedSubtasksInDateToIndexInTasksAndExpandedSubtasksAcrossAllDates(
        destinationIndexInDateWithExpandedSubtasks,
        destinationDate,
        dates,
        tasksAndExpandedSubtasksByDate
    )
    if (sourceDate !== destinationDate) {
        if (moment(sourceDate, 'YYYYMMDD').isBefore(moment(destinationDate, 'YYYYMMDD'))) {
            destinationIndexInDateWithExpandedSubtasksAcrossAllDates--
        }
    }
    return {
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
    }
}

const getProjectSubtasksByTaskWhenDragging = task => {
    const { myDayOpenSubtasksMap } = store.getState()
    return task && myDayOpenSubtasksMap[task.projectId] ? myDayOpenSubtasksMap[task.projectId] : {}
}

const getDraggingTask = draggingTaskId => {
    const { myDaySortingSelectedTasks, myDaySortingOtherTasks, myDaySortingSubtasksMap } = store.getState()
    const task =
        myDaySortingSubtasksMap[draggingTaskId] ||
        myDaySortingSelectedTasks.find(task => task.id === draggingTaskId) ||
        myDaySortingOtherTasks.find(task => task.id === draggingTaskId)
    return task
}

const generateSubtasksByTaskMapAcrossAllProjects = () => {
    const { myDayOpenSubtasksMap } = store.getState()

    const subtasksByTaskArrays = Object.values(myDayOpenSubtasksMap)

    let subtasksByTaskMap = {}
    subtasksByTaskArrays.forEach(subtasksByTask => {
        subtasksByTaskMap = { ...subtasksByTaskMap, ...subtasksByTask }
    })

    return subtasksByTaskMap
}

const getSortingData = (draggingTaskId, source, destination) => {
    const {
        dates,
        tasksAndExpandedSubtasksByDate,
        tasksAndExpandedSubtasksAcrossAllDates,
        tasksAcrossAllDates,
    } = getDatesAndTasksAndSubtasksExpandedByDate()

    const sourceDate = source.droppableId
    const sourceIndexInDateWithExpandedSubtasks = source.index
    const sourceTask = { ...getDraggingTask(draggingTaskId) }

    const destinationDate = destination.droppableId
    const destinationIndexInDateWithExpandedSubtasks = destination.index

    const {
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
    } = getIndexesInTasksAndExpandedSubtasksAcrossAllDates(
        sourceIndexInDateWithExpandedSubtasks,
        sourceDate,
        destinationIndexInDateWithExpandedSubtasks,
        destinationDate,
        dates,
        tasksAndExpandedSubtasksByDate
    )

    return {
        sourceTask,
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
        tasksAndExpandedSubtasksAcrossAllDates,
        tasksAcrossAllDates,
    }
}

const moveProjectToNewPosition = (projects, startIndex, endIndex) => {
    const sortedList = [...projects]
    const [removed] = sortedList.splice(startIndex, 1)
    sortedList.splice(endIndex, 0, removed)
    return sortedList
}

const sortProjects = (sourceProjectId, destinationProjectId) => {
    const { loggedUserProjects, loggedUser } = store.getState()
    const { archivedProjectIds, templateProjectIds, guideProjectIds } = loggedUser

    const projects = loggedUserProjects.filter(
        project =>
            !templateProjectIds.includes(project.id) &&
            !archivedProjectIds.includes(project.id) &&
            !guideProjectIds.includes(project.id)
    )

    const sortedProjectsData = ProjectHelper.sortProjects(projects, loggedUser.uid)

    const projectSourceIndex = sortedProjectsData.findIndex(project => project.id === sourceProjectId)
    const projectDestinationIndex = sortedProjectsData.findIndex(project => project.id === destinationProjectId)

    const sortedList = moveProjectToNewPosition(sortedProjectsData, projectSourceIndex, projectDestinationIndex)

    return sortedList
}

const updateProjectSortIndexes = (sortedProjects, batch) => {
    const { loggedUser } = store.getState()

    const projectsMap = {}
    for (let i = sortedProjects.length - 1; i >= 0; i--) {
        const project = sortedProjects[i]
        const sortIndex = generateSortIndex()
        setProjectSortIndex(project.id, loggedUser.uid, sortIndex, batch)
        projectsMap[project.id] = {
            ...project,
            sortIndexByUser: { ...project.sortIndexByUser, [loggedUser.uid]: sortIndex },
        }
    }

    return projectsMap
}

const updateLocalData = sourceList => {
    const { loggedUser, myDaySelectedTasks, myDayOtherTasks, loggedUserProjectsMap } = store.getState()

    const sourceListIds = sourceList.map(task => task.id)
    const calendarAndCommunityTasks = [...myDaySelectedTasks, ...myDayOtherTasks].filter(
        task => !sourceListIds.includes(task.id)
    )

    const {
        selectedTasks,
        otherTasks,
        selectedTasksForSortingMode,
        otherTasksForSortingMode,
    } = selectTasksAndAddTimeIntervale([...calendarAndCommunityTasks, ...sourceList], loggedUser, loggedUserProjectsMap)

    store.dispatch(
        setMyDaySelectedAndOtherTasks(selectedTasks, otherTasks, selectedTasksForSortingMode, otherTasksForSortingMode)
    )
}

const updateSortIndexInSameList = (sourceTask, sourceList, indexInSourceList, indexInDestinationList, batch) => {
    const sourceTaskIsSubtask = sourceTask.isSubtask

    if (indexInDestinationList === 0) {
        sourceTask.sortIndex = Backend.generateSortIndex()

        const sortTaskData = []
        let nextSortIndex = sourceTask.sortIndex - 1
        sourceList.forEach(task => {
            if (task.projectId === sourceTask.projectId && task.id !== sourceTask.id) {
                task.sortIndex = nextSortIndex
                sortTaskData.push({
                    id: task.id,
                    sortIndex: task.sortIndex,
                    userId: task.userId,
                    projectId: task.projectId,
                })
                nextSortIndex--
            }
        })

        updateSortTaskIndex(
            sourceTask.projectId,
            sourceTask,
            sourceTaskIsSubtask ? [] : [...sortTaskData, sourceTask],
            batch
        )
    } else if (indexInDestinationList === sourceList.length - 1) {
        const newSortIndex = sourceList[indexInDestinationList].sortIndex - 1
        sourceTask.sortIndex = newSortIndex >= generateSortIndexForTaskInFocus() ? generateSortIndex() : newSortIndex
        updateSortTaskIndex(sourceTask.projectId, sourceTask, [], batch)
    } else {
        sourceTask.sortIndex =
            indexInDestinationList > indexInSourceList
                ? sourceList[indexInDestinationList].sortIndex - 1
                : sourceList[indexInDestinationList].sortIndex + 1

        const sortTaskData = []
        let newSortIndex = sourceTask.sortIndex
        sortTaskData.push({ id: sourceTask.id, sortIndex: newSortIndex })

        let taskDataToCheckIfAreFocused = [sourceTask]

        if (indexInDestinationList > indexInSourceList) {
            for (let i = indexInDestinationList + 1; i < sourceList.length; i++) {
                if (newSortIndex === sourceList[i].sortIndex) {
                    if (indexInSourceList !== i) {
                        if (sourceList[i].projectId === sourceTask.projectId) {
                            newSortIndex--
                            sortTaskData.push({ id: sourceList[i].id, sortIndex: newSortIndex })
                            sourceList[i].sortIndex = newSortIndex
                        }
                    }
                } else {
                    break
                }
            }
        } else {
            for (let i = indexInDestinationList - 1; i >= 0; i--) {
                if (newSortIndex === sourceList[i].sortIndex) {
                    if (indexInSourceList !== i) {
                        if (sourceList[i].projectId === sourceTask.projectId) {
                            newSortIndex++
                            sortTaskData.push({
                                id: sourceList[i].id,
                                sortIndex: newSortIndex,
                                userId: sourceList[i].userId,
                            })
                            sourceList[i].sortIndex = newSortIndex
                        }
                    }
                } else {
                    break
                }
            }

            if (!sourceTaskIsSubtask) {
                taskDataToCheckIfAreFocused = []
                for (let i = indexInDestinationList; i < sourceList.length; i++) {
                    if (indexInSourceList !== i) {
                        if (sourceList[i].projectId === sourceTask.projectId) {
                            taskDataToCheckIfAreFocused.push({
                                id: sourceList[i].id,
                                sortIndex: sourceList[i].sortIndex,
                                userId: sourceList[i].userId,
                                name: sourceList[i].name,
                            })
                        }
                    } else {
                        break
                    }
                }
            }
        }
        updateListTasksSortIndex(
            sourceTask.projectId,
            sortTaskData,
            sourceTaskIsSubtask ? [] : taskDataToCheckIfAreFocused,
            batch
        )
    }
}

const findTaskIndex = (taskList, taskId) => {
    for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i]
        if (task.id === taskId) {
            return i
        }
    }
    return -1
}

const getDestinationData = (
    sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
    destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
    tasksAndExpandedSubtasksAcrossAllDates,
    subtaskByTask,
    sourceData
) => {
    const destinationTask =
        tasksAndExpandedSubtasksAcrossAllDates[destinationIndexInDateWithExpandedSubtasksAcrossAllDates]
    const { subtaskIds, parentId, id, projectId } = destinationTask
    if (
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates < destinationIndexInDateWithExpandedSubtasksAcrossAllDates
    ) {
        const { tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode } = store.getState()
        const nextTask =
            tasksAndExpandedSubtasksAcrossAllDates[destinationIndexInDateWithExpandedSubtasksAcrossAllDates + 1]
        const destinationIsParentTask = tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode[id] && subtaskIds?.length > 0
        const thisAndNextTaskAreSubtasks = parentId && nextTask && nextTask.parentId
        const sourceAndDestinationAreTheSameSubtaskList = parentId && sourceData.parentId === parentId
        const sourceAndDestinationAreDifferentSubtaskLists =
            parentId && sourceData.parentId && sourceData.parentId !== parentId

        if (destinationIsParentTask) {
            return { type: LIST_TYPE_SUBTASK, parentId: id, subtaskIndex: 0, projectId }
        }

        if (sourceAndDestinationAreTheSameSubtaskList) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: findTaskIndex(subtaskByTask[parentId], id),
                projectId,
            }
        }

        if (thisAndNextTaskAreSubtasks) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: findTaskIndex(subtaskByTask[parentId], nextTask.id),
                projectId,
            }
        }

        if (sourceAndDestinationAreDifferentSubtaskLists) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: subtaskByTask[parentId].length,
                projectId,
            }
        }

        return { type: LIST_TYPE_TASK, projectId }
    } else {
        if (parentId) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: findTaskIndex(subtaskByTask[parentId], id),
                projectId,
            }
        } else {
            const previousTask =
                tasksAndExpandedSubtasksAcrossAllDates[destinationIndexInDateWithExpandedSubtasksAcrossAllDates - 1]
            const sourceAndPreviousTasksAreSubtasks = sourceData.parentId && previousTask?.parentId
            if (sourceAndPreviousTasksAreSubtasks) {
                const subParentId = sourceAndPreviousTasksAreSubtasks ? previousTask.parentId : id
                const subtaskList = subtaskByTask[subParentId]
                return {
                    type: LIST_TYPE_SUBTASK,
                    parentId: subParentId,
                    subtaskIndex: sourceAndPreviousTasksAreSubtasks ? subtaskList?.length || 0 : 0,
                    projectId,
                }
            }
            return { type: LIST_TYPE_TASK, projectId }
        }
    }
}

const getSourceData = (sourceTask, indexInSourceList) => {
    const { parentId, projectId } = sourceTask
    return parentId
        ? {
              type: LIST_TYPE_SUBTASK,
              parentId,
              subtaskIndex: indexInSourceList,
              projectId,
          }
        : { type: LIST_TYPE_TASK, projectId }
}

const getDestinationAndSourceEquality = (destinationData, sourceData) => {
    if (sourceData.type === destinationData.type) {
        if (sourceData.type === LIST_TYPE_TASK || sourceData.parentId === destinationData.parentId) {
            return SOURCE_AND_DESTINATION_LISTS_ARE_EQUALS
        }
        return SOURCE_AND_DESTINATION_ARE_NOT_EQUALS_SUBTASKS_LISTS
    }
    return sourceData.type === LIST_TYPE_TASK
        ? SOURCE_IS_TASK_LIST_AND_DESTINATION_IS_SUBTASK_LIST
        : SOURCE_IS_SUBTASK_LIST_AND_DESTINATION_IS_TASK_LIST
}

const getSourceAndDestinationData = (
    sourceTask,
    indexInSourceList,
    tasksAndExpandedSubtasksAcrossAllDates,
    subtasksByTaskMap,
    sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
    destinationIndexInDateWithExpandedSubtasksAcrossAllDates
) => {
    const sourceData = getSourceData(sourceTask, indexInSourceList)
    const destinationData = getDestinationData(
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
        tasksAndExpandedSubtasksAcrossAllDates,
        subtasksByTaskMap,
        sourceData
    )

    if (destinationData.type === LIST_TYPE_SUBTASK) {
        const indexInDestinationList = destinationData.subtaskIndex
        return { indexInDestinationList, sourceData, destinationData }
    } else {
        let amountOfSubtasksBeforeIndex = 0
        for (let i = 0; i <= destinationIndexInDateWithExpandedSubtasksAcrossAllDates; i++) {
            const task = tasksAndExpandedSubtasksAcrossAllDates[i]
            const { parentId } = task
            if (parentId) {
                amountOfSubtasksBeforeIndex++
            }
        }

        const indexInDestinationList =
            destinationIndexInDateWithExpandedSubtasksAcrossAllDates - amountOfSubtasksBeforeIndex
        return { indexInDestinationList, sourceData, destinationData }
    }
}

const checkIfIsInvalidDestination = (source, destination) => {
    return !destination || (destination.droppableId === source.droppableId && destination.index === source.index)
}

const getDestinationIndexBasedOnTheProjectIndex = (tasks, sourceIndex, destinationIndex, tasksAreInTheSameProject) => {
    if (
        tasksAreInTheSameProject ||
        destinationIndex === 0 ||
        destinationIndex === tasks.length - 1 ||
        sourceIndex === destinationIndex
    ) {
        return destinationIndex
    }

    if (sourceIndex < destinationIndex) {
        const destinationProjectId = tasks[destinationIndex].projectId
        let lastIndexInDestinationProject = destinationIndex
        for (let i = destinationIndex; i < tasks.length; i++) {
            if (tasks[i].projectId !== destinationProjectId) break
            lastIndexInDestinationProject = i
        }
        return lastIndexInDestinationProject
    } else {
        const displacedDestinationIndex = destinationIndex - 1
        const destinationProjectId = tasks[displacedDestinationIndex].projectId
        let lastIndexInDestinationProject = displacedDestinationIndex
        for (let i = displacedDestinationIndex; i < tasks.length; i++) {
            if (tasks[i].projectId !== destinationProjectId) break
            lastIndexInDestinationProject = i
        }
        lastIndexInDestinationProject++
        return lastIndexInDestinationProject
    }
}

export const onBeforeCapture = dragData => {
    const task = getDraggingTask(dragData.draggableId)
    const subtaskByTask = getProjectSubtasksByTaskWhenDragging(task)

    const { draggableId } = dragData
    subtaskByTask[draggableId]
        ? store.dispatch([isDragging(true), setDraggingParentTaskId(draggableId)])
        : store.dispatch(isDragging(true))
}

export const onDragEnd = result => {
    const { draggingParentTaskId } = store.getState()
    const { draggableId, source, destination } = result

    store.dispatch(isDragging(false))

    if (checkIfIsInvalidDestination(source, destination)) {
        if (draggingParentTaskId) store.dispatch(setDraggingParentTaskId(''))
        return
    }

    const {
        sourceTask,
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
        tasksAndExpandedSubtasksAcrossAllDates,
        tasksAcrossAllDates,
    } = getSortingData(draggableId, source, destination)

    if (
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates === destinationIndexInDateWithExpandedSubtasksAcrossAllDates
    ) {
        if (draggingParentTaskId) store.dispatch(setDraggingParentTaskId(''))
        return
    }

    const subtasksByTaskMap = generateSubtasksByTaskMapAcrossAllProjects()

    sortTask(
        sourceTask,
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
        subtasksByTaskMap,
        tasksAndExpandedSubtasksAcrossAllDates,
        tasksAcrossAllDates,
        draggableId
    )

    if (draggingParentTaskId) store.dispatch(setDraggingParentTaskId(''))
}

const sortTask = (
    sourceTask,
    sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
    destinationIndexInDateWithExpandedSubtasksAcrossAllDates,
    subtasksByTaskMap,
    tasksAndExpandedSubtasksAcrossAllDates,
    tasksAcrossAllDates,
    draggableId
) => {
    const sourceList = cloneDeep(sourceTask.parentId ? subtasksByTaskMap[sourceTask.parentId] : tasksAcrossAllDates)
    const indexInSourceList = findTaskIndex(sourceList, draggableId)

    sourceList[indexInSourceList] = sourceTask

    let { indexInDestinationList, destinationData, sourceData } = getSourceAndDestinationData(
        sourceTask,
        indexInSourceList,
        tasksAndExpandedSubtasksAcrossAllDates,
        subtasksByTaskMap,
        sourceIndexInDateWithExpandedSubtasksAcrossAllDates,
        destinationIndexInDateWithExpandedSubtasksAcrossAllDates
    )
    const destinationAndSourceEquality = getDestinationAndSourceEquality(destinationData, sourceData)

    if (destinationAndSourceEquality === SOURCE_AND_DESTINATION_LISTS_ARE_EQUALS) {
        if (destinationData.type === LIST_TYPE_TASK) {
            const sourceAndDestinationAreInTheSameProject = sourceData.projectId === destinationData.projectId
            const indexInDestinationListBasedOnTheProjectIndex = getDestinationIndexBasedOnTheProjectIndex(
                sourceList,
                indexInSourceList,
                indexInDestinationList,
                sourceAndDestinationAreInTheSameProject
            )

            const sourceProjectId = sourceList[indexInSourceList].projectId
            const destinationProjectId = sourceList[indexInDestinationListBasedOnTheProjectIndex].projectId

            const batch = new BatchWrapper(getDb())

            if (sourceProjectId !== destinationProjectId) {
                const sortedProjects = sortProjects(sourceProjectId, destinationProjectId)
                const sortedProjectsMap = updateProjectSortIndexes(sortedProjects, batch)
                store.dispatch(setProjectsSortIndex(sortedProjectsMap))
            }

            if (indexInSourceList !== indexInDestinationListBasedOnTheProjectIndex) {
                updateSortIndexInSameList(
                    sourceTask,
                    sourceList,
                    indexInSourceList,
                    indexInDestinationListBasedOnTheProjectIndex,
                    batch
                )
            }

            updateLocalData(sourceList)

            batch.commit()
        } else {
            updateSortIndexInSameList(sourceTask, sourceList, indexInSourceList, indexInDestinationList)

            store.dispatch(
                setMyDaySubtasksInTask(
                    orderBy(sourceList, [subtask => subtask.sortIndex], ['desc']),
                    sourceTask.projectId,
                    sourceTask.parentId
                )
            )
        }
    }
}
