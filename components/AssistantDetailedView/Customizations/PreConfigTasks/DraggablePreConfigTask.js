import React from 'react'
import { View } from 'react-native'
import { Draggable } from '@hello-pangea/dnd'

import PreConfigTaskItem from './PreConfigTaskItem'

import { themed } from '../../../../Themes/colorMode'

export default function DraggablePreConfigTask({ projectId, assistantId, task, index, disabled }) {
    return (
        <Draggable isDragDisabled={disabled} draggableId={task.id} index={index} key={task.id}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef}>
                    <View style={{ backgroundColor: themed.Surface }}>
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
