import React, { useEffect, useLayoutEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import { McpAppFrame } from './McpAppViews'
import { closeMcpAppView, getOpenMcpAppView, openMcpAppView, subscribeMcpAppView } from './mcpAppModalStore'
import OpenInAssistantPaneButton from '../../../Anna/OpenInAssistantPaneButton'
import { openInAnnaAppPane, registerEmbedWindow, useAnnaAppPaneState } from '../../../Anna/annaAppPaneBridge'

/**
 * The full-screen window an MCP Apps view (e.g. Judy) opens in outside Anna's assistant shell: the
 * whole viewport (inside the safe area), a slim header with the app's name and a close button.
 * Mounted once with the global modals. In assistant mode the view goes to the shell's right pane
 * instead, and the header's "expand to the left" button switches there (AT-2951); leaving assistant
 * mode with the view in the pane opens it here again.
 */
export default function McpAppModal() {
    const language = useSelector(state => state.loggedUser.language)
    const [view, setView] = useState(getOpenMcpAppView)
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const inAssistantMode = useAnnaAppPaneState() === 'active'
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
        <View style={[styles.overlay, safeAreaOverlayPadding]}>
            <View style={styles.container}>
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

// Fills the screen like a full-screen app: no backdrop margin, no card corners, a slim header.
const styles = StyleSheet.create({
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFFFFF',
        zIndex: 9999,
    },
    container: {
        flex: 1,
        width: '100%',
        height: '100%',
        backgroundColor: '#FFFFFF',
        overflow: 'hidden',
    },
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
