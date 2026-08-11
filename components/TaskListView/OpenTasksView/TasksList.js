import React, { useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import DroppableTaskList from '../../DragSystem/DroppableTaskList'
import ParentTaskContainer from '../ParentTaskContainer'
import {
    CALENDAR_TASK_INDEX,
    EMAIL_TASK_INDEX,
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
} from '../../../utils/backends/openTasks'
import { sortTasksByPriority } from '../../../utils/TaskPriority'
import { useIsUserEditing } from '../../../utils/editingGuard'
import { holdWhileEditing } from './focusSectionPin'

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

    const priorityTaskListIndexes = [
        MAIN_TASK_INDEX,
        MENTION_TASK_INDEX,
        SUGGESTED_TASK_INDEX,
        OBSERVED_TASKS_INDEX,
        STREAM_AND_USER_TASKS_INDEX,
        EMAIL_TASK_INDEX,
    ]
    const shouldSortByPriority =
        priorityTaskListIndexes.includes(taskListIndex) && taskListIndex !== CALENDAR_TASK_INDEX
    const sortedTaskList = shouldSortByPriority
        ? sortTasksByPriority(taskList, isActiveOrganizeMode ? null : effectiveFocusTaskId)
        : [...taskList]

    return (
        <View style={[localStyles.container, containerStyle]}>
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
                sortedTaskList.map((task, index) => {
                    if (amountToRender === undefined || amountToRender === null || amountToRender > index) {
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
                    } else {
                        return null
                    }
                })
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
})
