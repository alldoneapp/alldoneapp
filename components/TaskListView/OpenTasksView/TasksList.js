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
    // DEBUG: Log TasksList props and processing
    console.log(`[TASKS LIST DEBUG] TasksList called:`)
    console.log(`  - taskList:`, taskList)
    console.log(`  - taskList.length: ${taskList ? taskList.length : 'null/undefined'}`)
    console.log(`  - amountToRender: ${amountToRender}`)
    console.log(`  - inParentGoal: ${inParentGoal}`)
    console.log(`  - isActiveOrganizeMode: ${isActiveOrganizeMode}`)
    if (taskList && taskList.length > 0) {
        taskList.forEach((task, index) => {
            console.log(
                `    Task ${index}: ${task.id} (${task.title || 'No title'}) - will render: ${
                    amountToRender === undefined || amountToRender === null || amountToRender > index ? 'YES' : 'NO'
                }`
            )
        })
    }
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
                    const shouldRender =
                        amountToRender === undefined || amountToRender === null || amountToRender > index
                    console.log(
                        `[TASKS LIST DEBUG] Processing task ${index} (${task.id}): shouldRender=${shouldRender}`
                    )

                    if (shouldRender) {
                        const subtaskList = subtaskByTask[task.id] ? subtaskByTask[task.id] : []
                        console.log(`[TASKS LIST DEBUG] Rendering ParentTaskContainer for task ${task.id}`)
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
                        console.log(`[TASKS LIST DEBUG] NOT rendering task ${task.id} due to amountToRender limit`)
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
