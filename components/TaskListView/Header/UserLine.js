import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import AssigneePickerModal from '../../UIComponents/FloatModals/AssigneePickerModal/AssigneePickerModal'
import NavigationService from '../../../utils/NavigationService'
import { useDispatch, useSelector } from 'react-redux'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import HelperFunctions, { dismissAllPopups } from '../../../utils/HelperFunctions'
import {
    setSelectedNavItem,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    switchProject,
} from '../../../redux/actions'
import { PROJECT_TYPE_ACTIVE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import Icon from '../../Icon'
import { isWorkstream, WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import { translate } from '../../../i18n/TranslationService'
import { ALL_GOALS_ID } from '../../AllSections/allSectionHelper'
import {
    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
    DV_TAB_USER_PROFILE,
} from '../../../utils/TabNavigationConstants'
import store from '../../../redux/store'
import withSafePopover from '../../UIComponents/HOC/withSafePopover'
import Popover from 'react-tiny-popover'

function UserLine({ projectIndex, projectId, user, openPopover, closePopover, isOpen }) {
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const dispatch = useDispatch()

    const onSelectUser = user => {
        if (user.uid === currentUserId && !isWorkstream(user.uid) && user.uid !== ALL_GOALS_ID) {
            if (!!user.temperature) {
                NavigationService.navigate('AssistantDetailedView', {
                    assistantId: user.uid,
                    assistant: user,
                    projectId,
                })
                dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
            } else {
                const project = ProjectHelper.getProjectById(projectId)
                NavigationService.navigate('UserDetailedView', {
                    contact: user,
                    project,
                })
                dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
            }
        } else {
            const { taskViewToggleIndex, taskViewToggleSection } = store.getState()
            const projectType = ProjectHelper.getTypeOfProject(user, projectId)
            const isAssistant = !!user.temperature
            dispatch([
                switchProject(projectIndex),
                storeCurrentUser(user),
                setSelectedTypeOfProject(projectType || PROJECT_TYPE_ACTIVE),
                setTaskViewToggleIndex(
                    taskViewToggleSection === 'In progress' && !isAssistant ? 0 : taskViewToggleIndex
                ),
                setTaskViewToggleSection(
                    taskViewToggleSection === 'In progress' && !isAssistant ? 'Open' : taskViewToggleSection
                ),
            ])
        }

        closePopover()
        dismissAllPopups()
    }

    const photoURL = user.photoURL50 || user.photoURL || undefined

    const trigger = (
        <TouchableOpacity
            style={localStyles.titleContainer}
            onPress={openPopover}
            accessible={false}
            disabled={
                loggedUser.isAnonymous ||
                selectedSidebarTab === DV_TAB_ROOT_NOTES ||
                selectedSidebarTab === DV_TAB_ROOT_CONTACTS ||
                selectedSidebarTab === DV_TAB_ROOT_CHATS ||
                selectedSidebarTab === DV_TAB_ROOT_UPDATES
            }
        >
            <View style={localStyles.titleContainer}>
                {user.uid === ALL_GOALS_ID ? (
                    <Icon size={18} name="circle" color={colors.Text03} style={{ marginRight: 4 }} />
                ) : user.uid?.startsWith(WORKSTREAM_ID_PREFIX) ? (
                    <Icon size={18} name="workstream" color={colors.Text03} style={{ marginRight: 4 }} />
                ) : (
                    !!photoURL && <Image source={{ uri: photoURL }} style={localStyles.userImage} />
                )}

                {user.displayName !== undefined && !mobile && (
                    <Text style={[styles.subtitle1, localStyles.userName]} numberOfLines={1}>
                        {user.uid === ALL_GOALS_ID || user.uid.startsWith(WORKSTREAM_ID_PREFIX) || !!user.temperature
                            ? user.displayName
                            : HelperFunctions.getFirstName(user.displayName)}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    )

    return (
        <Popover
            isOpen={isOpen}
            positions={['bottom', 'top', 'left', 'right']}
            align="start"
            containerStyle={{ zIndex: 9999 }}
            padding={8}
            offsetY={5}
            onClickOutside={closePopover}
            content={
                <div
                    style={{
                        position: 'relative',
                        backgroundColor: 'var(--background-primary)',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
                        minWidth: '300px',
                        maxHeight: '80vh',
                        overflow: 'hidden',
                    }}
                >
                    <AssigneePickerModal
                        projectIndex={projectIndex}
                        task={{ userId: user.uid }}
                        onSelectUser={onSelectUser}
                        closePopover={closePopover}
                        delayClosePopover={closePopover}
                        headerText={translate('Switch user')}
                        subheaderText={translate('Select user to switch to')}
                        onSelectSameUser={onSelectUser}
                        showAssistants={selectedSidebarTab === DV_TAB_ROOT_TASKS}
                    />
                </div>
            }
        >
            {trigger}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    userName: {
        color: colors.Text01,
    },
    userImage: {
        height: 18,
        width: 18,
        borderRadius: 100,
        marginRight: 4,
        backgroundColor: colors.Gray400,
    },
})

export default withSafePopover(UserLine)
