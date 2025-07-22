import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import {
    hideGlobalSearchPopup,
    hideWebSideBar,
    navigateToAllProjectsTasks,
    resetLoadingData,
    resetNotesAmounts,
    setGlobalSearchResults,
    setSearchText,
} from '../../../redux/actions'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'

export default function LoggedUserSidebarHeader({ navigation, expanded, scrollView }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.Header')

    const scrollToTop = () => {
        scrollView.current.scrollTo({ x: 0, y: 0, animated: true })
    }

    const onPressLogo = () => {
        scrollToTop()
        navigation.navigate('Root')
        dispatch([
            setSearchText(''),
            resetLoadingData(),
            setGlobalSearchResults(null),
            hideGlobalSearchPopup(),
            resetNotesAmounts(),
            navigateToAllProjectsTasks(),
        ])

        hideSideBar()
    }

    const hideSideBar = () => {
        if (smallScreenNavigation) dispatch(hideWebSideBar())
    }

    return (
        <View style={[styles.container, !expanded && styles.containerCollapsed]}>
            <TouchableOpacity style={styles.brand} onPress={onPressLogo}>
                <Icon size={24} name={'logo'} color={theme.logoColor} />
                {expanded && <Icon style={styles.logoText} size={24} name={'logo-name'} color={theme.logoNameColor} />}
            </TouchableOpacity>
        </View>
    )
}

const styles = StyleSheet.create({
    // The real height is                       88px
    // Padding Top                              32px
    // Logo height                              24px
    // Minimum space in bottom for scroll       16px
    // Final height              32 + 24 + 16 = 72px
    // Margin bottom                            16px
    // Final space moved to scroll  88 + 16 - 72 = 32px

    container: {
        flexDirection: 'row',
        flex: 1,
        height: 72,
        minHeight: 72,
        maxHeight: 72,
        paddingTop: 32,
        paddingBottom: 16,
        paddingHorizontal: 24,
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    containerCollapsed: {
        paddingHorizontal: 16,
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
