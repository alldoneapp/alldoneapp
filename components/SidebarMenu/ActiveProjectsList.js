import React from 'react'
import { useSelector } from 'react-redux'
import { isEqual } from 'lodash'

import ProjectList from './ProjectList'
import { PROJECT_TYPE_ACTIVE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function ActiveProjectsList({ navigation }) {
    const loggedUserProjectsData = useSelector(
        state =>
            state.loggedUserProjects.map(project => {
                const { id, name, color, index, parentTemplateId, globalAssistantIds, sortIndexByUser } = project
                return { id, name, color, index, parentTemplateId, globalAssistantIds, sortIndexByUser }
            }),
        isEqual
    )
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds)

    const activeProjectsData = ProjectHelper.getActiveProjectsInList(
        loggedUserProjectsData,
        projectIds,
        archivedProjectIds,
        templateProjectIds,
        guideProjectIds
    )
    const sortedProjectsData = ProjectHelper.sortProjects(activeProjectsData, loggedUserId)

    return <ProjectList projectsData={sortedProjectsData} projectType={PROJECT_TYPE_ACTIVE} navigation={navigation} />
}
