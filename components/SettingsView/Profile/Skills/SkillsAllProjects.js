import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import SkillsByProject from './SkillsByProject/SkillsByProject'
import ProjectHelper from '../../ProjectsSettings/ProjectHelper'

export default function SkillsAllProjects({ setDismissibleRefs, closeEdition, closeAllEdition, openEdition }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    const projects = loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

    const normalProjects = projects.filter(project => !project.parentTemplateId)
    const guides = projects.filter(project => !!project.parentTemplateId)

    const sortedProjectsData = [
        ...ProjectHelper.sortProjects(normalProjects, loggedUserId),
        ...ProjectHelper.sortProjects(guides, loggedUserId),
    ]

    return (
        <View>
            {sortedProjectsData.map(projectData => {
                const { id, index } = projectData
                return (
                    <SkillsByProject
                        key={id}
                        projectIndex={index}
                        projectId={id}
                        userId={loggedUserId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        closeAllEdition={closeAllEdition}
                    />
                )
            })}
        </View>
    )
}
