import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { findIndex, sortBy } from 'lodash'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import Icon from '../../../Icon'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { ASSIGNEE_PICKER_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import ModalUserItem from './ModalUserItem'
import { translate } from '../../../../i18n/TranslationService'
import { DV_TAB_ROOT_GOALS } from '../../../../utils/TabNavigationConstants'
import { allGoals } from '../../../AllSections/allSectionHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function AssigneePickerModal({
    projectIndex,
    task,
    closePopover,
    delayClosePopover,
    onSelectUser,
    onSelectSameUser,
    headerText,
    subheaderText,
    showAssistants,
}) {
    const project = ProjectHelper.getProjectByIndex(projectIndex)

    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const users = useSelector(state => state.projectUsers[project.id])
    const globalAssistants = useSelector(state => state.globalAssistants)
    const assistants = useSelector(state => state.projectAssistants)
    const workstreams = useSelector(state => state.projectWorkstreams[project.id])
    const contacts = useSelector(state => state.projectContacts[project.id])
    const parentTemplateId = useSelector(
        state => projectIndex && state.loggedUserProjects[projectIndex].parentTemplateId
    )
    const [selectedUserId, setSelectedUserId] = useState(task.userId)
    const [hoverUserId, setHoverUserId] = useState(task.userId)

    const [width, height] = useWindowSize()

    const isGuide = !!parentTemplateId

    const usersList = users.concat(workstreams).concat(contacts)

    if (showAssistants) {
        const assistantsToShow = [
            ...globalAssistants.filter(assistant => project.globalAssistantIds.includes(assistant.uid)),
            ...assistants[project.id],
        ]
        usersList.push(...assistantsToShow)
    }

    if (selectedSidebarTab === DV_TAB_ROOT_GOALS && !isGuide) {
        usersList.push(allGoals)
    }

    let sortedUsers = sortBy(usersList, [item => item.displayName.toLowerCase()])

    const selectedUser = sortedUsers.find(user => user.uid === selectedUserId)
    if (selectedUser) sortedUsers = [selectedUser, ...sortedUsers.filter(user => user.uid !== selectedUserId)]

    const header = headerText || translate('Choose a user')
    const subheader = subheaderText || translate('Select the user this task will assign to')

    const onClickUser = (e, user) => {
        if (e != null) {
            e.preventDefault()
            e.stopPropagation()
        }

        if (selectedUserId === user.uid) {
            if (onSelectSameUser) onSelectSameUser(user)
            closePopover()
            return false
        }
        selectUser(user)
    }

    const selectUser = user => {
        setSelectedUserId(user.uid)
        onSelectUser(user)
        return false
    }

    const getNextUserId = () => {
        const index = findIndex(sortedUsers, ['uid', hoverUserId])
        if (index + 1 === sortedUsers.length) {
            return sortedUsers[0].uid
        } else {
            return sortedUsers[index + 1].uid
        }
    }

    const getPreviousUserId = () => {
        const index = findIndex(sortedUsers, ['uid', hoverUserId])
        if (index === 0) {
            return sortedUsers[sortedUsers.length - 1].uid
        } else {
            return sortedUsers[index - 1].uid
        }
    }

    const onPressEnter = e => {
        const index = findIndex(sortedUsers, ['uid', hoverUserId])
        onClickUser(e, sortedUsers[index])
    }

    const onKeyPress = (s, e, handler) => {
        switch (handler.key) {
            case 'up': {
                setHoverUserId(getPreviousUserId())
                break
            }
            case 'down': {
                setHoverUserId(getNextUserId())
                break
            }
            case 'enter': {
                onPressEnter(e)
                break
            }
            case 'esc': {
                e.preventDefault()
                e.stopPropagation()
                delayClosePopover()
                break
            }
        }
    }

    useEffect(() => {
        storeModal(ASSIGNEE_PICKER_MODAL_ID)
        return () => {
            removeModal(ASSIGNEE_PICKER_MODAL_ID)
        }
    }, [])

    return (
        sortedUsers.length > 0 && (
            <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <Hotkeys keyName={'up,down,enter,esc'} onKeyDown={onKeyPress} filter={e => true}>
                        <View style={{ marginBottom: 20 }}>
                            <Text style={[styles.title7, { color: '#ffffff' }]}>{header}</Text>
                            <Text style={[styles.body2, { color: colors.Text03 }]}>{subheader}</Text>
                        </View>
                    </Hotkeys>

                    {sortedUsers.map((user, i) => {
                        return (
                            <ModalUserItem
                                key={i}
                                user={user}
                                onPress={e => onClickUser(e, user)}
                                selectedUserId={selectedUserId}
                                hoverUserId={hoverUserId}
                            />
                        )
                    })}

                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeButton} onPress={delayClosePopover}>
                            <Icon name="x" size={24} color={colors.Text03} />
                        </TouchableOpacity>
                    </View>
                </CustomScrollView>
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    userItem: {
        height: 48,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    itemSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
        marginLeft: -8,
        paddingLeft: 8,
        marginRight: -8,
        paddingRight: 8,
    },
    userImage: {
        backgroundColor: colors.Text03,
        height: 32,
        width: 32,
        borderRadius: 100,
    },
    streamIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        width: 32,
        borderRadius: 100,
    },
    userImageSelected: {
        borderWidth: 2,
        borderColor: colors.Primary100,
    },
    userName: {
        color: '#ffffff',
        marginLeft: 8,
    },
    userNameSelected: {
        color: colors.Primary100,
    },
})
