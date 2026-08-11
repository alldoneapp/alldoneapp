import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import UserPropertiesHeader from './UserPropertiesHeader'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { showConfirmPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT } from '../../UIComponents/ConfirmPopup'
import Icon from '../../Icon'
import URLsPeople, { URL_PEOPLE_DETAILS_PROPERTIES } from '../../../URLSystem/People/URLsPeople'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_USERS_TYPE } from '../../Followers/FollowerConstants'
import { DV_TAB_USER_PROPERTIES } from '../../../utils/TabNavigationConstants'
import HighlightButton from '../../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import { FEED_USER_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import PrivacyButton from '../../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import SharedHelper from '../../../utils/SharedHelper'
import { translate } from '../../../i18n/TranslationService'
import ObjectRevisionHistory from '../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import NotAllowRemoveUserModal from '../../SettingsView/Profile/Properties/NotAllowRemoveUserModal'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'

const UserProperties = ({ user, project }) => {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const mobile = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const adminEmail = useSelector(state => state.administratorUser.email)

    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const highlightColor = ProjectHelper.getUserHighlightInProject(project.index, user)
    ContactsHelper.getAndAssignUserPrivacy(project.index, user)
    const projectId = project.id
    const accessGranted = SharedHelper.accessGranted(null, projectId)

    const cannotLeaveTemplate =
        project.isTemplate && project.creatorId === user.uid && project.guideProjectIds.length > 0
    const cannotLeaveGuide = !!project.parentTemplateId && user.templateProjectIds.includes(project.parentTemplateId)

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const openKickUserModal = () => {
        if (cannotLeaveTemplate || cannotLeaveGuide) {
            openModal()
        } else {
            dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT,
                    object: {
                        userId: user.uid,
                        projectId: project.id,
                    },
                })
            )
        }
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_USER_PROPERTIES) {
            const data = { projectId: projectId, userId: user.uid }
            URLsPeople.push(URL_PEOPLE_DETAILS_PROPERTIES, data, projectId, user.uid)
        }
    }

    const userIsLoggedUser = loggedUserId === user.uid
    const loggedUserCanUpdateObject = userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={localStyles.container}>
            <UserPropertiesHeader />

            <View style={[localStyles.properties, mobile ? localStyles.propertiesMobile : undefined]}>
                <View style={{ flex: 1, marginRight: mobile ? 0 : 72 }}>
                    <View style={localStyles.propertyRow}>
                        <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                            <Icon name={'user'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('User kind')}</Text>
                        </View>
                        <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                            <Button
                                iconColor={project.color}
                                title={translate(ProjectHelper.getTypeOfUserInProject(project.index, user.uid))}
                                type={'ghost'}
                                disabled={true}
                            />
                        </View>
                    </View>

                    <View style={localStyles.propertyRow}>
                        <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                            <Icon name={'lock'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Privacy')}</Text>
                        </View>
                        <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                            <PrivacyButton
                                projectId={projectId}
                                object={user}
                                objectType={FEED_USER_OBJECT_TYPE}
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                                shortcutText={'P'}
                            />
                        </View>
                    </View>
                </View>

                <View style={{ flex: 1 }}>
                    <AssistantProperty
                        projectId={projectId}
                        assistantId={user.assistantId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        objectId={user.uid}
                        objectType={'users'}
                    />
                    <View style={localStyles.propertyRow}>
                        <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                            <Icon name={'highlight'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Highlight')}</Text>
                        </View>
                        <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                            <HighlightButton
                                projectId={projectId}
                                object={{ ...user, hasStar: highlightColor }}
                                objectType={FEED_USER_OBJECT_TYPE}
                                shortcutText={'H'}
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                            />
                        </View>
                    </View>

                    {accessGranted && (
                        <FollowObject
                            projectId={projectId}
                            followObjectsType={FOLLOWER_USERS_TYPE}
                            followObjectId={user.uid}
                            loggedUserId={loggedUserId}
                            object={user}
                        />
                    )}

                    {accessGranted && loggedUserCanUpdateObject && (
                        <View style={localStyles.bottomContainer}>
                            <ObjectRevisionHistory projectId={projectId} noteId={user.noteIdsByProject[projectId]} />
                            <View style={localStyles.deleteButton}>
                                <Popover
                                    content={
                                        <NotAllowRemoveUserModal
                                            closeModal={closeModal}
                                            title={translate('You cannot kick this user')}
                                            description={translate(
                                                cannotLeaveGuide
                                                    ? 'This user is the guide creator and cannot leave the guide'
                                                    : 'This template has some active guides',
                                                {
                                                    email: adminEmail,
                                                }
                                            )}
                                        />
                                    }
                                    align={'start'}
                                    position={['top']}
                                    onClickOutside={closeModal}
                                    isOpen={isOpen}
                                    contentLocation={smallScreenNavigation ? null : undefined}
                                >
                                    <Button
                                        icon={'kick'}
                                        title={translate('Kick from project')}
                                        type={'ghost'}
                                        iconColor={colors.UtilityRed200}
                                        titleStyle={{ color: colors.UtilityRed200 }}
                                        buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
                                        onPress={openKickUserModal}
                                    />
                                </Popover>
                            </View>
                        </View>
                    )}
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    properties: {
        flexDirection: 'row',
    },
    propertiesMobile: {
        flexDirection: 'column',
    },
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    propertyRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    propertyRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    propertyRowRight: {
        justifyContent: 'flex-end',
    },
    bottomContainer: {
        marginTop: 32,
    },
    deleteButton: {
        flexDirection: 'row',
        paddingVertical: 8,
        justifyContent: 'flex-end',
    },
})

export default UserProperties
