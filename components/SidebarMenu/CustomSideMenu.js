import React, { useEffect, useRef } from 'react'
import { Animated, Dimensions, StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { setWebSideBarLayout } from '../../redux/actions'
import { SIDEBAR_MENU_COLLAPSED_WIDTH, SIDEBAR_MENU_WIDTH } from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes/index'
import CollapseButton from './ProjectFolding/Common/CollapseButton'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import LoggedUserSidebar from './LoggedUserSidebar/LoggedUserSidebar'
import AnonymousUserSidebar from './AnonymousUserSidebar/AnonymousUserSidebar'
import Backdrop from './Backdrop'

export default function CustomSideMenu({ navigation }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const themeName = useSelector(state => state.loggedUser.themeName)

    const { expanded, overlay } = useCollapsibleSidebar()

    const customSideMenu = useRef()
    const floatingWidth = useRef(new Animated.Value(0)).current

    const theme = getTheme(Themes, themeName, 'CustomSideMenu')
    const backdropStl = smallScreenNavigation ? [styles.backdrop, theme.backdrop] : theme.backdropDesktop
    const backdropOverlayStl = [styles.backdropOverlay, { width: floatingWidth }]
    const floatingContainerStl = smallScreenNavigation
        ? [styles.floatingContainer, { width: floatingWidth }, theme.floatingContainer]
        : overlay
        ? [
              styles.overlayContainer,
              expanded && styles.overlayExpanded,
              { width: floatingWidth },
              theme.overlayContainer,
          ]
        : [styles.container, theme.container, { width: floatingWidth }]

    useEffect(() => {
        const targetWidth = expanded ? SIDEBAR_MENU_WIDTH : SIDEBAR_MENU_COLLAPSED_WIDTH
        dispatch(
            setWebSideBarLayout({
                x: 0,
                y: 0,
                width: targetWidth,
                height: Dimensions.get('window').height,
            })
        )
        Animated.timing(floatingWidth, {
            toValue: targetWidth,
            duration: 100,
        }).start()
    }, [expanded])

    return (
        <>
            <Animated.View ref={customSideMenu} style={[backdropStl, overlay && backdropOverlayStl]}>
                {smallScreenNavigation && <Backdrop />}
                {isAnonymous ? (
                    <AnonymousUserSidebar containerStyle={floatingContainerStl} />
                ) : (
                    <LoggedUserSidebar
                        containerStyle={floatingContainerStl}
                        expanded={expanded}
                        navigation={navigation}
                    />
                )}
                <CollapseButton targetWidth={floatingWidth} />
            </Animated.View>
        </>
    )
}

const styles = StyleSheet.create({
    container: {
        height: 'calc(100% - 56px)',
        width: SIDEBAR_MENU_WIDTH,
        zIndex: 10,
        overflow: 'hidden',
    },
    floatingContainer: {
        height: 'calc(100% - 56px)',
        position: 'absolute',
        zIndex: 10,
        shadowColor: 'rgba(0,0,0,0.56)',
        shadowOffset: { width: 0, height: -16 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        overflow: 'hidden',
    },
    overlayContainer: {
        height: 'calc(100% - 56px)',
        position: 'absolute',
        left: 0,
        zIndex: 100,
        overflow: 'hidden',
    },
    overlayExpanded: {
        shadowColor: 'rgba(0,0,0,0.56)',
        shadowOffset: { width: 0, height: -16 },
        shadowOpacity: 1,
        shadowRadius: 16,
    },
    backdrop: {
        width: '100%',
        height: '100%',
        position: 'absolute',
        zIndex: 5,
    },
    backdropOverlay: {
        height: '100%',
        position: 'absolute',
        left: 0,
        top: 0,
        zIndex: 10000,
        overflow: 'hidden',
    },
})
