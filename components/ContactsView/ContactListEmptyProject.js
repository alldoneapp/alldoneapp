import React from 'react'
import { View } from 'react-native'

import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import NewContactSection from './NewContactSection'

export default function ContactListEmptyProject({
    projectId,
    projectIndex,
    newItemRef,
    dismissibleRefs,
    showRootSectionNavigation,
}) {
    return (
        <View style={{ marginBottom: 25 }}>
            <ProjectHeader
                projectIndex={projectIndex}
                projectId={projectId}
                showRootSectionNavigation={showRootSectionNavigation}
            />
            <NewContactSection projectIndex={projectIndex} newItemRef={newItemRef} dismissibleRefs={dismissibleRefs} />
        </View>
    )
}
