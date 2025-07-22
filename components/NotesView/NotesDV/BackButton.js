import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import NavigationService from '../../../utils/NavigationService'
import { hideFloatPopup, setSelectedSidebarTab } from '../../../redux/actions'
import store from '../../../redux/store'
import { MIN_URLS_IN_HISTORY } from '../../../URLSystem/URLTrigger'
import { DV_TAB_ROOT_NOTES } from '../../../utils/TabNavigationConstants'
import SharedHelper from '../../../utils/SharedHelper'

export default function BackButton({ parentStyle, upperStyle, buttonStyle, projectId, note }) {
    const dispatch = useDispatch()

    const onPress = () => {
        const { lastVisitedScreen } = store.getState()
        const commonPath = `projects/${projectId}/notes/${note.id}`

        dispatch(hideFloatPopup())
        if (lastVisitedScreen.length >= MIN_URLS_IN_HISTORY) {
            SharedHelper.onHistoryPop(commonPath)
        } else {
            NavigationService.navigate('Root')
            dispatch(setSelectedSidebarTab(DV_TAB_ROOT_NOTES))
        }
    }

    return (
        <TouchableOpacity style={[localStyles.touchableContainer, parentStyle]} onPress={onPress}>
            <View style={[localStyles.upperContainer, upperStyle]} />
            <View style={[localStyles.bottomContainer, buttonStyle]}>
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
