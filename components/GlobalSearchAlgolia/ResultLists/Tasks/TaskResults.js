import React from 'react'
import { StyleSheet, View } from 'react-native'

import TaskByProject from './TaskByProject'

export default function TaskResults({ projects, activeTab, tasksResult, activeItemData, activeItemRef }) {
    return (
        <View style={localStyles.container}>
            {projects.map(project => {
                return (
                    <TaskByProject
                        key={project.index}
                        project={project}
                        tasks={tasksResult[project.id]}
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
