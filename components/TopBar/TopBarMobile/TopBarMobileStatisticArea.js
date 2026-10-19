import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import { setShowWebSideBar } from '../../../redux/actions'
import store from '../../../redux/store'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import GoldArea from '../GoldArea'
import AssistantModeButton from '../AssistantModeButton'

export default function TopBarMobileStatisticArea({ expandSecondaryBar, compact, showMenu = true }) {
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
            <AssistantModeButton
                inline
                style={localStyle.assistantButton}
                onOpen={() => store.getState().expandedNavPicker && expandSecondaryBar?.()}
            />

            {!isAnonymous && !compact && <GoldArea />}
        </View>
    )
}

const localStyle = StyleSheet.create({
    container: {
        flexDirection: 'row',
        overflow: 'hidden',
    },
    menu: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        marginRight: 8,
        overflow: 'hidden',
    },
    assistantButton: {
        marginRight: 18,
    },
})
