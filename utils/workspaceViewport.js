// The Alldone pane is the app's viewport while the assistant chat is beside it.
// Portal coordinates remain browser-relative; inline fixed overlays use the
// pane as their CSS containing block. Keep this module independent of app state.
export const WORKSPACE_VIEWPORT_EVENT = 'alldone-workspace-viewport-change'
const VIEWPORT_KEY = '__alldoneWorkspaceViewport'

export const getWorkspaceViewport = (fallback = {}) => {
    const viewport = typeof window !== 'undefined' ? window[VIEWPORT_KEY] : null
    if (viewport) return viewport
    const width = fallback.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0)
    const height = fallback.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0)
    return { active: false, top: 0, left: 0, right: width, bottom: height, width, height }
}

export const setWorkspaceViewport = rect => {
    if (typeof window === 'undefined') return
    const next =
        rect?.width > 0 && rect?.height > 0
            ? {
                  active: true,
                  top: rect.top,
                  left: rect.left,
                  right: rect.left + rect.width,
                  bottom: rect.top + rect.height,
                  width: rect.width,
                  height: rect.height,
              }
            : null
    const previous = window[VIEWPORT_KEY] || null
    if (JSON.stringify(previous) === JSON.stringify(next)) return
    window[VIEWPORT_KEY] = next
    window.dispatchEvent(new Event(WORKSPACE_VIEWPORT_EVENT))
}

export const getWorkspaceInsets = (insets, viewport = getWorkspaceViewport()) => {
    if (!viewport.active) return insets
    return {
        top: Math.max(0, insets.top - viewport.top),
        left: Math.max(0, insets.left - viewport.left),
        right: Math.max(0, insets.right - (window.innerWidth - viewport.right)),
        bottom: Math.max(0, insets.bottom - (window.innerHeight - viewport.bottom)),
    }
}

export const getWorkspaceKeyboardInset = (inset, viewport = getWorkspaceViewport()) =>
    viewport.active ? Math.max(0, inset - (window.innerHeight - viewport.bottom)) : inset

export const getWorkspacePortalInsets = (viewport = getWorkspaceViewport()) =>
    viewport.active
        ? {
              top: viewport.top,
              left: viewport.left,
              right: window.innerWidth - viewport.right,
              bottom: window.innerHeight - viewport.bottom,
          }
        : { top: 0, left: 0, right: 0, bottom: 0 }
