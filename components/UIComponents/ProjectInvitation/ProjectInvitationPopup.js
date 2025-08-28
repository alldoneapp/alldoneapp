import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors, hexColorToRGBa } from '../../styles/global'
import Button from '../../UIControls/Button'
import {
    hideProjectInvitation,
    removeProjectData,
    setNewUserNeedToJoinToProject,
    setProjectInvitationData,
    setUserInfoModalWhenUserJoinsToGuide,
} from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'
import NavigationService from '../../../utils/NavigationService'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import { PROJECT_RESTRICTED } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import CopyProjectWrapper from './CopyProjectButton'
import ModalHeader from '../FloatModals/ModalHeader'
import Line from '../FloatModals/GoalMilestoneModal/Line'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import store from '../../../redux/store'
import { tryAddUserToProjectByUidOrEmail } from '../../../utils/backends/firestore'
import { unwatchProjectData } from '../../../utils/InitialLoad/initialLoadHelper'

export default function ProjectInvitationPopup() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const newUserNeedToJoinToProject = useSelector(state => state.newUserNeedToJoinToProject)
    const data = useSelector(state => state.showProjectInvitationPopup.data)
    const [processing, setProcessing] = useState(false)

    const { project, user } = data

    const hidePopup = () => {
        dispatch([hideProjectInvitation(), setProjectInvitationData({ project: null, user: null })])
    }

    const showUserInfoModalIfNeeded = () => {
        const { loggedUser } = store.getState()
        if (newUserNeedToJoinToProject) {
            if (!loggedUser.role.trim() || !loggedUser.company.trim() || !loggedUser.extendedDescription.trim()) {
                store.dispatch(setUserInfoModalWhenUserJoinsToGuide(true))
            }
        }
    }

    const joinToProject = () => {
        setProcessing(true)
        tryAddUserToProjectByUidOrEmail(user.uid, project.id).then(() => {
            hidePopup()
            const { initialUrl } = store.getState()
            URLTrigger.processUrl(NavigationService, initialUrl)
            showUserInfoModalIfNeeded()
        })
    }

    const unmountProjectWhenDeclineInvitation = () => {
        const { loggedUserProjectsMap } = store.getState()
        if (loggedUserProjectsMap[project.id]) {
            unwatchProjectData(project.id)
            dispatch(removeProjectData(project.id))
        }
    }

    const closeModalWithoutAcceptInvitation = () => {
        hidePopup()
        unmountProjectWhenDeclineInvitation()
    }

    const declineInvitation = () => {
        if (project.isShared === PROJECT_RESTRICTED) {
            hidePopup()
            URLTrigger.processUrl(NavigationService, '/projects/tasks/open')
            showUserInfoModalIfNeeded()
        } else {
            Backend.declineProjectInvitation(user, project).then(() => {
                hidePopup()
                URLTrigger.processUrl(NavigationService, '/projects/tasks/open')
                showUserInfoModalIfNeeded()
            })
        }
        if (newUserNeedToJoinToProject) dispatch(setNewUserNeedToJoinToProject(false))
        unmountProjectWhenDeclineInvitation()
    }

    let sidebarOpenStyle = smallScreenNavigation ? null : { marginLeft: 300 }

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.popup, applyPopoverWidth(), sidebarOpenStyle]}>
                <ModalHeader
                    closeModal={closeModalWithoutAcceptInvitation}
                    title={translate(
                        project.isShared === PROJECT_RESTRICTED
                            ? 'Interaction with the project'
                            : 'Invitation to project'
                    )}
                    description={translate('Select your interaction with this project')}
                />
                <View style={localStyles.projectName}>
                    <ColoredCircleSmall
                        size={16}
                        color={project.color}
                        isGuide={!!project.parentTemplateId}
                        containerStyle={{ margin: 4 }}
                        projectId={project.id}
                    />
                    <Text style={[styles.body1, localStyles.title]}>{project.name}</Text>
                </View>
                <Line />
                <View style={localStyles.buttonsContainer}>
                    <Button
                        title={translate(project.isShared === PROJECT_RESTRICTED ? 'Cancel' : 'Decline')}
                        type={'secondary'}
                        buttonStyle={{ marginRight: 16 }}
                        onPress={declineInvitation}
                    />
                    {project.isShared === PROJECT_RESTRICTED ? (
                        <CopyProjectWrapper project={project} hidePopup={closeModalWithoutAcceptInvitation} />
                    ) : (
                        <Button
                            title={translate('Join')}
                            disabled={processing}
                            type={processing ? 'disabled' : 'primary'}
                            onPress={joinToProject}
                            processing={processing}
                            processingTitle={translate('Joining:')}
                        />
                    )}
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
    },
    popup: {
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        padding: 16,
    },
    buttonsContainer: {
        flexDirection: 'row',
        flex: 0,
        marginTop: 8,
        justifyContent: 'center',
    },
    projectName: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        marginLeft: 8,
        color: '#ffffff',
    },
})
