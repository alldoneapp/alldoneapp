import React from 'react'
import { View } from 'react-native'

import ArtifactByProject from './ArtifactByProject'

export default function ArtifactResults({ projects, artifactsResult, activeItemData, activeItemRef }) {
    return (
        <View style={{ flex: 1 }}>
            {projects.map(project => (
                <ArtifactByProject
                    key={project.id}
                    project={project}
                    artifacts={artifactsResult[project.id] || []}
                    activeItemIndex={activeItemData.projectId === project.id ? activeItemData.activeIndex : -1}
                    activeItemRef={activeItemRef}
                />
            ))}
        </View>
    )
}
