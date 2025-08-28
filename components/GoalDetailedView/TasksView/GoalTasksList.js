import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import DroppableTaskList from '../../DragSystem/DroppableTaskList'
import ParentTaskContainer from '../../TaskListView/ParentTaskContainer'

export default function GoalTasksList({
    projectId,
    dateIndex,
    isActiveOrganizeMode,
    taskList,
    taskListIndex,
    isSuggested,
}) {
    const goalOpenSubtasksByParent = useSelector(state => state.goalOpenSubtasksByParent)

    return (
        <View style={localStyles.container}>
            {isActiveOrganizeMode ? (
                <DroppableTaskList
                    projectId={projectId}
                    disableDrag={true}
                    taskList={taskList}
                    taskListIndex={taskListIndex}
                    dateIndex={dateIndex}
                    subtaskByTask={goalOpenSubtasksByParent}
                    goalIndex={''}
                />
            ) : (
                taskList.map(task => {
                    const subtaskList = goalOpenSubtasksByParent[task.id] ? goalOpenSubtasksByParent[task.id] : []

                    return (
                        <ParentTaskContainer
                            key={task.id}
                            task={task}
                            projectId={projectId}
                            subtaskList={subtaskList}
                            isSuggested={isSuggested}
                        />
                    )
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
