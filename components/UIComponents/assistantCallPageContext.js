import { sanitizeCallPageContext } from '../../functions/WhatsApp/assistantCallPageContext'
import { getAnnaWorkspaceContext } from '../../utils/annaWorkspaceContext'

export function readCallPageContext() {
    if (typeof window === 'undefined') return null
    const annaContext = getAnnaWorkspaceContext()
    if (annaContext) return sanitizeCallPageContext(annaContext)
    // Both values are written by Alldone's URLSystem; title supplies the visible
    // task/note name without reading the page contents or unsaved input.
    return sanitizeCallPageContext({ path: window.location.pathname, title: document.title })
}

export function createCallPageContextSync({ sessionId, initialContext, read = readCallPageContext, publish, onError }) {
    let stopped = false
    let sending = false
    let sequence = 0
    let sent = JSON.stringify(initialContext)
    let retryAt = 0
    const tick = async () => {
        if (stopped || sending || Date.now() < retryAt) return
        const pageContext = read()
        const key = JSON.stringify(pageContext)
        if (!pageContext || key === sent) return
        sending = true
        try {
            const result = await publish({ sessionId, pageContext, sequence: ++sequence })
            if (result?.closed) stopped = true
            sent = key
        } catch (_) {
            // Keep the audio alive. Retry the latest page, not a queue of stale
            // pages, and never mark a failed update as delivered.
            retryAt = Date.now() + 2000
            onError?.()
        } finally {
            sending = false
        }
    }
    // Sampling also covers pushState/replaceState (which emit no browser event),
    // title changes after loading, and rapid navigation without patching history.
    const timer = setInterval(tick, 500)
    tick()
    return {
        stop: () => {
            stopped = true
            clearInterval(timer)
        },
    }
}
