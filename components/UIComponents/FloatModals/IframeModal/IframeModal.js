import React, { useEffect, useLayoutEffect } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import { setIframeModalData } from '../../../../redux/actions'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import useWindowSize from '../../../../utils/useWindowSize'
import EmbeddedAppFrame from './EmbeddedAppFrame'
import { embedWindowStyles, getEmbedWindowGap, isEmbedWindowFullscreen, useBackdropDismiss } from './embedWindowLayout'
import OpenInAssistantPaneButton from '../../../Anna/OpenInAssistantPaneButton'
import {
    iframeAppView,
    openInAnnaAppPane,
    registerEmbedWindow,
    useAnnaAppPaneState,
} from '../../../Anna/annaAppPaneBridge'

/**
 * The app-wide embed window for a pre-configured iframe task (e.g. an alldone.team tool page).
 * The app itself, and the protocol it speaks with Alldone, is EmbeddedAppFrame.
 *
 * In assistant mode there is no window: the app opens straight in the assistant shell's right pane
 * (AT-2951). Outside it, the header's "expand to the left" button switches to assistant mode with
 * the assistant sidebar on the left and this app on the right. Leaving assistant mode while the app
 * is shown in the pane opens it here again.
 *
 * The window fills the viewport but for one uniform gap, and a click on the backdrop next to it
 * closes it (AT-2953, see embedWindowLayout.js).
 */
export default function IframeModal() {
    const [windowWidth] = useWindowSize()
    const fullscreen = isEmbedWindowFullscreen(windowWidth)
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding(getEmbedWindowGap(fullscreen))
    const dispatch = useDispatch()
    const iframeModalData = useSelector(state => state.iframeModalData)
    const { visible, url, name } = iframeModalData
    const paneState = useAnnaAppPaneState()
    const inAssistantMode = paneState === 'active'

    const closeModal = () => {
        dispatch(setIframeModalData(false, '', ''))
    }

    // Escape, the X and (AT-2953, product decision) a click on the backdrop next to the window. The
    // backdrop only counts a press that starts and ends on it, so a drag out of the app or the click
    // that opened the window cannot close it.
    useEscapeKey(closeModal, { enabled: !!visible && !inAssistantMode })
    const backdropDismiss = useBackdropDismiss(closeModal, { enabled: !fullscreen })

    // Leaving assistant mode with this kind of app in the pane brings it back here (AT-2951).
    useEffect(
        () =>
            registerEmbedWindow('iframe', view => {
                dispatch(setIframeModalData(true, view.url, view.appName || ''))
            }),
        [dispatch]
    )

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
        <View
            testID="embed-window-backdrop"
            {...backdropDismiss}
            style={[embedWindowStyles.overlay, fullscreen && localStyles.overlayFullscreen, safeAreaOverlayPadding]}
        >
            <View
                style={[
                    embedWindowStyles.container,
                    localStyles.container,
                    fullscreen && embedWindowStyles.containerFullscreen,
                ]}
            >
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
    // On a phone the safe-area strips around the full-screen window take its colour.
    overlayFullscreen: {
        backgroundColor: '#1a1a2e',
    },
    container: {
        backgroundColor: '#1a1a2e',
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
