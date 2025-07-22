import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectProgressArea from './ProjectProgressArea'

export default function ProjectsProgressArea() {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    return (
        <View>
            {loggedUserProjects.map(project => {
                const { monthlyXp, monthlyTraffic, id, index } = project
                const isArchived = archivedProjectIds.includes(id)
                const isTemplate = templateProjectIds.includes(id)
                const isGuide = guideProjectIds.includes(id)
                const isShared = !projectIds.includes(id)
                return (
                    !isShared &&
                    !isArchived &&
                    !isTemplate &&
                    !isGuide && (
                        <ProjectProgressArea
                            key={id}
                            projectIndex={index}
                            monthlyXp={monthlyXp}
                            monthlyTraffic={monthlyTraffic}
                            projectId={id}
                        />
                    )
                )
            })}
        </View>
    )
}
