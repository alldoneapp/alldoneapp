import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Droppable } from 'react-beautiful-dnd'

import { colors } from '../../../styles/global'
import DraggablePreConfigTask from './DraggablePreConfigTask'

export default function DroppablePreConfigTaskList({ projectId, assistantId, tasks, disabled }) {
    const droppableId = `preconfig-tasks-${assistantId}`

    return (
        <Droppable droppableId={droppableId} type={droppableId} isCombineEnabled={false}>
            {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                    <View style={[localStyles.container, snapshot.isDraggingOver && localStyles.droppable]}>
                        {tasks.map((task, index) => (
                            <DraggablePreConfigTask
                                key={task.id}
                                projectId={projectId}
                                assistantId={assistantId}
                                task={task}
                                index={index}
                                disabled={disabled}
                            />
                        ))}
                        {provided.placeholder}
                    </View>
                </div>
            )}
        </Droppable>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    droppable: {
        backgroundColor: colors.Grey300,
    },
})
