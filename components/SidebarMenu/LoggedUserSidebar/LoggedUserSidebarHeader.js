import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import {
    hideGlobalSearchPopup,
    hideWebSideBar,
    navigateToAllProjectsTasks,
    resetNotesAmounts,
    setGlobalSearchResults,
    setSearchText,
} from '../../../redux/actions'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import DefaultAssistantButton from '../DefaultAssistantButton'

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
        <View
            style={[
                styles.container,
                smallScreenNavigation && styles.containerMobile,
                !expanded && styles.containerCollapsed,
            ]}
        >
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Alldone.app"
                style={styles.brand}
                onPress={onPressLogo}
            >
                <Icon size={24} name={'logo'} color={theme.logoColor} />
                {expanded && <Icon style={styles.logoText} size={24} name={'logo-name'} color={theme.logoNameColor} />}
            </TouchableOpacity>
            {expanded && <DefaultAssistantButton />}
        </View>
    )
}

const styles = StyleSheet.create({
    // Match the top bar's 48px row (56px on mobile), preserving the space before projects.
    container: {
        flexDirection: 'row',
        flex: 1,
        height: 72,
        minHeight: 72,
        maxHeight: 72,
        paddingBottom: 24,
        paddingLeft: 24,
        // Keep the assistant toggle inset from the sidebar edge.
        paddingRight: 16,
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    containerMobile: {
        paddingBottom: 16,
    },
    containerCollapsed: {
        paddingLeft: 16,
        paddingRight: 16,
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
