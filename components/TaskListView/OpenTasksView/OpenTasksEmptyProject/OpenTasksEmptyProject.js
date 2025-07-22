import React from 'react'
import { View } from 'react-native'

import ProjectHeader from '../../Header/ProjectHeader'
import OpenTasksDateHeaderEmptyProject from './OpenTasksDateHeaderEmptyProject'
import NewTaskSection from '../NewTaskSection'

export default function OpenTasksEmptyProject({ projectId, projectIndex, setPressedShowMoreMainSection }) {
    return (
        <View style={{ marginBottom: 25 }}>
            <ProjectHeader
                projectIndex={projectIndex}
                projectId={projectId}
                showWorkflowTag={true}
                showAddTask={true}
                setPressedShowMoreMainSection={setPressedShowMoreMainSection}
            />
            <OpenTasksDateHeaderEmptyProject projectId={projectId} />
            <NewTaskSection projectId={projectId} />
        </View>
    )
}
