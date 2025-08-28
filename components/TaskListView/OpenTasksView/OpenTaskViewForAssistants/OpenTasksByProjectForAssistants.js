import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectHeader from '../../Header/ProjectHeader'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import OpenTasksDateHeaderForAssistants from './OpenTasksDateHeaderForAssistants'
import OpenTasksAssistantData from './OpenTasksAssistantData'
import OpenTasksAssistantPreConfigTasks from './OpenTasksAssistantPreConfigTasks'

export default function OpenTasksByProjectForAssistants({ projectIndex }) {
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex].id)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    return (
        <View style={{ marginBottom: inSelectedProject ? 32 : 25 }}>
            <ProjectHeader projectIndex={projectIndex} projectId={projectId} />
            <OpenTasksDateHeaderForAssistants />
            <View style={{ marginLeft: 11, marginTop: 12 }}>
                <OpenTasksAssistantData projectId={projectId} />
                <OpenTasksAssistantPreConfigTasks projectId={projectId} />
            </View>
        </View>
    )
}
