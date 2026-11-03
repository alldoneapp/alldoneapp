import { useSyncExternalStore } from 'react'

/**
 * Lets the app-wide embed windows (IframeModal, McpAppModal) hand their app to the assistant
 * shell's right pane (AT-2951). Those windows are mounted with the global modals in AppContent,
 * outside AnnaShell's tree, so a React context cannot reach them; AnnaShell registers its pane
 * opener here instead, and reports whether assistant mode is currently open.
 *
 * Views use the AnnaShell app-pane shape: `{ viewId, appName, ... }` for an MCP Apps view, or
 * `{ kind: 'iframe', viewId, url, appName }` for an embedded web app (see `iframeAppView`).
 */
let opener = null
let active = false
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())

/**
 * AnnaShell registers its pane opener together with whether assistant mode (split or chat-only) is
 * open; returns the unregister function. Last registration wins.
 */
export function registerAnnaAppPane(open, isActive) {
    opener = open
    active = !!isActive
    emit()
    return () => {
        if (opener !== open) return
        opener = null
        active = false
        emit()
    }
}

/**
 * Opens a view in the pane, switching assistant mode on when it is off. Returns false when no
 * assistant shell is mounted (signed out, anonymous, onboarding), so the caller keeps its window.
 */
export function openInAnnaAppPane(view, options) {
    if (!opener || !view?.viewId) return false
    opener(view, options)
    return true
}

// 'none' – no shell; 'available' – shell mounted, assistant mode off; 'active' – assistant mode on.
const getState = () => (!opener ? 'none' : active ? 'active' : 'available')
const subscribe = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
export const getAnnaAppPaneState = getState
export const useAnnaAppPaneState = () => useSyncExternalStore(subscribe, getState, () => 'none')

/** The pane view for an embedded web app; the same URL is one pane, opened again it is reselected. */
export const iframeAppView = (url, name) =>
    url ? { kind: 'iframe', viewId: `iframe:${url}`, url, appName: name || '' } : null
