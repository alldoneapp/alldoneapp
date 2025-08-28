import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { getUserItemTheme } from '../../Themes'

export default function Indicator({ projectColor }) {
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getUserItemTheme(themeName)
    return <View style={[localStyles.container, theme.selectedIndicator(projectColor)]} />
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 10,
        width: 6,
        height: 6,
        borderRadius: 50,
    },
})
