import { buildMcpAppCsp, buildMcpAppDocument, createMcpAppHost, MCP_APP_FRAME_SANDBOX } from './mcpAppHost'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(overrides = {}) {
    const frame = { postMessage: jest.fn() }
    let mode = 'inline'
    const options = {
        getFrameWindow: () => frame,
        toolName: 'judy_show',
        toolArguments: { view: 'matches' },
        toolResult: { content: [], structuredContent: { total: 2 } },
        language: 'de',
        callTool: jest.fn(async (name, args) => ({ structuredContent: { name, args } })),
        onSize: jest.fn(),
        onDisplayMode: jest.fn(next => (mode = next)),
        getDisplayMode: () => mode,
        openUrl: jest.fn(),
        download: jest.fn(() => true),
        ...overrides,
    }
    const host = createMcpAppHost(options)
    const fromFrame = data => host.onMessage({ source: frame, data })
    const sent = () => frame.postMessage.mock.calls.map(([message]) => message)
    return { frame, host, options, fromFrame, sent }
}

describe('the frame the view runs in', () => {
    test('never gets the app’s origin', () => {
        expect(MCP_APP_FRAME_SANDBOX).toContain('allow-scripts')
        expect(MCP_APP_FRAME_SANDBOX).not.toContain('allow-same-origin')
        expect(MCP_APP_FRAME_SANDBOX).not.toContain('allow-top-navigation')
    })

    test('runs under its own CSP, which takes only https sources from the resource', () => {
        const csp = buildMcpAppCsp({
            connectDomains: ['https://api.example.com', "https://x.example; script-src 'unsafe-eval'"],
            resourceDomains: ['https://cdn.example.com', 'http://plain.example'],
        })
        expect(csp).toContain("default-src 'none'")
        expect(csp).toContain('connect-src https://api.example.com')
        expect(csp).toContain("script-src 'unsafe-inline' https://cdn.example.com")
        expect(csp).not.toContain('unsafe-eval')
        expect(csp).not.toContain('http://plain.example')
        expect(buildMcpAppCsp(null)).toContain("connect-src 'none'")
    })

    test('puts the CSP first in the document', () => {
        const html = buildMcpAppDocument('<!doctype html><html><head><title>x</title></head><body></body></html>', null)
        expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<title>'))
        expect(buildMcpAppDocument('<p>bare</p>', null)).toMatch(
            /^<!doctype html><html><head><meta[^>]+><\/head><body><p>bare<\/p>/
        )
    })
})

describe('the host protocol', () => {
    test('answers the handshake and then sends the tool input and result', async () => {
        const { fromFrame, sent } = setup()
        fromFrame({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} })
        await flush()
        expect(sent()[0]).toMatchObject({
            id: 1,
            result: {
                protocolVersion: '2026-01-26',
                hostCapabilities: { serverTools: {}, openLinks: {} },
                hostContext: { displayMode: 'inline', locale: 'de', toolInfo: { tool: { name: 'judy_show' } } },
            },
        })
        fromFrame({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
        expect(sent().slice(1)).toEqual([
            { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { view: 'matches' } } },
            {
                jsonrpc: '2.0',
                method: 'ui/notifications/tool-result',
                params: { content: [], structuredContent: { total: 2 } },
            },
        ])
    })

    test('runs a tool through the server and reports a failure as a JSON-RPC error', async () => {
        const { fromFrame, sent, options } = setup()
        fromFrame({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'judy_view_get', arguments: { view: 'x' } },
        })
        await flush()
        expect(options.callTool).toHaveBeenCalledWith('judy_view_get', { view: 'x' })
        expect(sent()[0]).toMatchObject({ id: 2, result: { structuredContent: { name: 'judy_view_get' } } })

        options.callTool.mockRejectedValueOnce(new Error('The app may not call that tool.'))
        fromFrame({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'secret' } })
        await flush()
        expect(sent()[1]).toMatchObject({ id: 3, error: { code: -32000, message: 'The app may not call that tool.' } })
    })

    test('opens only web links, switches display mode and reports size', async () => {
        const { fromFrame, sent, options } = setup()
        fromFrame({ jsonrpc: '2.0', id: 4, method: 'ui/open-link', params: { url: 'javascript:alert(1)' } })
        fromFrame({ jsonrpc: '2.0', id: 5, method: 'ui/open-link', params: { url: 'https://alldone.team/judy-job' } })
        fromFrame({ jsonrpc: '2.0', id: 6, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
        fromFrame({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 600, height: 512 } })
        await flush()
        expect(options.openUrl).toHaveBeenCalledTimes(1)
        expect(options.openUrl).toHaveBeenCalledWith('https://alldone.team/judy-job')
        expect(sent()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 4, result: { isError: true } }),
                expect.objectContaining({ id: 6, result: { mode: 'fullscreen' } }),
            ])
        )
        expect(options.onSize).toHaveBeenCalledWith(512)
    })

    test('ignores other windows, unknown methods get an error, and nothing is sent after dispose', async () => {
        const { host, fromFrame, sent, options } = setup()
        host.onMessage({ source: {}, data: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'x' } } })
        fromFrame({ jsonrpc: '2.0', id: 10, method: 'ui/unknown', params: {} })
        await flush()
        expect(options.callTool).not.toHaveBeenCalled()
        expect(sent()).toEqual([
            { jsonrpc: '2.0', id: 10, error: { code: -32601, message: 'Method not found: ui/unknown' } },
        ])
        host.dispose()
        fromFrame({ jsonrpc: '2.0', id: 11, method: 'ping' })
        await flush()
        expect(sent()).toHaveLength(1)
    })
})
