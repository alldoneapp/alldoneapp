import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import DroppableTaskList from '../../DragSystem/DroppableTaskList'
import ParentTaskContainer from '../../TaskListView/ParentTaskContainer'
import { CALENDAR_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import { sortTasksByPriority } from '../../../utils/TaskPriority'

export default function GoalTasksList({
    projectId,
    dateIndex,
    isActiveOrganizeMode,
    taskList,
    taskListIndex,
    isSuggested,
}) {
    const goalOpenSubtasksByParent = useSelector(state => state.goalOpenSubtasksByParent)
    const focusedTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const sortedTaskList =
        taskListIndex === CALENDAR_TASK_INDEX ? [...taskList] : sortTasksByPriority(taskList, focusedTaskId)

    return (
        <View style={localStyles.container}>
            {isActiveOrganizeMode ? (
                <DroppableTaskList
                    projectId={projectId}
                    disableDrag={true}
                    taskList={sortedTaskList}
                    taskListIndex={taskListIndex}
                    dateIndex={dateIndex}
                    subtaskByTask={goalOpenSubtasksByParent}
                    goalIndex={''}
                />
            ) : (
                sortedTaskList.map(task => {
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
