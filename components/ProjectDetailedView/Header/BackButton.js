import React from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import NavigationService from '../../../utils/NavigationService'
import { hideFloatPopup, navigateToSettings } from '../../../redux/actions'
import { MIN_URLS_IN_HISTORY } from '../../../URLSystem/URLTrigger'
import { DV_TAB_SETTINGS_PROJECTS } from '../../../utils/TabNavigationConstants'
import SharedHelper from '../../../utils/SharedHelper'

export default function BackButton({ project }) {
    const dispatch = useDispatch()
    const lastVisitedScreen = useSelector(state => state.lastVisitedScreen)

    const onPress = () => {
        const projectId = project.id
        const commonPath = `project/${projectId}`

        dispatch(hideFloatPopup())
        if (lastVisitedScreen.length >= MIN_URLS_IN_HISTORY) {
            SharedHelper.onHistoryPop(commonPath)
        } else {
            NavigationService.navigate('SettingsView')
            dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROJECTS }))
        }
    }

    return (
        <TouchableOpacity style={localStyles.touchableContainer} onPress={onPress}>
            <View style={localStyles.upperContainer} />
            <View style={localStyles.bottomContainer}>
                <Icon name="arrow-left" size={24} color={colors.Text03} />
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    upperContainer: {
        width: 57,
        height: 32,
        backgroundColor: 'white',
    },
    bottomContainer: {
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: 57,
        height: 32,
        backgroundColor: 'white',
        borderRightWidth: 1,
        borderRightColor: colors.Gray300,
    },
    touchableContainer: {
        width: 57,
        height: 64,
    },
})
