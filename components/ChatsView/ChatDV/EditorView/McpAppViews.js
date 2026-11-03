import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { createMcpAppHost, buildMcpAppDocument, MCP_APP_FRAME_SANDBOX } from './mcpAppHost'
import { getOpenMcpAppView, openMcpAppView, subscribeMcpAppView } from './mcpAppModalStore'
import AnnaAppPaneContext from '../../../Anna/AnnaAppPaneContext'

// Required lazily like the other cards under a message: a static import of the backend pulls the
// redux store and the Firebase client into every suite that renders a chat message.
const mcpAppBackend = () => require('../../../../utils/backends/Assistants/mcpAppViews')

// A view recorded this recently belongs to the answer that is arriving now and opens by itself; an
// older one (scrolling back, reopening the chat) only offers to open.
const FRESH_VIEW_MS = 2 * 60 * 1000

/** Which app a view shows: the same server's same `ui://` resource is one app, whatever the tool. */
export const mcpAppKey = view =>
    view?.serverId && view?.resourceUri ? `${view.serverId}|${view.resourceUri}` : view?.viewId

/**
 * The newest view of each app, in the order the apps first appeared. A run that calls the same
 * app's tool again (judy_show with another filter) supersedes its earlier view instead of adding a
 * second card for the same app. Expects views sorted by `createdAt`, as watchMcpAppViews delivers.
 */
export function latestViewPerApp(views) {
    const byApp = new Map()
    for (const view of views) byApp.set(mcpAppKey(view), view)
    return [...byApp.values()]
}

/**
 * One MCP Apps view (e.g. Judy) in a sandboxed frame that fills its container: Anna's right pane or
 * the embed window (McpAppModal). Never inline in the chat. The frame's document is the server's own
 * HTML written into `srcdoc` with no `allow-same-origin`, so it runs on an opaque origin: it cannot
 * reach the app's storage or session, and its own CSP (from the resource's `_meta.ui.csp`) limits
 * what it may load. It talks to this host over postMessage (mcpAppHost.js); every server call goes
 * through `mcpAppSecondGen`. The view always runs in fullscreen mode: a request for any other mode
 * is the view's own "show in chat" button, and closes the pane or window (`onClose`).
 */
export function McpAppFrame({ view, language, onClose }) {
    const frameRef = useRef(null)
    const [resource, setResource] = useState(null)
    const [failed, setFailed] = useState('')
    // Read through a ref so a new callback each render does not rebuild the host mid-session.
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

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
            onSize: () => {},
            onDisplayMode: mode => {
                if (mode !== 'fullscreen') onCloseRef.current?.()
                // Still fullscreen: reopened, the view shows its full layout again.
                return 'fullscreen'
            },
            getDisplayMode: () => 'fullscreen',
            availableDisplayModes: ['fullscreen'],
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
        <iframe
            ref={frameRef}
            data-testid="mcp-app-frame"
            title={view.appName || view.serverLabel || view.toolName}
            srcDoc={srcDocument}
            sandbox={MCP_APP_FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', flex: 1, border: 'none', background: 'transparent' }}
        />
    )
}

/** Outside Anna's shell the views open in the app-wide embed window instead of a pane. */
function useEmbedWindow() {
    const [openView, setOpenView] = useState(getOpenMcpAppView)
    useEffect(() => subscribeMcpAppView(setOpenView), [])
    return useMemo(() => ({ open: openMcpAppView, selectedViewId: openView?.viewId || null, embed: true }), [openView])
}

/** The line under the answer that (re)opens the view. */
function McpAppCard({ view, target }) {
    const open = target.selectedViewId === view.viewId
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
                {view.appName || view.serverLabel || view.toolName}
            </Text>
            {open ? (
                <Text style={styles.cardState}>
                    {translate(target.embed ? 'mcp_app_open' : 'mcp_app_open_on_right')}
                </Text>
            ) : (
                <TouchableOpacity onPress={() => target.open(view)} accessibilityRole="button">
                    <Text style={styles.cardAction}>{translate('mcp_app_show')}</Text>
                </TouchableOpacity>
            )}
        </View>
    )
}

/**
 * Every MCP Apps view a run recorded under this assistant answer, for the person it acted for, as a
 * card. The view itself opens in Anna's right pane (AnnaAppPaneContext) or, outside the assistant
 * shell, in the embed window (McpAppModal).
 */
export default function McpAppViews({ commentId }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const pane = useContext(AnnaAppPaneContext)
    const embedWindow = useEmbedWindow()
    const target = pane || embedWindow
    const [allViews, setViews] = useState([])
    const views = useMemo(() => latestViewPerApp(allViews), [allViews])
    const handled = useRef(new Set())

    useEffect(() => {
        if (!commentId || !userId) return undefined
        return mcpAppBackend().watchMcpAppViews(commentId, userId, setViews)
    }, [commentId, userId])

    // A view that arrives with the answer opens once by itself; the user can close or switch away.
    // This runs while the answer is still being written (MessageItemBody keeps it mounted then),
    // so "fresh" is measured close to the tool call that recorded the view.
    useEffect(() => {
        for (const view of views) {
            if (handled.current.has(view.viewId)) continue
            handled.current.add(view.viewId)
            if (Date.now() - (Number(view.createdAt) || 0) < FRESH_VIEW_MS) target.open(view, { auto: true })
        }
    }, [views, target])

    if (views.length === 0) return null
    return (
        <View style={styles.list}>
            {views.map(view => (
                <McpAppCard key={view.viewId} view={view} target={target} />
            ))}
        </View>
    )
}

const styles = StyleSheet.create({
    list: { marginTop: 8 },
    loading: { margin: 16, color: colors.Text03, fontSize: 13 },
    failed: { margin: 16, color: colors.UtilityRed200, fontSize: 13 },
    card: {
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardTitle: { flex: 1, color: colors.Text01, fontSize: 14, fontWeight: '600', marginRight: 12 },
    cardState: { color: colors.Text03, fontSize: 13 },
    cardAction: { color: colors.Primary100, fontSize: 13, fontWeight: '600' },
})
