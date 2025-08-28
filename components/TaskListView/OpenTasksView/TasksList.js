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

    let sortedTaskList = [...taskList]

    if (focusedTaskId && !isActiveOrganizeMode) {
        const focusedTaskIndex = sortedTaskList.findIndex(task => task.id === focusedTaskId)
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
