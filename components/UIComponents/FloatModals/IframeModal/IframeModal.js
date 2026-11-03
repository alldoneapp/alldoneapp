import React, { useLayoutEffect } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../../../Icon'
import { colors, hexColorToRGBa } from '../../../styles/global'
import { setIframeModalData } from '../../../../redux/actions'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import EmbeddedAppFrame from './EmbeddedAppFrame'
import OpenInAssistantPaneButton from '../../../Anna/OpenInAssistantPaneButton'
import { iframeAppView, openInAnnaAppPane, useAnnaAppPaneState } from '../../../Anna/annaAppPaneBridge'

/**
 * The app-wide embed window for a pre-configured iframe task (e.g. an alldone.team tool page).
 * The app itself, and the protocol it speaks with Alldone, is EmbeddedAppFrame.
 *
 * In assistant mode there is no window: the app opens straight in the assistant shell's right pane
 * (AT-2951). Outside it, the header's "expand to the left" button switches to assistant mode with
 * the assistant sidebar on the left and this app on the right.
 */
export default function IframeModal() {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const dispatch = useDispatch()
    const iframeModalData = useSelector(state => state.iframeModalData)
    const { visible, url, name } = iframeModalData
    const paneState = useAnnaAppPaneState()
    const inAssistantMode = paneState === 'active'

    const closeModal = () => {
        dispatch(setIframeModalData(false, '', ''))
    }

    // Escape only — no backdrop-press dismiss on purpose: the iframe hosts
    // live third-party surfaces (screen share, mic) where a stray outside tap
    // must not tear the session down.
    useEscapeKey(closeModal, { enabled: !!visible && !inAssistantMode })

    // Opened while assistant mode is on (or switched on while open): show it in the pane instead.
    // Before paint, so the window never flashes over the workspace.
    useLayoutEffect(() => {
        if (!visible || !inAssistantMode) return
        if (openInAnnaAppPane(iframeAppView(url, name))) closeModal()
    }, [visible, inAssistantMode, url, name])

    const openInAssistantMode = () => {
        if (openInAnnaAppPane(iframeAppView(url, name))) closeModal()
    }

    if (!visible || inAssistantMode) return null

    return (
        <View style={[localStyles.overlay, safeAreaOverlayPadding]}>
            <View style={localStyles.container}>
                <View style={localStyles.header}>
                    <View style={localStyles.headerLeft}>
                        <OpenInAssistantPaneButton
                            onPress={openInAssistantMode}
                            hoverColor="#FFFFFF"
                            hoverBackground="rgba(255, 255, 255, 0.1)"
                        />
                        <Icon name="monitor" size={18} color={colors.Text03} />
                        <Text style={localStyles.headerTitle} numberOfLines={1}>
                            {name || 'Iframe'}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={closeModal} style={localStyles.closeButton}>
                        <Icon name="x" size={20} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={localStyles.content}>
                    <EmbeddedAppFrame url={url} title={name} onNavigateAway={closeModal} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
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
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0px 8px 24px rgba(0,0,0,0.40)',
    },
    header: {
        height: 44,
        backgroundColor: '#1a1a2e',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 16,
    },
    headerTitle: {
        color: colors.Text03,
        fontSize: 14,
        marginLeft: 10,
        flex: 1,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        backgroundColor: '#fff',
    },
})
