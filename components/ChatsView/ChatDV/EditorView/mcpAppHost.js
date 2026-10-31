/**
 * The host side of MCP Apps (SEP-1865, io.modelcontextprotocol/ui, protocol 2026-01-26) for a view
 * framed in the chat: JSON-RPC 2.0 over postMessage. The view side for alldone.team is
 * `src/mcp-apps/bridge.ts` there. Pure functions and a small state machine, so the protocol is
 * testable without a frame.
 */

export const MCP_APPS_PROTOCOL_VERSION = '2026-01-26'
// No allow-same-origin: the view runs on an opaque origin and cannot touch the app's storage.
export const MCP_APP_FRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'

const HOST_INFO = { name: 'Alldone', version: '1.0.0' }
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

// A domain from the resource's CSP: an https origin or wildcard host, nothing that could close the
// directive or add a keyword.
const isSafeSource = value => typeof value === 'string' && /^https:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(value)
const sources = list => (Array.isArray(list) ? list.filter(isSafeSource) : [])

/** The Content-Security-Policy the view runs under, from `_meta.ui.csp` (the parent page's applies too). */
export function buildMcpAppCsp(csp) {
    const resource = sources(csp?.resourceDomains)
    const connect = sources(csp?.connectDomains)
    const frames = sources(csp?.frameDomains)
    const join = (base, extra) => [...base, ...extra].join(' ')
    return [
        "default-src 'none'",
        `script-src ${join(["'unsafe-inline'"], resource)}`,
        `style-src ${join(["'unsafe-inline'"], resource)}`,
        `img-src ${join(['data:', 'blob:'], resource)}`,
        `font-src ${join(['data:'], resource)}`,
        `media-src ${join(['data:', 'blob:'], resource)}`,
        `connect-src ${connect.length ? connect.join(' ') : "'none'"}`,
        `frame-src ${frames.length ? frames.join(' ') : "'none'"}`,
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ')
}

/** The view's HTML with its CSP as the first thing in <head>. */
export function buildMcpAppDocument(html, csp) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${buildMcpAppCsp(csp).replace(/"/g, '&quot;')}">`
    const text = String(html || '')
    if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, match => `${match}${meta}`)
    if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, match => `${match}<head>${meta}</head>`)
    return `<!doctype html><html><head>${meta}</head><body>${text}</body></html>`
}

const isHttpUrl = value => {
    try {
        const url = new URL(value)
        return url.protocol === 'https:' || url.protocol === 'http:'
    } catch (_) {
        return false
    }
}

function downloadResource(contents) {
    const resource = Array.isArray(contents) ? contents[0]?.resource : null
    if (!resource || typeof resource.blob !== 'string') return false
    const binary = atob(resource.blob)
    if (binary.length > MAX_DOWNLOAD_BYTES) return false
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: resource.mimeType || 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = decodeURIComponent(
        String(resource.uri || 'download')
            .split('/')
            .pop() || 'download'
    )
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return true
}

/**
 * One view's host. `onMessage` takes window message events and answers only the view's own frame.
 * The tool input and result the view was opened with are sent once it reports itself initialized.
 */
export function createMcpAppHost({
    getFrameWindow,
    toolName,
    toolArguments,
    toolResult,
    language,
    callTool,
    onSize,
    onDisplayMode,
    getDisplayMode,
    openUrl = url => window.open(url, '_blank', 'noopener,noreferrer'),
    download = downloadResource,
}) {
    let disposed = false
    const send = message => {
        const frame = getFrameWindow()
        // The frame is on an opaque origin, so '*' is the only target that reaches it; what is sent
        // is the view's own tool data, which it already has the right to see.
        if (frame && !disposed) frame.postMessage({ jsonrpc: '2.0', ...message }, '*')
    }
    const respond = (id, result) => send({ id, result })
    const fail = (id, code, message) => send({ id, error: { code, message } })

    const hostContext = () => ({
        toolInfo: { tool: { name: toolName } },
        theme: 'light',
        displayMode: getDisplayMode(),
        availableDisplayModes: ['inline', 'fullscreen'],
        locale: ['de', 'es'].includes(String(language || '').split(/[-_]/)[0])
            ? String(language).split(/[-_]/)[0]
            : 'en',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: 'web',
    })

    async function handleRequest(id, method, params) {
        switch (method) {
            case 'ui/initialize':
                return respond(id, {
                    protocolVersion: MCP_APPS_PROTOCOL_VERSION,
                    hostInfo: HOST_INFO,
                    hostCapabilities: { openLinks: {}, serverTools: {}, downloadFile: {}, updateModelContext: {} },
                    hostContext: hostContext(),
                })
            case 'tools/call':
                try {
                    const name = typeof params?.name === 'string' ? params.name : ''
                    return respond(id, await callTool(name, params?.arguments || {}))
                } catch (error) {
                    return fail(id, -32000, error?.message || 'The tool call failed.')
                }
            case 'ui/open-link':
                if (!isHttpUrl(params?.url)) return respond(id, { isError: true })
                openUrl(params.url)
                return respond(id, {})
            case 'ui/request-display-mode':
                return respond(id, { mode: onDisplayMode(params?.mode === 'fullscreen' ? 'fullscreen' : 'inline') })
            case 'ui/update-model-context':
                // Accepted; the assistant reads the app's state through its own tools next turn.
                return respond(id, {})
            case 'ui/download-file':
                return respond(id, download(params?.contents) ? {} : { isError: true })
            case 'ping':
                return respond(id, {})
            default:
                return fail(id, -32601, `Method not found: ${method}`)
        }
    }

    function onMessage(event) {
        const frame = getFrameWindow()
        if (disposed || !frame || event.source !== frame) return
        const message = event.data
        if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
            return
        if (message.id !== undefined) return void handleRequest(message.id, message.method, message.params || {})
        if (message.method === 'ui/notifications/initialized') {
            send({ method: 'ui/notifications/tool-input', params: { arguments: toolArguments || {} } })
            if (toolResult) send({ method: 'ui/notifications/tool-result', params: toolResult })
        } else if (message.method === 'ui/notifications/size-changed') {
            const height = Number(message.params?.height)
            if (Number.isFinite(height) && height > 0) onSize(height)
        }
    }

    return {
        onMessage,
        dispose: () => {
            disposed = true
        },
    }
}
