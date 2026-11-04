export const TEAM_ORIGIN = 'https://alldone.team'
export const EMBEDDED_TOOL_WINDOW_ROUTE = 'EmbeddedToolWindow'
const TOOL_PATH = '/tools/alldone-team'
const HANDOFF_PARAM = 'toolHandoff'
const MAX_URL_LENGTH = 4096
const isHandoffId = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || '')

export const readEmbeddedToolWindow = (address = window.location.href) => {
    if (typeof address !== 'string' || address.length > MAX_URL_LENGTH) return null
    try {
        const host = new URL(address, window.location.origin)
        if (host.origin !== window.location.origin) return null
        const id = host.searchParams.get(HANDOFF_PARAM)
        const handoffId = isHandoffId(id) ? id : null
        // A source tab running the previous release can still open a root handoff URL.
        if (host.pathname === '/' && handoffId) return { url: null, handoffId }
        if (!host.pathname.startsWith(TOOL_PATH + '/')) return null

        const tool = new URL(TEAM_ORIGIN)
        tool.pathname = host.pathname.slice(TOOL_PATH.length)
        return { url: tool.href, handoffId }
    } catch (error) {
        return null
    }
}

// The address identifies the tool's page. A handoff still carries its exact starting URL and
// transient view between the frames. Private query parameters are kept out of browser history.
export const buildEmbeddedToolWindowUrl = (toolUrl, handoffId) => {
    if (typeof toolUrl !== 'string' || toolUrl.length > MAX_URL_LENGTH) return null
    try {
        const tool = new URL(toolUrl)
        if (tool.origin !== TEAM_ORIGIN || tool.username || tool.password) return null
        const host = new URL(TOOL_PATH + tool.pathname, window.location.origin)
        if (isHandoffId(handoffId)) host.searchParams.set(HANDOFF_PARAM, handoffId)
        return host.href
    } catch (error) {
        return null
    }
}
