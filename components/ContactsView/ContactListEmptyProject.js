import React from 'react'
import { View } from 'react-native'

import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import NewContactSection from './NewContactSection'

export default function ContactListEmptyProject({ projectId, projectIndex, newItemRef, dismissibleRefs }) {
    return (
        <View style={{ marginBottom: 25 }}>
            <ProjectHeader projectIndex={projectIndex} projectId={projectId} />
            <NewContactSection projectIndex={projectIndex} newItemRef={newItemRef} dismissibleRefs={dismissibleRefs} />
        </View>
    )
}
