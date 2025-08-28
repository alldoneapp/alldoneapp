import React from 'react'
import { StyleSheet, View } from 'react-native'

import NoteByProject from './NoteByProject'

export default function NoteResults({ projects, activeTab, notesResult, activeItemData, activeItemRef }) {
    return (
        <View style={localStyles.container}>
            {projects.map(project => {
                return (
                    <NoteByProject
                        key={project.index}
                        project={project}
                        notes={notesResult[project.id]}
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
