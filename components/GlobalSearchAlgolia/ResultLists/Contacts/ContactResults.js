import React from 'react'
import { StyleSheet, View } from 'react-native'

import ContactByProject from './ContactByProject'

export default function ContactResults({ projects, contactsResult, activeItemData, activeItemRef }) {
    return (
        <View style={localStyles.container}>
            {projects.map(project => {
                return (
                    <ContactByProject
                        key={project.index}
                        project={project}
                        contacts={contactsResult[project.id]}
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
