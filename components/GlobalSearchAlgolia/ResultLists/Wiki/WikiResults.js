import React from 'react'
import { View } from 'react-native'

import WikiByProject from './WikiByProject'

export default function WikiResults({ projects, wikiResult, activeItemData, activeItemRef }) {
    return (
        <View style={{ flex: 1 }}>
            {projects.map(project => (
                <WikiByProject
                    key={project.id}
                    project={project}
                    pages={wikiResult[project.id] || []}
                    activeItemIndex={activeItemData.projectId === project.id ? activeItemData.activeIndex : -1}
                    activeItemRef={activeItemRef}
                />
            ))}
        </View>
    )
}
