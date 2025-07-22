import React from 'react'
import { isEqual } from 'lodash'
import { useSelector } from 'react-redux'

import ProjectList from './ProjectList'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ARCHIVED } from '../SettingsView/ProjectsSettings/ProjectsSettings'

export default function ArchivedProjectsList({ navigation }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const loggedUserProjectsData = useSelector(
        state =>
            state.loggedUserProjects.map(project => {
                const { id, name, color, index, parentTemplateId, globalAssistantIds, sortIndexByUser } = project
                return { id, name, color, index, parentTemplateId, globalAssistantIds, sortIndexByUser }
            }),
        isEqual
    )

    const archivedProjects = ProjectHelper.sortProjects(
        ProjectHelper.getArchivedProjectsInList(loggedUserProjectsData, archivedProjectIds),
        loggedUserId
    )

    return <ProjectList projectsData={archivedProjects} projectType={PROJECT_TYPE_ARCHIVED} navigation={navigation} />
}
