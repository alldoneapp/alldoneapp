import React from 'react'
import { View } from 'react-native'
import { Draggable } from 'react-beautiful-dnd'

import SkillPresentation from '../../SkillItem/SkillPresentation'

export default function DraggableSkill({ projectId, skill, index, higherSkill }) {
    return (
        <Draggable draggableId={skill.id} index={index}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef} {...provided.dragHandleProps}>
                    <View style={{ backgroundColor: '#ffffff' }}>
                        <SkillPresentation projectId={projectId} skill={skill} higherSkill={higherSkill} />
                    </View>
                </div>
            )}
        </Draggable>
    )
}
