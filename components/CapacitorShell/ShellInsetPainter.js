import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { isCapacitorShell } from '../../utils/CapacitorShell'
import { getSafeAreaInsets } from '../../utils/safeAreaInsets'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../TopBar/Themes'
import useWindowSize from '../../utils/useWindowSize'

// The web shell keeps the AT-2314 strategy: <body> is padded by the safe-area
// insets, so the status-bar and home-indicator regions show the body
// background (white). Fine for the PWA; in the native Capacitor shell it reads
// as unfinished chrome. This paints ONLY those inset strips with colors
// matching the adjacent UI — layout is untouched, so the web/PWA rendering
// cannot regress (the component renders nothing outside the shell).
//
// The login screen's background is web/images/illustrations/LoginBg.svg, a
// vertical radial gradient; these are its edge colors.
const LOGIN_TOP_COLOR = '#ADCCFF'

const LOGIN_LIKE_ROUTES = new Set(['LoginScreen', 'Onboarding', 'WhatsAppOnboarding'])

export default function ShellInsetPainter({ routeName }) {
    const themeName = useSelector(state => state.loggedUser?.themeName)
    // Re-render on rotation/resize so the re-measured insets apply.
    useWindowSize()

    if (!isCapacitorShell()) return null

    const insets = getSafeAreaInsets()
    // Only the TOP inset is painted (behind the status bar, matching the
    // header). The bottom home-indicator region is not reserved at all
    // anymore — content flows under it (see the #root comment in the HTML
    // templates), so painting it would cover real content.
    if (!insets.top) return null

    const isLoginLike = LOGIN_LIKE_ROUTES.has(routeName)
    const topColor = isLoginLike ? LOGIN_TOP_COLOR : getTheme(Themes, themeName, 'TopBar').container.backgroundColor

    return (
        <View
            pointerEvents="none"
            style={[localStyles.strip, { top: 0, height: insets.top, backgroundColor: topColor }]}
        />
    )
}

const localStyles = StyleSheet.create({
    strip: {
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 1,
        ...Platform.select({ web: { position: 'fixed' } }),
    },
})
