import React from 'react'
import { View } from 'react-native'
import { Draggable } from 'react-beautiful-dnd'

import ProjectItem from '../ProjectItem'

export default function DraggableProject({ project, index }) {
    return (
        <Draggable draggableId={project.id} index={index}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef} {...provided.dragHandleProps}>
                    <View style={{ backgroundColor: '#ffffff' }}>
                        <ProjectItem project={project} activeDragMode={true} />
                    </View>
                </div>
            )}
        </Draggable>
    )
}
