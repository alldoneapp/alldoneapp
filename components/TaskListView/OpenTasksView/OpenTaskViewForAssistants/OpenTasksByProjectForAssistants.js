import ProjectSection, { ProjectSectionBody } from '../../ProjectSection'
import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectHeader from '../../Header/ProjectHeader'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import OpenTasksAssistantPreConfigTasks from './OpenTasksAssistantPreConfigTasks'
import OpenTasksByProject from '../OpenTasksByProject'

export default function OpenTasksByProjectForAssistants({ projectIndex }) {
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex]?.id)
    const projectColor = useSelector(state => state.loggedUserProjects[projectIndex]?.color)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    return (
        <ProjectSection
            projectId={projectId}
            projectColor={projectColor}
            selected={inSelectedProject}
            style={{ marginBottom: inSelectedProject ? 32 : 25 }}
        >
            <ProjectHeader
                projectIndex={projectIndex}
                projectId={projectId}
                showRootSectionNavigation={inSelectedProject}
            />
            <ProjectSectionBody>
                <View style={{ marginTop: 12 }}>
                    <OpenTasksAssistantPreConfigTasks projectId={projectId}>
                        <OpenTasksByProject projectId={projectId} firstProject={true} assistantProfileMode />
                    </OpenTasksAssistantPreConfigTasks>
                </View>
            </ProjectSectionBody>
        </ProjectSection>
    )
}
