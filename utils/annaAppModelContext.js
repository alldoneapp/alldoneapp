import { sanitizeAppReportedState } from '../functions/Assistant/annaPaneContext'

// AT-2955: what an embedded app last told the host about itself, per pane view id. Written by the
// MCP Apps host (`ui/update-model-context`) and by EmbeddedAppFrame (`APP_CONTEXT`), read by the
// assistant shell when it publishes the pane context. In memory only: it describes a frame that is
// running in this tab, and dies with it. Untrusted app data: sanitized here, labelled in the prompt.
const contexts = new Map()

export function setAppModelContext(viewId, value) {
    if (typeof viewId !== 'string' || !viewId) return false
    const state = sanitizeAppReportedState(value)
    // An empty update clears, as in MCP Apps, where each update replaces the previous context.
    if (state) contexts.set(viewId, state)
    else contexts.delete(viewId)
    return !!state
}

export const getAppModelContext = viewId => contexts.get(viewId) || null

export const clearAppModelContext = viewId => contexts.delete(viewId)
