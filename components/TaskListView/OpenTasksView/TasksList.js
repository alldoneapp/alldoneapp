import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import DroppableTaskList from '../../DragSystem/DroppableTaskList'
import ParentTaskContainer from '../ParentTaskContainer'

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

    let sortedTaskList = [...taskList]

    // When optimistic state is active for this project, use it (even if null = no task focused yet)
    const effectiveFocusTaskId =
        optimisticFocusActive && optimisticFocusTaskProjectId === projectId ? optimisticFocusTaskId : focusedTaskId

    if (effectiveFocusTaskId && !isActiveOrganizeMode) {
        const focusedTaskIndex = sortedTaskList.findIndex(task => task.id === effectiveFocusTaskId)
        if (focusedTaskIndex > -1) {
            const [focusedTask] = sortedTaskList.splice(focusedTaskIndex, 1)
            sortedTaskList.unshift(focusedTask)
        }
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            {isActiveOrganizeMode ? (
                <DroppableTaskList
                    projectId={projectId}
                    taskList={taskList}
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
