import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { size, sortBy } from 'lodash'
import { useSelector } from 'react-redux'

import ProjectMembersHeader from './ProjectMembersHeader'
import ProjectMemberItem from './ProjectMemberItem'
import ProjectInvitation from './ProjectInvitation'
import DismissibleItem from '../../UIComponents/DismissibleItem'
import EditMember from './EditMember'
import AddMember from './AddMember'
import URLsProjects, { URL_PROJECT_DETAILS_MEMBERS } from '../../../URLSystem/Projects/URLsProjects'
import { DV_TAB_PROJECT_TEAM_MEMBERS } from '../../../utils/TabNavigationConstants'

const ProjectMembers = ({ project }) => {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const usersInProject = useSelector(state => sortBy(state.projectUsers[project.id], ['displayName']))
    const invitationsInProject = useSelector(state => sortBy(state.projectInvitations[project.id], ['userEmail']))

    const newItemRef = useRef()

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_PROJECT_TEAM_MEMBERS) {
            const projectId = project.id
            const data = { projectId: projectId }
            URLsProjects.push(URL_PROJECT_DETAILS_MEMBERS, data, projectId)
        }
    }

    const isTemplate = project.isTemplate
    const isGuideProject = !!project.parentTemplateId
    return (
        <View style={localStyles.container}>
            <ProjectMembersHeader amount={size(project.userIds)} />

            {!isTemplate && !isGuideProject && (
                <DismissibleItem
                    ref={newItemRef}
                    defaultComponent={<AddMember onPress={() => newItemRef.current.toggleModal()} />}
                    modalComponent={
                        <EditMember projectId={project.id} onCancelAction={() => newItemRef.current.toggleModal()} />
                    }
                />
            )}

            <View style={{ flex: 1 }}>
                {invitationsInProject.map((invitation, i) => (
                    <ProjectInvitation key={i} invitation={invitation} project={project} />
                ))}

                {usersInProject.map((user, i) => (
                    <ProjectMemberItem key={i} user={user} project={project} />
                ))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})

export default ProjectMembers
