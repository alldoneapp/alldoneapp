import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useDispatch } from 'react-redux'

import Icon from '../Icon'
import { navigateToAllProjectsTasks, setSelectedSidebarTab, switchProject } from '../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { ALL_PROJECTS_INDEX } from '../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../utils/NavigationService'
import store from '../../redux/store'

export default function HomeButton({ color, style, expandSecondaryBar }) {
    const dispatch = useDispatch()

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
})
