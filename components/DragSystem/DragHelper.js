import { cloneDeep } from 'lodash'

import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import { setDraggingParentTaskId, isDragging, updateSubtaskByTask } from '../../redux/actions'
import {
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    WORKFLOW_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    updateAndFilterTasksTasks,
} from '../../utils/backends/openTasks'
import {
    updateSortTaskIndex,
    updateSubtasksDataWhenSortPromoteSubtask,
    updateSubtasksDataWhenSortDegradeTask,
    updateSubtasksDataWhenSortBetweenSubtasksLists,
    updateListTasksSortIndex,
} from '../../utils/backends/Tasks/dragTasksFirestore'
import { generateSortIndex } from '../../utils/backends/firestore'
import { generateSortIndexForTaskInFocus } from '../../utils/backends/Tasks/tasksFirestore'

const DIVISION_MARKER = '&'
const LIST_TYPE_TASK = 0
const LIST_TYPE_SUBTASK = 1
const SOURCE_AND_DESTINATION_LISTS_ARE_EQUALS = 0
const SOURCE_AND_DESTINATION_ARE_NOT_EQUALS_SUBTASKS_LISTS = 1
const SOURCE_IS_SUBTASK_LIST_AND_DESTINATION_IS_TASK_LIST = 2
const SOURCE_IS_TASK_LIST_AND_DESTINATION_IS_SUBTASK_LIST = 3

export const generateDroppableListId = (projectId, goalIndex, taskListIndex, dateIndex, nestedTaskListIndex) => {
    const dateIndexData = dateIndex >= 0 ? `${DIVISION_MARKER}${dateIndex}` : DIVISION_MARKER
    const nestedTaskListIndexData =
        nestedTaskListIndex >= 0 ? `${DIVISION_MARKER}${nestedTaskListIndex}` : DIVISION_MARKER
    return `${projectId}${DIVISION_MARKER}${taskListIndex}${dateIndexData}${nestedTaskListIndexData}${DIVISION_MARKER}${goalIndex}`
}

const getTasksCopies = (
    parentTaskId,
    parsedTaskListIndex,
    nestedTaskListIndex,
    dateIndex,
    openTasks,
    subtaskByTask,
    goalIndex
) => {
    const baseList =
        parsedTaskListIndex === MAIN_TASK_INDEX || parsedTaskListIndex === MENTION_TASK_INDEX
            ? openTasks[dateIndex][parsedTaskListIndex][goalIndex][1]
            : openTasks[dateIndex][parsedTaskListIndex][nestedTaskListIndex][1][goalIndex][1]

    return { baseList, sourceList: parentTaskId ? subtaskByTask[parentTaskId] : baseList }
}

const updatePropertiesFromParent = (subtask, parent) => {
    subtask.completed = parent.completed
    subtask.dueDate = parent.dueDate
    subtask.parentDone = parent.done
    subtask.inDone = parent.inDone
    subtask.userId = parent.userId
    subtask.userIds = parent.userIds
    subtask.currentReviewerId = parent.currentReviewerId
    subtask.stepHistory = parent.stepHistory
    subtask.observersIds = parent.observersIds
    subtask.dueDateByObserversIds = parent.dueDateByObserversIds
    subtask.estimationsByObserverIds = parent.estimationsByObserverIds
    subtask.parentGoalId = parent.parentGoalId
    subtask.parentGoalIsPublicFor = parent.parentGoalIsPublicFor
    subtask.lockKey = parent.lockKey
}

const updateSortIndexWhenDegradedTask = (
    projectId,
    newLocalTasks,
    newIndex,
    movedTask,
    destinationData,
    movedSubtasksList
) => {
    const { openTasksMap } = store.getState()
    const destinationParent = openTasksMap[projectId][destinationData.parentId]

    updatePropertiesFromParent(movedTask, destinationParent)

    movedSubtasksList.forEach(subtask => {
        updatePropertiesFromParent(subtask, destinationParent)
    })

    if (newIndex === 0) {
        movedTask.sortIndex = Backend.generateSortIndex()

        const sortTaskData = []

        if (movedSubtasksList.length > 0) {
            let newSortIndex = movedTask.sortIndex - 1
            movedSubtasksList.forEach(subtask => {
                subtask.sortIndex = newSortIndex
                newSortIndex--
            })

            for (let i = 0; i < newLocalTasks.length; i++) {
                if (newSortIndex <= newLocalTasks[i].sortIndex) {
                    sortTaskData.push({ id: newLocalTasks[i].id, sortIndex: newSortIndex })
                    newLocalTasks[i].sortIndex = newSortIndex
                    newSortIndex--
                } else {
                    break
                }
            }
        }

        updateSubtasksDataWhenSortDegradeTask(projectId, movedTask, destinationParent, sortTaskData, movedSubtasksList)
    } else if (newIndex === newLocalTasks.length) {
        movedTask.sortIndex = newLocalTasks[newIndex - 1].sortIndex - 1

        if (movedSubtasksList.length > 0) {
            let newSortIndex = movedTask.sortIndex - 1
            movedSubtasksList.forEach(subtask => {
                subtask.sortIndex = newSortIndex
                newSortIndex--
            })
        }

        updateSubtasksDataWhenSortDegradeTask(projectId, movedTask, destinationParent, [], movedSubtasksList)
    } else {
        movedTask.sortIndex = newLocalTasks[newIndex].sortIndex

        const sortTaskData = []
        let newSortIndex = movedTask.sortIndex - 1

        if (movedSubtasksList.length > 0) {
            movedSubtasksList.forEach(subtask => {
                subtask.sortIndex = newSortIndex
                newSortIndex--
            })
        }

        for (let i = newIndex; i < newLocalTasks.length; i++) {
            if (newSortIndex <= newLocalTasks[i].sortIndex) {
                sortTaskData.push({ id: newLocalTasks[i].id, sortIndex: newSortIndex })
                newLocalTasks[i].sortIndex = newSortIndex
                newSortIndex--
            } else {
                break
            }
        }
        updateSubtasksDataWhenSortDegradeTask(projectId, movedTask, destinationParent, sortTaskData, movedSubtasksList)
    }
}

const updateSortIndexWhenPromoteSubtask = (projectId, newLocalTasks, newIndex, movedTask, sourceData) => {
    const { openTasksMap } = store.getState()
    const sourceParent = openTasksMap[projectId][sourceData.parentId]
    if (newIndex === 0) {
        movedTask.sortIndex = Backend.generateSortIndex()

        const sortTaskData = []
        let nextSortIndex = movedTask.sortIndex - 1
        newLocalTasks.forEach(task => {
            task.sortIndex = nextSortIndex
            sortTaskData.push({
                id: task.id,
                sortIndex: task.sortIndex,
                userId: task.userId,
            })
            nextSortIndex--
        })

        updateSubtasksDataWhenSortPromoteSubtask(
            projectId,
            movedTask.id,
            movedTask.sortIndex,
            sourceParent,
            sortTaskData,
            sortTaskData
        )
    } else if (newIndex === newLocalTasks.length) {
        const newSortIndex = newLocalTasks[newIndex - 1].sortIndex - 1
        movedTask.sortIndex = newSortIndex >= generateSortIndexForTaskInFocus() ? generateSortIndex() : newSortIndex
        updateSubtasksDataWhenSortPromoteSubtask(projectId, movedTask.id, movedTask.sortIndex, sourceParent, [], [])
    } else {
        movedTask.sortIndex = newLocalTasks[newIndex].sortIndex

        const sortTaskData = []
        let newSortIndex = movedTask.sortIndex

        for (let i = newIndex; i < newLocalTasks.length; i++) {
            if (newSortIndex === newLocalTasks[i].sortIndex) {
                newSortIndex--
                sortTaskData.push({
                    id: newLocalTasks[i].id,
                    sortIndex: newSortIndex,
                    userId: newLocalTasks[i].userId,
                })
                newLocalTasks[i].sortIndex = newSortIndex
            } else {
                break
            }
        }

        updateSubtasksDataWhenSortPromoteSubtask(
            projectId,
            movedTask.id,
            movedTask.sortIndex,
            sourceParent,
            sortTaskData,
            []
        )
    }
}

const updateSortIndexInDifferentSubtaskLists = (
    projectId,
    newLocalTasks,
    newIndex,
    movedTask,
    sourceData,
    destinationData
) => {
    const { openTasksMap } = store.getState()
    const sourceParent = openTasksMap[projectId][sourceData.parentId]
    const destinationParent = openTasksMap[projectId][destinationData.parentId]

    updatePropertiesFromParent(movedTask, destinationParent)

    if (newIndex === 0) {
        movedTask.sortIndex = Backend.generateSortIndex()
        updateSubtasksDataWhenSortBetweenSubtasksLists(
            projectId,
            movedTask.id,
            movedTask.sortIndex,
            sourceParent,
            destinationParent,
            []
        )
    } else if (newIndex === newLocalTasks.length) {
        movedTask.sortIndex = newLocalTasks[newIndex - 1].sortIndex - 1
        updateSubtasksDataWhenSortBetweenSubtasksLists(
            projectId,
            movedTask.id,
            movedTask.sortIndex,
            sourceParent,
            destinationParent,
            []
        )
    } else {
        movedTask.sortIndex = newLocalTasks[newIndex].sortIndex

        const sortTaskData = []
        let newSortIndex = movedTask.sortIndex

        for (let i = newIndex; i < newLocalTasks.length; i++) {
            if (newSortIndex === newLocalTasks[i].sortIndex) {
                newSortIndex--
                sortTaskData.push({ id: newLocalTasks[i].id, sortIndex: newSortIndex })
                newLocalTasks[i].sortIndex = newSortIndex
            } else {
                break
            }
        }
        updateSubtasksDataWhenSortBetweenSubtasksLists(
            projectId,
            movedTask.id,
            movedTask.sortIndex,
            sourceParent,
            destinationParent,
            sortTaskData
        )
    }
}

const updateSortIndexInSameList = (projectId, newLocalTasks, newIndex, oldIndex, movedTask) => {
    if (newIndex === 0) {
        movedTask.sortIndex = Backend.generateSortIndex()

        const sortTaskData = []
        let nextSortIndex = movedTask.sortIndex - 1
        newLocalTasks.forEach(task => {
            task.sortIndex = nextSortIndex
            sortTaskData.push({
                id: task.id,
                sortIndex: task.sortIndex,
                userId: task.userId,
            })
            nextSortIndex--
        })

        updateSortTaskIndex(projectId, movedTask, sortTaskData, null)
    } else if (newIndex === newLocalTasks.length - 1) {
        const newSortIndex = newLocalTasks[newIndex].sortIndex - 1
        movedTask.sortIndex = newSortIndex >= generateSortIndexForTaskInFocus() ? generateSortIndex() : newSortIndex
        updateSortTaskIndex(projectId, movedTask, [], null)
    } else {
        movedTask.sortIndex =
            newIndex > oldIndex ? newLocalTasks[newIndex].sortIndex - 1 : newLocalTasks[newIndex].sortIndex + 1

        const sortTaskData = []
        let newSortIndex = movedTask.sortIndex
        sortTaskData.push({ id: movedTask.id, sortIndex: newSortIndex })

        if (newIndex > oldIndex) {
            for (let i = newIndex + 1; i < newLocalTasks.length; i++) {
                if (newSortIndex === newLocalTasks[i].sortIndex) {
                    if (oldIndex !== i) {
                        newSortIndex--
                        sortTaskData.push({ id: newLocalTasks[i].id, sortIndex: newSortIndex })
                        newLocalTasks[i].sortIndex = newSortIndex
                    }
                } else {
                    break
                }
            }
        } else {
            for (let i = newIndex - 1; i >= 0; i--) {
                if (newSortIndex === newLocalTasks[i].sortIndex) {
                    if (oldIndex !== i) {
                        newSortIndex++
                        sortTaskData.push({
                            id: newLocalTasks[i].id,
                            sortIndex: newSortIndex,
                            userId: newLocalTasks[i].userId,
                        })
                        newLocalTasks[i].sortIndex = newSortIndex
                    }
                } else {
                    break
                }
            }
        }
        updateListTasksSortIndex(projectId, sortTaskData, [movedTask], null)
    }
}

const updateLocalBoardsWhenDegradeTask = (
    projectId,
    destinationData,
    sourceList,
    destinationList,
    movedTask,
    parsedTaskListIndex,
    nestedTaskListIndex,
    dateIndex,
    openTasks,
    subtaskByTask,
    instanceKey,
    goalIndex
) => {
    const { openTasksMap } = store.getState()
    const destinationParent = openTasksMap[projectId][destinationData.parentId]

    const taskSubtaskIds = subtaskByTask[movedTask.id] ? subtaskByTask[movedTask.id] : []
    destinationParent.subtaskIds = [...destinationParent.subtaskIds, movedTask.id, ...taskSubtaskIds]
    movedTask.parentId = destinationData.parentId
    movedTask.subtaskIds = []

    subtaskByTask[destinationData.parentId] = destinationList
    delete subtaskByTask[movedTask.id]
    store.dispatch(updateSubtaskByTask(instanceKey, subtaskByTask))

    parsedTaskListIndex === MAIN_TASK_INDEX || parsedTaskListIndex === MENTION_TASK_INDEX
        ? (openTasks[dateIndex][parsedTaskListIndex][goalIndex][1] = sourceList)
        : (openTasks[dateIndex][parsedTaskListIndex][nestedTaskListIndex][1][goalIndex][1] = sourceList)
    updateAndFilterTasksTasks(instanceKey, openTasks)
}

const updateLocalBoardsWhenPromoteSubtask = (
    projectId,
    sourceData,
    sourceList,
    destinationList,
    movedTask,
    parsedTaskListIndex,
    nestedTaskListIndex,
    dateIndex,
    openTasks,
    subtaskByTask,
    instanceKey,
    goalIndex
) => {
    const { openTasksMap } = store.getState()
    const sourceParent = openTasksMap[projectId][sourceData.parentId]

    sourceParent.subtaskIds = sourceParent.subtaskIds.filter(subtaskId => subtaskId !== movedTask.id)
    movedTask.parentId = null
    movedTask.isSubtask = false

    subtaskByTask[sourceData.parentId] = sourceList
    store.dispatch(updateSubtaskByTask(instanceKey, subtaskByTask))

    parsedTaskListIndex === MAIN_TASK_INDEX || parsedTaskListIndex === MENTION_TASK_INDEX
        ? (openTasks[dateIndex][parsedTaskListIndex][goalIndex][1] = destinationList)
        : (openTasks[dateIndex][parsedTaskListIndex][nestedTaskListIndex][1][goalIndex][1] = destinationList)
    updateAndFilterTasksTasks(instanceKey, openTasks)
}

const updateLocalBoardsInDifferentSubtaskLists = (
    projectId,
    destinationData,
    sourceData,
    sourceList,
    destinationList,
    movedTask,
    localNewIndex,
    openTasks,
    subtaskByTask,
    instanceKey
) => {
    const { openTasksMap } = store.getState()
    const sourceParent = openTasksMap[projectId][sourceData.parentId]
    const destinationParent = openTasksMap[projectId][destinationData.parentId]

    sourceParent.subtaskIds = sourceParent.subtaskIds.filter(subtaskId => subtaskId !== movedTask.id)
    destinationParent.subtaskIds.splice(localNewIndex, 0, movedTask.id)
    movedTask.parentId = destinationData.parentId
    movedTask.isSubtask = !!movedTask.parentId

    subtaskByTask[sourceData.parentId] = sourceList
    subtaskByTask[destinationData.parentId] = destinationList
    store.dispatch(updateSubtaskByTask(instanceKey, subtaskByTask))
    updateAndFilterTasksTasks(instanceKey, openTasks)
}

const updateLocalBoardsInSameList = (
    newLocalTasks,
    parsedTaskListIndex,
    nestedTaskListIndex,
    parentTaskId,
    dateIndex,
    openTasks,
    subtaskByTask,
    instanceKey,
    goalIndex
) => {
    if (parentTaskId) {
        subtaskByTask[parentTaskId] = newLocalTasks
        store.dispatch(updateSubtaskByTask(instanceKey, subtaskByTask))
    } else {
        parsedTaskListIndex === MAIN_TASK_INDEX || parsedTaskListIndex === MENTION_TASK_INDEX
            ? (openTasks[dateIndex][parsedTaskListIndex][goalIndex][1] = newLocalTasks)
            : (openTasks[dateIndex][parsedTaskListIndex][nestedTaskListIndex][1][goalIndex][1] = newLocalTasks)
        updateAndFilterTasksTasks(instanceKey, openTasks)
    }

    const { draggingParentTaskId } = store.getState()
    if (draggingParentTaskId) {
        store.dispatch(setDraggingParentTaskId(''))
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

const getMixedList = (draggableId, taskList, subtaskByTask) => {
    /* const mixedTaskList = [...taskList]
    for (let i = taskList.length - 1; i >= 0; i--) {
        const task = taskList[i]
        const { subtaskIds, id } = task
        if (subtaskIds && subtaskIds.length > 0) {
            if (draggableId !== id) {
                mixedTaskList.splice(i + 1, 0, ...subtaskByTask[id])
            }
        }
    }*/

    const { tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode } = store.getState()
    const mixedTaskList = []
    // const parentIds = {}

    for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i]
        const { id } = task
        mixedTaskList.push(task)
        if (subtaskByTask[id]) {
            //parentIds[id] = true
            if (tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode[id] && draggableId !== id) {
                mixedTaskList.push(...subtaskByTask[id])
            }
        }
    }

    return mixedTaskList
}

const getDestinationData = (oldIndex, newIndex, mixedList, subtaskByTask, sourceData, combine) => {
    const destinationTask = mixedList[newIndex]
    const { subtaskIds, parentId, id } = destinationTask
    if (oldIndex < newIndex) {
        const { tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode } = store.getState()
        const nextTask = mixedList[newIndex + 1]
        const destinationIsParentTask =
            (tasksIdsWithSubtasksExpandedWhenActiveDragTaskMode[id] && subtaskIds?.length > 0) || combine
        const thisAndNextTaskAreSubtasks = parentId && nextTask && nextTask.parentId
        const sourceAndDestinationAreTheSameSubtaskList = parentId && sourceData.parentId === parentId
        const sourceAndDestinationAreDifferentSubtaskLists =
            parentId && sourceData.parentId && sourceData.parentId !== parentId

        if (destinationIsParentTask) {
            return { type: LIST_TYPE_SUBTASK, parentId: id, subtaskIndex: 0 }
        }

        if (sourceAndDestinationAreTheSameSubtaskList) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: findTaskIndex(subtaskByTask[parentId], id),
            }
        }

        if (thisAndNextTaskAreSubtasks) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: findTaskIndex(subtaskByTask[parentId], nextTask.id),
            }
        }

        if (sourceAndDestinationAreDifferentSubtaskLists) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: subtaskByTask[parentId].length,
            }
        }

        return { type: LIST_TYPE_TASK }
    } else {
        if (parentId) {
            return {
                type: LIST_TYPE_SUBTASK,
                parentId,
                subtaskIndex: findTaskIndex(subtaskByTask[parentId], id),
            }
        } else {
            const previousTask = mixedList[newIndex - 1]
            const sourceAndPreviousTasksAreSubtasks = sourceData.parentId && previousTask?.parentId
            if (sourceAndPreviousTasksAreSubtasks || combine) {
                const subParentId = sourceAndPreviousTasksAreSubtasks ? previousTask.parentId : id
                const subtaskList = subtaskByTask[subParentId]
                return {
                    type: LIST_TYPE_SUBTASK,
                    parentId: subParentId,
                    subtaskIndex: sourceAndPreviousTasksAreSubtasks ? subtaskList?.length || 0 : 0,
                }
            }
            return { type: LIST_TYPE_TASK }
        }
    }
}

const getSourceData = (oldIndex, mixedList, subtaskByTask) => {
    const sourceTask = mixedList[oldIndex]
    const { parentId, id } = sourceTask
    return parentId
        ? {
              type: LIST_TYPE_SUBTASK,
              parentId,
              subtaskIndex: findTaskIndex(subtaskByTask[parentId], id),
          }
        : { type: LIST_TYPE_TASK }
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

const getSourceAndDestinationData = (oldIndex, newIndex, draggableId, baseList, subtaskByTask, combine) => {
    const mixedList = getMixedList(draggableId, baseList, subtaskByTask)
    const sourceData = getSourceData(oldIndex, mixedList, subtaskByTask)
    const destinationData = getDestinationData(oldIndex, newIndex, mixedList, subtaskByTask, sourceData, combine)

    if (destinationData.type === LIST_TYPE_SUBTASK) {
        const subtaskList = subtaskByTask[destinationData.parentId]
        const destinationList = subtaskList?.length > 0 ? Array.from(subtaskList) : []
        const localNewIndex = destinationData.subtaskIndex
        return { destinationList, localNewIndex, sourceData, destinationData }
    } else {
        let amountOfSubtasksBeforeIndex = 0
        for (let i = 0; i <= newIndex; i++) {
            const task = mixedList[i]
            const { parentId } = task
            if (parentId) {
                amountOfSubtasksBeforeIndex++
            }
        }

        const destinationList = baseList
        const localNewIndex = newIndex - amountOfSubtasksBeforeIndex
        return { destinationList, localNewIndex, sourceData, destinationData }
    }
}

export const onBeforeCapture = (subtaskByTask, dragData) => {
    const { draggableId } = dragData
    subtaskByTask[draggableId]
        ? store.dispatch([isDragging(true), setDraggingParentTaskId(draggableId)])
        : store.dispatch(isDragging(true))
}

export const onDragEnd = (result, initialOpenTasks, initialSubtaskByTask, instanceKey) => {
    const openTasks = cloneDeep(initialOpenTasks)
    const subtaskByTask = cloneDeep(initialSubtaskByTask)
    store.dispatch(isDragging(false))
    const { draggingParentTaskId } = store.getState()
    const { destination, source, draggableId, combine } = result
    if (
        combine == null &&
        (!destination || (destination.droppableId === source.droppableId && destination.index === source.index))
    ) {
        //Droped in the initial place, we do nothing
        if (draggingParentTaskId) {
            store.dispatch(setDraggingParentTaskId(''))
        }
        return
    }

    if (combine == null && (!destination || destination.droppableId !== source.droppableId)) {
        //Droped in another list, need to be implemented
        if (draggingParentTaskId) {
            store.dispatch(setDraggingParentTaskId(''))
        }
        return
    }

    //Droped in diferent place in the same list
    const { projectId, taskListIndex, nestedTaskListIndex, dateIndex, goalIndex } = extractDroppableListIdData(
        combine != null ? combine.droppableId : destination.droppableId
    )
    const oldIndex = source.index
    const newIndex = combine != null ? combine.index : destination.index
    sortTask(
        projectId,
        taskListIndex,
        nestedTaskListIndex,
        oldIndex,
        newIndex,
        dateIndex,
        draggableId,
        combine != null,
        openTasks,
        subtaskByTask,
        instanceKey,
        goalIndex
    )
    if (draggingParentTaskId) {
        store.dispatch(setDraggingParentTaskId(''))
    }
}

const extractDroppableListIdData = listId => {
    const data = listId.split(DIVISION_MARKER)
    return {
        projectId: data[0],
        taskListIndex: data[1],
        dateIndex: data[2],
        nestedTaskListIndex: data[3],
        goalIndex: data[4],
    }
}

const sortTask = (
    projectId,
    taskListIndex,
    nestedTaskListIndex,
    oldIndex,
    newIndex,
    dateIndex,
    draggableId,
    combine,
    openTasks,
    subtaskByTask,
    instanceKey,
    goalIndex
) => {
    const { openTasksMap: initialOpenTasksMap, openSubtasksMap: initialOpenSubtasksMap } = store.getState()
    const openTasksMap = cloneDeep(initialOpenTasksMap)
    const openSubtasksMap = cloneDeep(initialOpenSubtasksMap)

    const parsedTaskListIndex = parseInt(taskListIndex)
    const isSubtask = openSubtasksMap[projectId][draggableId] ? true : false
    const movedTask = isSubtask ? openSubtasksMap[projectId][draggableId] : openTasksMap[projectId][draggableId]
    const allowPromotedAndDegradeActions =
        parsedTaskListIndex !== MENTION_TASK_INDEX &&
        parsedTaskListIndex !== WORKFLOW_TASK_INDEX &&
        parsedTaskListIndex !== OBSERVED_TASKS_INDEX

    const { baseList, sourceList } = getTasksCopies(
        movedTask.parentId,
        parsedTaskListIndex,
        nestedTaskListIndex,
        dateIndex,
        openTasks,
        subtaskByTask,
        goalIndex
    )
    const localOldIndex = findTaskIndex(sourceList, draggableId)
    let { destinationList, localNewIndex, destinationData, sourceData } = getSourceAndDestinationData(
        oldIndex,
        newIndex,
        draggableId,
        baseList,
        subtaskByTask,
        combine
    )
    const destinationAndSourceEquality = getDestinationAndSourceEquality(destinationData, sourceData)
    if (destinationAndSourceEquality === SOURCE_AND_DESTINATION_LISTS_ARE_EQUALS) {
        updateSortIndexInSameList(projectId, sourceList, localNewIndex, localOldIndex, movedTask)
        sourceList.splice(localOldIndex, 1)
        sourceList.splice(localNewIndex, 0, movedTask)
        updateLocalBoardsInSameList(
            sourceList,
            parsedTaskListIndex,
            nestedTaskListIndex,
            sourceData.parentId,
            dateIndex,
            openTasks,
            subtaskByTask,
            instanceKey,
            goalIndex
        )
    } else if (destinationAndSourceEquality === SOURCE_AND_DESTINATION_ARE_NOT_EQUALS_SUBTASKS_LISTS) {
        updateSortIndexInDifferentSubtaskLists(
            projectId,
            destinationList,
            localNewIndex,
            movedTask,
            sourceData,
            destinationData
        )
        sourceList.splice(localOldIndex, 1)
        destinationList.splice(localNewIndex, 0, movedTask)
        updateLocalBoardsInDifferentSubtaskLists(
            projectId,
            destinationData,
            sourceData,
            sourceList,
            destinationList,
            movedTask,
            localNewIndex,
            openTasks,
            subtaskByTask,
            instanceKey
        )
    } else if (
        destinationAndSourceEquality === SOURCE_IS_SUBTASK_LIST_AND_DESTINATION_IS_TASK_LIST &&
        allowPromotedAndDegradeActions
    ) {
        if (newIndex > oldIndex) {
            localNewIndex++
        }

        updateSortIndexWhenPromoteSubtask(projectId, destinationList, localNewIndex, movedTask, sourceData)
        sourceList.splice(localOldIndex, 1)
        destinationList.splice(localNewIndex, 0, movedTask)
        updateLocalBoardsWhenPromoteSubtask(
            projectId,
            sourceData,
            sourceList,
            destinationList,
            movedTask,
            parsedTaskListIndex,
            nestedTaskListIndex,
            dateIndex,
            openTasks,
            subtaskByTask,
            instanceKey,
            goalIndex
        )
    } else if (
        destinationAndSourceEquality === SOURCE_IS_TASK_LIST_AND_DESTINATION_IS_SUBTASK_LIST &&
        allowPromotedAndDegradeActions
    ) {
        const movedSubtasksList =
            movedTask.subtaskIds && movedTask.subtaskIds.length > 0 ? [...subtaskByTask[movedTask.id]] : []

        updateSortIndexWhenDegradedTask(
            projectId,
            destinationList,
            localNewIndex,
            movedTask,
            destinationData,
            movedSubtasksList
        )
        sourceList.splice(localOldIndex, 1)
        destinationList.splice(localNewIndex, 0, movedTask, ...movedSubtasksList)
        updateLocalBoardsWhenDegradeTask(
            projectId,
            destinationData,
            sourceList,
            destinationList,
            movedTask,
            parsedTaskListIndex,
            nestedTaskListIndex,
            dateIndex,
            openTasks,
            subtaskByTask,
            instanceKey,
            goalIndex
        )
    }
}
