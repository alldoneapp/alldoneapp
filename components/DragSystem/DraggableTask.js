import React from 'react'
import { View } from 'react-native'
import { Draggable } from 'react-beautiful-dnd'

import ParentTaskContainer from '../TaskListView/ParentTaskContainer'
import { useSelector } from 'react-redux'

const DraggableTask = ({
    projectId,
    disableDrag,
    task,
    index,
    isObservedTask,
    isToReviewTask,
    expandOrContractSubtasks,
    subtaskList,
    containerStyle,
}) => {
    const tasks = useSelector(state => state.selectedTasks)
    return (
        <Draggable isDragDisabled={disableDrag} draggableId={task.id} index={index} key={task.id}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef}>
                    <View style={[{ backgroundColor: '#ffffff' }, task.isSubtask && { marginLeft: 34 }]}>
                        <ParentTaskContainer
                            task={task}
                            projectId={projectId}
                            provided={provided}
                            checked={tasks.some(elem => elem.id === task.id)}
                            isActiveOrganizeMode={true}
                            isObservedTask={isObservedTask}
                            isToReviewTask={isToReviewTask}
                            expandOrContractSubtasks={expandOrContractSubtasks}
                            subtaskList={subtaskList ? subtaskList : []}
                            containerStyle={containerStyle}
                        />
                    </View>
                </div>
            )}
        </Draggable>
    )
}

export default DraggableTask
