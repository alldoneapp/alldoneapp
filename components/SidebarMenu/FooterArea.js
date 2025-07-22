import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Version from './Version'
import ImpressumLink from './ImpressumLink'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes/index'
import Icon from '../Icon'

export default function FooterArea({ expanded }) {
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu')

    return expanded ? (
        <>
            <Version />
            <ImpressumLink />
        </>
    ) : (
        <View style={[styles.infoContainer, theme.infoContainer]}>
            <Icon size={22} name={'info'} color={theme.iconInfoColor} />
        </View>
    )
}

const styles = StyleSheet.create({
    infoContainer: {
        height: 56,
        paddingLeft: 17,
        paddingVertical: 17,
    },
})
