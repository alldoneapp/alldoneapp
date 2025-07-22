import React from 'react'
import { View } from 'react-native'

import ProjectItem from '../ProjectItem'

export default function DraggableProjectActive({ project, provided, isDragging }) {
    return (
        <div {...provided.draggableProps} ref={provided.innerRef}>
            <View>
                <ProjectItem project={project} isDragging={isDragging} activeDragMode={true} />
            </View>
        </div>
    )
}
