import React from 'react'
import { View } from 'react-native'
import { Draggable } from '@hello-pangea/dnd'

import SkillPresentation from '../../SkillItem/SkillPresentation'

import { themed } from '../../../../../../Themes/colorMode'

export default function DraggableSkill({ projectId, skill, index, higherSkill }) {
    return (
        <Draggable draggableId={skill.id} index={index}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef} {...provided.dragHandleProps}>
                    <View style={{ backgroundColor: themed.Surface }}>
                        <SkillPresentation projectId={projectId} skill={skill} higherSkill={higherSkill} />
                    </View>
                </div>
            )}
        </Draggable>
    )
}
