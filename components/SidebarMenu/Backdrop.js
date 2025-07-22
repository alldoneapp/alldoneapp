import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { hideAddProjectOptions, hideProjectColorPicker, hideWebSideBar } from '../../redux/actions'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes/index'

export default function Backdrop() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu')
    const backdropStl = smallScreenNavigation ? [styles.backdrop, theme.backdrop] : theme.backdropDesktop

    const hideSideBar = e => {
        e.preventDefault()
        dispatch([hideWebSideBar(), hideProjectColorPicker(), hideAddProjectOptions()])
    }

    return <TouchableOpacity accessibilityTraits={'none'} style={backdropStl} onPress={hideSideBar} />
}

const styles = StyleSheet.create({
    backdrop: {
        width: '100%',
        height: '100%',
        position: 'absolute',
        zIndex: 5,
    },
})
