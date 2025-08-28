import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import { Themes } from '../Themes/index'
import { getTheme } from '../../../Themes/Themes'

export default function AnonymousUserSidebarHeader() {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const theme = getTheme(Themes, themeName, 'AnonymousSideMenu.AnonymousHeader')

    return (
        <View style={headerSt.container}>
            <View style={headerSt.brand}>
                <Icon size={24} name={'logo'} color={theme.logoColor} />
                <Icon style={headerSt.logoText} size={24} name={'logo-name'} color={theme.logoNameColor} />
            </View>
        </View>
    )
}

const headerSt = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flex: 1,
        height: 72,
        minHeight: 72,
        maxHeight: 72,
        paddingTop: 32,
        paddingBottom: 44,
        paddingHorizontal: 28,
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    brand: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    logoText: {
        marginLeft: 9,
    },
})
