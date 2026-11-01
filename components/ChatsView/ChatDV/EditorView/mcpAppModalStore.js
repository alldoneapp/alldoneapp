/**
 * The one MCP Apps view open in the app-wide embed window (McpAppModal), outside Anna's assistant
 * shell. A tiny store rather than redux: it concerns one window, and a chat card anywhere opens it.
 */
let current = null
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener(current))

export const getOpenMcpAppView = () => current
export function openMcpAppView(view) {
    if (!view?.viewId) return
    current = view
    emit()
}
export function closeMcpAppView() {
    current = null
    emit()
}
export function subscribeMcpAppView(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
