import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import { colors, hexColorToRGBa } from '../../../styles/global'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import { McpAppFrame } from './McpAppViews'
import { closeMcpAppView, getOpenMcpAppView, subscribeMcpAppView } from './mcpAppModalStore'

/**
 * The embed window an MCP Apps view (e.g. Judy) opens in outside Anna's assistant shell, shaped like
 * the alldone.team tool embeds (IframeModal). Mounted once with the global modals.
 */
export default function McpAppModal() {
    const language = useSelector(state => state.loggedUser.language)
    const [view, setView] = useState(getOpenMcpAppView)
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    useEffect(() => subscribeMcpAppView(setView), [])
    useEscapeKey(closeMcpAppView, { enabled: !!view })

    if (!view) return null
    return (
        <View style={[styles.overlay, safeAreaOverlayPadding]}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title} numberOfLines={1}>
                        {view.appName || view.serverLabel || view.toolName}
                    </Text>
                    <TouchableOpacity onPress={closeMcpAppView} style={styles.close} accessibilityRole="button">
                        <Icon name="x" size={20} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={styles.content}>
                    <McpAppFrame key={view.viewId} view={view} language={language} />
                </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        zIndex: 9999,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
    },
    container: {
        width: '96%',
        height: '96%',
        maxWidth: 1600,
        maxHeight: 1200,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0px 8px 24px rgba(0,0,0,0.40)',
    },
    header: {
        height: 44,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    title: { flex: 1, marginRight: 16, color: colors.Text01, fontSize: 14, fontWeight: '600' },
    close: { width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, display: 'flex' },
})
