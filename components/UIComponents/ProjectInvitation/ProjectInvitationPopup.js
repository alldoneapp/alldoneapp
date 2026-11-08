import React, { useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
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
import { joinProjectAsLoggedUser } from '../../../utils/backends/Users/usersFirestore'
import { unwatchProjectData } from '../../../utils/InitialLoad/initialLoadHelper'
import { fixedModalOverlayStyle } from '../../../utils/fixedModalPosition'
import { useFixedModalOverlayPadding } from '../../../hooks/useSafeAreaOverlayPadding'

export default function ProjectInvitationPopup() {
    const safeAreaOverlayPadding = useFixedModalOverlayPadding()
    const dispatch = useDispatch()
    const newUserNeedToJoinToProject = useSelector(state => state.newUserNeedToJoinToProject)
    const data = useSelector(state => state.showProjectInvitationPopup.data)
    const [processing, setProcessing] = useState(false)
    const [joinError, setJoinError] = useState(false)

    const { project, user, invited } = data
    // An invitation lets the invitee join even a project that is shared "restricted" (copy only).
    const canOnlyCopy = project.isShared === PROJECT_RESTRICTED && !invited

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
        // joinProjectSecondGen checks the invitation or link and adds the membership; a non-member
        // cannot write a project's userIds itself.
        joinProjectAsLoggedUser(project.id)
            .then(() => {
                hidePopup()
                const { initialUrl } = store.getState()
                URLTrigger.processUrl(NavigationService, initialUrl)
                showUserInfoModalIfNeeded()
            })
            .catch(error => {
                console.warn('[Join project] Could not join the project:', error)
                setProcessing(false)
                setJoinError(true)
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
        if (canOnlyCopy) {
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

    return (
        <View style={[localStyles.container, safeAreaOverlayPadding]}>
            <View style={[localStyles.popup, applyPopoverWidth()]}>
                <ModalHeader
                    closeModal={closeModalWithoutAcceptInvitation}
                    title={translate(canOnlyCopy ? 'Interaction with the project' : 'Invitation to project')}
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
                {joinError && (
                    <Text style={[styles.body2, localStyles.joinError]}>
                        {translate('Could not join this project. Please try again.')}
                    </Text>
                )}
                <View style={localStyles.buttonsContainer}>
                    <Button
                        title={translate(canOnlyCopy ? 'Cancel' : 'Decline')}
                        type={'secondary'}
                        buttonStyle={{ marginRight: 16 }}
                        onPress={declineInvitation}
                    />
                    {canOnlyCopy ? (
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
        ...Platform.select({ web: fixedModalOverlayStyle }),
    },
    popup: {
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 16px 24px rgba(0,0,0,0.04)',
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
    joinError: {
        marginTop: 8,
        color: colors.UtilityRed125,
    },
})
