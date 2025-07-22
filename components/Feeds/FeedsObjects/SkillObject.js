import React from 'react'
import { View } from 'react-native'

import SkillObjectHeader from './SkillObjectHeader'
import SkillObjectBody from './SkillObjectBody'

export default function SkillObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const { object, feeds } = feedObjectData
    const { skillId, lastChangeDate } = object
    const { type: viewType } = feedViewData
    return (
        <View style={style}>
            {viewType !== 'skill' && <SkillObjectHeader feed={object} projectId={projectId} />}
            <SkillObjectBody
                feeds={feeds}
                skillId={skillId}
                projectId={projectId}
                lastChangeDate={lastChangeDate}
                feedActiveTab={feedActiveTab}
            />
        </View>
    )
}
