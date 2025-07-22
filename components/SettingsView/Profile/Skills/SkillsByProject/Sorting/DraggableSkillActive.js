import React from 'react'
import { View } from 'react-native'

import SkillPresentation from '../../SkillItem/SkillPresentation'

export default function DraggableSkillActive({ projectId, skill, provided, isDragging, higherSkill }) {
    return (
        <div {...provided.draggableProps} ref={provided.innerRef}>
            <View>
                <SkillPresentation
                    projectId={projectId}
                    skill={skill}
                    higherSkill={higherSkill}
                    isDragging={isDragging}
                />
            </View>
        </div>
    )
}
