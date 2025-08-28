import React from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import Icon from '../../Icon'
import { colors } from '../../styles/global'
import NavigationService from '../../../utils/NavigationService'
import { setSelectedSidebarTab } from '../../../redux/actions'
import { DV_TAB_CHAT_BOARD, DV_TAB_ROOT_CHATS, DV_TAB_ROOT_NOTES } from '../../../utils/TabNavigationConstants'
import { useDispatch, useSelector } from 'react-redux'

export default function BackButton({ isFullscreen }) {
    const dispatch = useDispatch()
    const lastVisitedScreen = useSelector(state => state.lastVisitedScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)

    const onPress = () => {
        NavigationService.navigate('Root')
        dispatch(
            setSelectedSidebarTab(
                lastVisitedScreen[lastVisitedScreen.length - 2].indexOf('notes') !== -1
                    ? DV_TAB_ROOT_NOTES
                    : DV_TAB_ROOT_CHATS
            )
        )
    }

    return (
        <TouchableOpacity
            style={[
                localStyles.touchableContainer,
                { top: isFullscreen && selectedTab !== DV_TAB_CHAT_BOARD ? -12 : 0 },
            ]}
            onPress={onPress}
        >
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
        position: 'absolute',
        zIndex: 100,
        width: 57,
        height: 64,
    },
})
