import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectHeader from '../../Header/ProjectHeader'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import OpenTasksAssistantPreConfigTasks from './OpenTasksAssistantPreConfigTasks'
import OpenTasksByProject from '../OpenTasksByProject'

export default function OpenTasksByProjectForAssistants({ projectIndex }) {
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex]?.id)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    return (
        <View style={{ marginBottom: inSelectedProject ? 32 : 25 }}>
            <ProjectHeader
                projectIndex={projectIndex}
                projectId={projectId}
                showRootSectionNavigation={inSelectedProject}
            />
            <View style={{ marginLeft: 11, marginTop: 12 }}>
                <OpenTasksAssistantPreConfigTasks projectId={projectId}>
                    <OpenTasksByProject projectId={projectId} firstProject={true} assistantProfileMode />
                </OpenTasksAssistantPreConfigTasks>
            </View>
        </View>
    )
}
