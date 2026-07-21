import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../Icon'
import { navigateToAllProjectsTasks, setSelectedSidebarTab, switchProject } from '../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { ALL_PROJECTS_INDEX } from '../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../utils/NavigationService'
import store from '../../redux/store'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import getAllProjectsOpenTasksAmount from '../../utils/Tasks/getAllProjectsOpenTasksAmount'

export default function HomeButton({ color, style, expandSecondaryBar }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const sidebarNumbers = useSelector(state => state.sidebarNumbers)

    const openTasksAmount = getAllProjectsOpenTasksAmount(
        sidebarNumbers,
        loggedUserId,
        archivedProjectIds,
        templateProjectIds
    )

    const onPress = e => {
        e?.preventDefault()
        if (store.getState().expandedNavPicker) expandSecondaryBar?.()

        dismissAllPopups()
        dispatch([
            switchProject(ALL_PROJECTS_INDEX),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            navigateToAllProjectsTasks({ taskViewToggleSection: 'Open', taskViewToggleIndex: 0 }),
        ])
        NavigationService.navigate('Root')
    }

    return (
        <TouchableOpacity style={[localStyles.button, style]} onPress={onPress} accessible={false}>
            <Icon size={24} name={'home'} color={color} />
            {openTasksAmount > 0 && (
                <View style={localStyles.badge} testID="home-open-tasks-badge">
                    <AmountTag feedAmount={openTasksAmount} isFollowedButton={false} />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 28,
        width: 28,
    },
    badge: {
        position: 'absolute',
        top: 0,
        left: 14,
    },
})
