'use strict'

// The streaming tool loop authorises every tool call against the ASSISTANT DOCUMENT's persisted
// `allowedTools`, not against the list the run was started with — the run list only decides which
// schemas the model sees. That is the right gate for a client-supplied list (a browser must not be
// able to grant itself tools), but a server-authored run such as the contact enrichment needs tools
// the assistant's owner never enabled. Those runs put their grant on the runtime context as
// `serverGrantedTools`; only Cloud Functions code builds that context, so it cannot come from a
// client. The union below is what the gate checks.

function resolveRunAllowedTools(assistantAllowedTools, toolRuntimeContext = null) {
    const persisted = Array.isArray(assistantAllowedTools) ? assistantAllowedTools : []
    const granted = Array.isArray(toolRuntimeContext?.serverGrantedTools) ? toolRuntimeContext.serverGrantedTools : []
    if (granted.length === 0) return persisted
    const merged = [...persisted]
    for (const toolName of granted) {
        if (typeof toolName === 'string' && toolName && !merged.includes(toolName)) merged.push(toolName)
    }
    return merged
}

module.exports = { resolveRunAllowedTools }
