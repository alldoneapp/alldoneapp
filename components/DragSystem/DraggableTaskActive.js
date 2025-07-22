import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import ParentTaskContainer from '../TaskListView/ParentTaskContainer'
import { useSelector } from 'react-redux'

const DraggableTaskActive = ({
    projectId,
    task,
    provided,
    isDragging,
    subtaskList,
    isObservedTask,
    isToReviewTask,
}) => {
    const tasks = useSelector(state => state.selectedTasks)
    return (
        <div {...provided.draggableProps} ref={provided.innerRef}>
            <View style={isDragging && localStyle.shadowTask}>
                <ParentTaskContainer
                    task={task}
                    projectId={projectId}
                    provided={provided}
                    checked={tasks.some(elem => elem.id === task.id)}
                    isActiveOrganizeMode={true}
                    subtaskList={subtaskList ? subtaskList : []}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                />
            </View>
        </div>
    )
}

const localStyle = StyleSheet.create({
    shadowTask: {
        borderRadius: 4,
        backgroundColor: '#ffffff',
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${8}px ${16}px rgba(0,0,0,0.04), ${0}px ${4}px ${8}px rgba(0,0,0,0.04)`,
            },
        }),
    },
})

export default DraggableTaskActive
