import React from 'react'
import { View } from 'react-native'
import { useSelector, shallowEqual } from 'react-redux'

import ProjectTag from '../../Tags/ProjectTag'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_GUIDE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import AllProjectsEmptyInboxSelectProjectText from './AllProjectsEmptyInboxSelectProjectText'

export default function AllProjectsEmptyInboxTags() {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const activeProjects = useSelector(
        state => ProjectHelper.getProjectsByType(state.loggedUserProjects, state.loggedUser, PROJECT_TYPE_ACTIVE),
        shallowEqual
    )
    const guideProjects = useSelector(
        state => ProjectHelper.getProjectsByType(state.loggedUserProjects, state.loggedUser, PROJECT_TYPE_GUIDE),
        shallowEqual
    )
    const sortedActiveProjects = [
        ...ProjectHelper.sortProjects(activeProjects, loggedUserId),
        ...ProjectHelper.sortProjects(guideProjects, loggedUserId),
    ]

    return (
        <>
            <AllProjectsEmptyInboxSelectProjectText />
            <View style={localStyles.projectsTags}>
                {sortedActiveProjects.map(project => {
                    const loggedUserIsAdmin = ProjectHelper.checkIfLoggedUserIsAdminUserInGuide(project)
                    return loggedUserIsAdmin ? null : (
                        <ProjectTag key={project.id} project={project} style={localStyles.projectTag} />
                    )
                })}
            </View>
        </>
    )
}

const localStyles = {
    projectsTags: {
        width: '100%',
        maxWidth: 700,
        flexWrap: 'wrap',
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
        marginBottom: 24,
    },
    projectTag: {
        marginHorizontal: 6,
        marginBottom: 12,
    },
}
