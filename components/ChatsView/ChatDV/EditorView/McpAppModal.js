import React, { useEffect, useLayoutEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import useWindowSize from '../../../../utils/useWindowSize'
import {
    embedWindowStyles,
    getEmbedWindowGap,
    isEmbedWindowFullscreen,
    useBackdropDismiss,
} from '../../../UIComponents/FloatModals/IframeModal/embedWindowLayout'
import { McpAppFrame } from './McpAppViews'
import { closeMcpAppView, getOpenMcpAppView, openMcpAppView, subscribeMcpAppView } from './mcpAppModalStore'
import OpenInAssistantPaneButton from '../../../Anna/OpenInAssistantPaneButton'
import { openInAnnaAppPane, registerEmbedWindow, useAnnaAppPaneState } from '../../../Anna/annaAppPaneBridge'

import { themed } from '../../../../Themes/colorMode'

/**
 * The window an MCP Apps view (e.g. Judy) opens in outside Anna's assistant shell: the viewport but
 * for one uniform gap (the whole screen, inside the safe area, on a phone), a slim header with the
 * app's name and a close button. A click on the backdrop next to it closes it like the X (AT-2953,
 * same layout as IframeModal, see embedWindowLayout.js).
 * Mounted once with the global modals. In assistant mode the view goes to the shell's right pane
 * instead, and the header's "expand to the left" button switches there (AT-2951); leaving assistant
 * mode with the view in the pane opens it here again.
 */
export default function McpAppModal() {
    const language = useSelector(state => state.loggedUser.language)
    const [view, setView] = useState(getOpenMcpAppView)
    const [windowWidth] = useWindowSize()
    const fullscreen = isEmbedWindowFullscreen(windowWidth)
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding(getEmbedWindowGap(fullscreen))
    const inAssistantMode = useAnnaAppPaneState() === 'active'
    const backdropDismiss = useBackdropDismiss(closeMcpAppView, { enabled: !fullscreen })
    useEffect(() => subscribeMcpAppView(setView), [])
    // Leaving assistant mode with an MCP app in the pane brings it back here (AT-2951).
    useEffect(() => registerEmbedWindow('mcp', openMcpAppView), [])
    useEscapeKey(closeMcpAppView, { enabled: !!view && !inAssistantMode })

    // Opened while assistant mode is on (or switched on while open): the pane shows it instead.
    useLayoutEffect(() => {
        if (view && inAssistantMode && openInAnnaAppPane(view)) closeMcpAppView()
    }, [view, inAssistantMode])

    const openInAssistantMode = () => {
        if (openInAnnaAppPane(view)) closeMcpAppView()
    }

    if (!view || inAssistantMode) return null
    return (
        <View
            testID="embed-window-backdrop"
            {...backdropDismiss}
            style={[embedWindowStyles.overlay, fullscreen && styles.overlayFullscreen, safeAreaOverlayPadding]}
        >
            <View
                style={[
                    embedWindowStyles.container,
                    styles.container,
                    fullscreen && embedWindowStyles.containerFullscreen,
                ]}
            >
                <View style={styles.header}>
                    <OpenInAssistantPaneButton onPress={openInAssistantMode} />
                    <Text style={styles.title} numberOfLines={1}>
                        {view.appName || view.serverLabel || view.toolName}
                    </Text>
                    <TouchableOpacity onPress={closeMcpAppView} style={styles.close} accessibilityRole="button">
                        <Icon name="x" size={20} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={styles.content}>
                    <McpAppFrame key={view.viewId} view={view} language={language} onClose={closeMcpAppView} />
                </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    // On a phone the safe-area strips around the full-screen window take its colour.
    overlayFullscreen: { backgroundColor: themed.Surface },
    container: { backgroundColor: themed.Surface },
    header: {
        height: 40,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    title: { flex: 1, marginRight: 16, color: colors.Text01, fontSize: 14, fontWeight: '600' },
    close: { width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, display: 'flex' },
})
