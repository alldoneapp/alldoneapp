import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import UserInvitationItem from '../ProjectsSettings/UserInvitationItem'
import URLsSettings, { URL_SETTINGS_INVITATIONS } from '../../../URLSystem/Settings/URLsSettings'
import NothingToShow from '../../UIComponents/NothingToShow'
import InvitationsHeader from './InvitationsHeader'
import store from '../../../redux/store'
import { getProjectData } from '../../../utils/backends/firestore'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'

export const PROJECT_INVITATIONS_TITLE = 'PROJECT_INVITATIONS_TITLE'

const ProjectsInvitations = () => {
    const dispatch = useDispatch()
    const amountProjectInvitations = useSelector(state => state.loggedUser.invitedProjectIds.length)
    const [projectInvited, setProjectInvited] = useState([])

    const getInviatedProjects = async () => {
        dispatch(startLoadingData())
        const { invitedProjectIds } = store.getState().loggedUser
        const promises = []
        invitedProjectIds.forEach(projectId => {
            promises.push(getProjectData(projectId))
        })
        const projects = await Promise.all(promises)
        setProjectInvited(projects)
        dispatch(stopLoadingData())
    }

    useEffect(() => {
        getInviatedProjects()
    }, [])

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        return URLsSettings.push(URL_SETTINGS_INVITATIONS)
    }

    return (
        <View style={localStyles.container}>
            <InvitationsHeader amount={amountProjectInvitations} />

            {amountProjectInvitations > 0 ? (
                <View style={{ flex: 1 }}>
                    {projectInvited.map((project, i) => (
                        <UserInvitationItem key={i} project={project} />
                    ))}
                </View>
            ) : (
                <NothingToShow />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})

export default ProjectsInvitations
