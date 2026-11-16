import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import { setShowWebSideBar } from '../../../redux/actions'
import store from '../../../redux/store'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import GoldArea from '../GoldArea'

export default function TopBarMobileStatisticArea({ expandSecondaryBar, showMenu = true }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)

    const theme = getTheme(Themes, themeName, 'TopBarMobile.TopBarMobileStatisticArea')

    const showSideBar = e => {
        e?.preventDefault()
        dispatch(setShowWebSideBar())
        if (store.getState().expandedNavPicker) expandSecondaryBar?.()
    }

    return (
        <View style={localStyle.container}>
            {showMenu && (
                <TouchableOpacity style={localStyle.menu} onPress={showSideBar} accessible={false}>
                    <Icon name={'menu'} size={24} color={theme.menuIcon} />
                </TouchableOpacity>
            )}

            {/* AT-3044: Gold stays top left on every phone width, also on narrow (compact) ones. */}
            {!isAnonymous && <GoldArea containerStyle={localStyle.gold} />}
        </View>
    )
}

const localStyle = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
        flexShrink: 1,
        minWidth: 0,
    },
    menu: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        marginRight: 8,
        overflow: 'hidden',
    },
    gold: {
        // Last item before the centred Home button: no trailing margin, and allowed to shrink.
        marginRight: 0,
        flexShrink: 1,
        minWidth: 0,
    },
})
