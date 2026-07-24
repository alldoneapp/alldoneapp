import React from 'react'
import { View } from 'react-native'
import { Draggable } from 'react-beautiful-dnd'

import PreConfigTaskItem from './PreConfigTaskItem'

export default function DraggablePreConfigTask({ projectId, assistantId, task, index, disabled }) {
    return (
        <Draggable isDragDisabled={disabled} draggableId={task.id} index={index} key={task.id}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef}>
                    <View style={{ backgroundColor: '#ffffff' }}>
                        <div {...provided.dragHandleProps}>
                            <PreConfigTaskItem
                                disabled={disabled}
                                projectId={projectId}
                                task={task}
                                assistantId={assistantId}
                            />
                        </div>
                    </View>
                </div>
            )}
        </Draggable>
    )
}
