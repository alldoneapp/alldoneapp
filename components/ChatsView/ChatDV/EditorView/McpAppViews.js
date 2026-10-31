import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { createMcpAppHost, buildMcpAppDocument, MCP_APP_FRAME_SANDBOX } from './mcpAppHost'

// Required lazily like the other cards under a message: a static import of the backend pulls the
// redux store and the Firebase client into every suite that renders a chat message.
const mcpAppBackend = () => require('../../../../utils/backends/Assistants/mcpAppViews')

const INLINE_MIN_HEIGHT = 160
const INLINE_MAX_HEIGHT = 720
const INLINE_START_HEIGHT = 420

/**
 * One MCP Apps view (e.g. Judy) in a sandboxed frame. The frame's document is the server's own
 * HTML written into `srcdoc` with no `allow-same-origin`, so it runs on an opaque origin: it cannot
 * reach the app's storage or session, and its own CSP (from the resource's `_meta.ui.csp`) limits
 * what it may load. It talks to this host over postMessage (mcpAppHost.js); every server call goes
 * through `mcpAppSecondGen`. Fullscreen only restyles the same frame, so the view keeps its state.
 */
export function McpAppFrame({ view, language }) {
    const frameRef = useRef(null)
    const [resource, setResource] = useState(null)
    const [failed, setFailed] = useState('')
    const [height, setHeight] = useState(INLINE_START_HEIGHT)
    const [fullscreen, setFullscreen] = useState(false)
    const fullscreenRef = useRef(false)
    fullscreenRef.current = fullscreen

    useEffect(() => {
        let cancelled = false
        mcpAppBackend()
            .loadMcpAppResource(view.viewId)
            .then(result => !cancelled && setResource(result))
            .catch(error => !cancelled && setFailed(error?.message || translate('mcp_app_failed')))
        return () => {
            cancelled = true
        }
    }, [view.viewId])

    useEffect(() => {
        if (!resource) return undefined
        const host = createMcpAppHost({
            getFrameWindow: () => frameRef.current?.contentWindow || null,
            toolName: resource.toolName,
            toolArguments: resource.toolArguments || {},
            toolResult: resource.toolResult,
            language,
            callTool: (name, args) => mcpAppBackend().callMcpAppTool(view.viewId, name, args),
            onSize: reportedHeight =>
                setHeight(Math.min(INLINE_MAX_HEIGHT, Math.max(INLINE_MIN_HEIGHT, Math.ceil(reportedHeight)))),
            onDisplayMode: mode => {
                setFullscreen(mode === 'fullscreen')
                return mode === 'fullscreen' ? 'fullscreen' : 'inline'
            },
            getDisplayMode: () => (fullscreenRef.current ? 'fullscreen' : 'inline'),
        })
        window.addEventListener('message', host.onMessage)
        return () => {
            window.removeEventListener('message', host.onMessage)
            host.dispose()
        }
    }, [resource, view.viewId, language])

    const srcDocument = useMemo(() => (resource ? buildMcpAppDocument(resource.html, resource.csp) : ''), [resource])

    if (failed) return <Text style={styles.failed}>{failed}</Text>
    if (!resource) return <Text style={styles.loading}>{translate('mcp_app_loading')}</Text>

    return (
        <View style={fullscreen ? styles.fullscreen : styles.inline}>
            {fullscreen && (
                <View style={styles.fullscreenBar}>
                    <Text style={styles.title} numberOfLines={1}>
                        {view.serverLabel}
                    </Text>
                    <TouchableOpacity onPress={() => setFullscreen(false)} accessibilityLabel={translate('Close')}>
                        <Text style={styles.close}>{translate('Close')}</Text>
                    </TouchableOpacity>
                </View>
            )}
            <iframe
                ref={frameRef}
                data-testid="mcp-app-frame"
                title={view.serverLabel || view.toolName}
                srcDoc={srcDocument}
                sandbox={MCP_APP_FRAME_SANDBOX}
                referrerPolicy="no-referrer"
                style={{
                    width: '100%',
                    border: resource.prefersBorder && !fullscreen ? `1px solid ${colors.Grey300}` : 'none',
                    borderRadius: fullscreen ? 0 : 8,
                    height: fullscreen ? '100%' : height,
                    flex: fullscreen ? 1 : undefined,
                    background: 'transparent',
                }}
            />
        </View>
    )
}

/** Every MCP Apps view a run recorded under this assistant answer, for the person it acted for. */
export default function McpAppViews({ commentId }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const language = useSelector(state => state.loggedUser.language)
    const [views, setViews] = useState([])

    useEffect(() => {
        if (!commentId || !userId) return undefined
        return mcpAppBackend().watchMcpAppViews(commentId, userId, setViews)
    }, [commentId, userId])

    if (views.length === 0) return null
    return (
        <View style={styles.list}>
            {views.map(view => (
                <McpAppFrame key={view.viewId} view={view} language={language} />
            ))}
        </View>
    )
}

const styles = StyleSheet.create({
    list: { marginTop: 8 },
    inline: { marginTop: 8, width: '100%' },
    fullscreen: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        backgroundColor: '#FFFFFF',
        flexDirection: 'column',
    },
    fullscreenBar: {
        height: 44,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    title: { flex: 1, color: colors.Text01, fontSize: 14, fontWeight: '600' },
    close: { color: colors.Primary100, fontSize: 14, fontWeight: '600' },
    loading: { marginTop: 8, color: colors.Text03, fontSize: 13 },
    failed: { marginTop: 8, color: colors.UtilityRed200, fontSize: 13 },
})
