import React from 'react'
import { StyleSheet, View } from 'react-native'

import GoalByProject from './GoalByProject'

export default function GoalResults({ projects, activeTab, goalsResult, activeItemData, activeItemRef }) {
    return (
        <View style={localStyles.container}>
            {projects.map(project => {
                return (
                    <GoalByProject
                        key={project.index}
                        project={project}
                        goals={goalsResult[project.id]}
                        activeTab={activeTab}
                        activeItemIndex={activeItemData.projectId === project.id ? activeItemData.activeIndex : -1}
                        activeItemRef={activeItemRef}
                    />
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
