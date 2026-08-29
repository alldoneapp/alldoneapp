import React, { useRef } from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import DroppableTaskList from '../../DragSystem/DroppableTaskList'
import ParentTaskContainer from '../ParentTaskContainer'
import {
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
} from '../../../utils/backends/openTasks'
import { sortTasksByPriority } from '../../../utils/TaskPriority'
import { useIsUserEditing } from '../../../utils/editingGuard'
import { holdWhileEditing } from './focusSectionPin'
import { holdTaskOrder } from './taskPlacementHold'
import { taskPresentationLayout } from '../TaskItem/TaskPresentation/TaskPresentationLayout'

export default function TasksList({
    projectId,
    dateIndex,
    isActiveOrganizeMode,
    taskList,
    taskListIndex,
    containerStyle,
    isObservedTask,
    isToReviewTask,
    isSuggested,
    goalIndex,
    amountToRender,
    instanceKey,
    inParentGoal,
    focusedTaskId,
}) {
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}
    // Get the optimistic focus task ID for immediate UI update before Firestore confirms
    const optimisticFocusTaskId = useSelector(state => state.optimisticFocusTaskId)
    const optimisticFocusTaskProjectId = useSelector(state => state.optimisticFocusTaskProjectId)
    const optimisticFocusActive = useSelector(state => state.optimisticFocusActive)

    // When optimistic state is active for this project, use it (even if null = no task focused yet)
    const liveFocusTaskId =
        optimisticFocusActive && optimisticFocusTaskProjectId === projectId ? optimisticFocusTaskId : focusedTaskId

    // AT-2249 - the focus task is boosted to the top of its list, and that boost reorders a keyed
    // list: React moves the DOM nodes and blurs whatever is focused inside them. So while the user
    // is busy, hold the boost exactly as it was in the last idle render. An applied boost stays
    // applied (opening an editor never moves a task), and a focus change arriving from elsewhere is
    // deferred to the next idle render instead of yanking the caret. See focusSectionPin.js.
    const isUserEditing = useIsUserEditing()
    const heldFocusTaskIdRef = useRef(undefined)
    const effectiveFocusTaskId = holdWhileEditing(liveFocusTaskId || null, isUserEditing, heldFocusTaskIdRef)

    // AT-2267 - the same guard, one level down. Assigning a goal in the background also regenerates
    // `sortIndex`, and a background priority change re-sorts too, so the rendered order of an
    // otherwise untouched list can change under an open editor. React reorders a keyed list by moving
    // DOM nodes and moving a node blurs what is focused inside it, so hold the order the rows were
    // last rendered in. See taskPlacementHold.js.
    const heldTaskOrderRef = useRef(undefined)

    const priorityTaskListIndexes = [
        MAIN_TASK_INDEX,
        MENTION_TASK_INDEX,
        SUGGESTED_TASK_INDEX,
        OBSERVED_TASKS_INDEX,
        STREAM_AND_USER_TASKS_INDEX,
    ]
    const shouldSortByPriority = priorityTaskListIndexes.includes(taskListIndex)
    const sortedTaskList = holdTaskOrder(
        shouldSortByPriority
            ? sortTasksByPriority(taskList, isActiveOrganizeMode ? null : effectiveFocusTaskId)
            : [...taskList],
        isUserEditing,
        heldTaskOrderRef
    )

    const visibleTasks = sortedTaskList.filter(
        (_, index) => amountToRender === undefined || amountToRender === null || amountToRender > index
    )
    return (
        <View style={[taskPresentationLayout.listContainer, containerStyle]}>
            {isActiveOrganizeMode ? (
                <DroppableTaskList
                    projectId={projectId}
                    taskList={sortedTaskList}
                    taskListIndex={taskListIndex}
                    dateIndex={dateIndex}
                    subtaskByTask={subtaskByTask}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    goalIndex={goalIndex}
                />
            ) : (
                visibleTasks.map(task => {
                    const subtaskList = subtaskByTask[task.id] ? subtaskByTask[task.id] : []
                    return (
                        <ParentTaskContainer
                            key={task.id}
                            task={task}
                            projectId={projectId}
                            subtaskList={subtaskList ? subtaskList : []}
                            isObservedTask={isObservedTask}
                            isToReviewTask={isToReviewTask}
                            isSuggested={isSuggested}
                            inParentGoal={inParentGoal}
                        />
                    )
                })
            )}
        </View>
    )
}
