import React from 'react'
import { View } from 'react-native'

import ProjectHeader from './ProjectHeader'
import ProjectProgress from './ProjectProgress'

export default function ProjectProgressArea({ projectIndex, monthlyXp, monthlyTraffic, projectId }) {
    return (
        <View>
            <ProjectHeader projectIndex={projectIndex} projectId={projectId} />
            <ProjectProgress monthlyXp={monthlyXp} monthlyTraffic={monthlyTraffic} />
        </View>
    )
}
