import React from 'react'
import { View } from 'react-native'

import ProjectObjectBody from './ProjectObjectBody'
import ProjectObjectHeader from './ProjectObjectHeader'

export default function ProjectObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const { object, feeds } = feedObjectData
    const { lastChangeDate } = object
    const { type: viewType } = feedViewData
    return (
        <View style={style}>
            {viewType !== 'project' && <ProjectObjectHeader feed={object} projectId={projectId} />}
            <ProjectObjectBody
                feeds={feeds}
                projectId={projectId}
                lastChangeDate={lastChangeDate}
                feedActiveTab={feedActiveTab}
            />
        </View>
    )
}
