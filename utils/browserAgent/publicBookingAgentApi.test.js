import {
    AGENT_API_MANIFEST_ID,
    AGENT_API_STATE_ATTRIBUTE,
    AlldoneToolError,
    BROWSER_AGENT_CLIENT_HEADER,
    resetAgentApiAnnouncements,
} from './browserAgentApi'
import {
    PUBLIC_BOOKING_TOOL_NAMES,
    getPublicBookingDocsPath,
    getPublicBookingMcpPath,
    installPublicBookingAgentApi,
} from './publicBookingAgentApi'

const TOOLS = PUBLIC_BOOKING_TOOL_NAMES.map(name => ({
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
}))

function createFetch(handler) {
    return jest.fn(async (url, options) => {
        const request = JSON.parse(options.body)
        const result = handler(request, { url, options })
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) }
    })
}

const toolResult = body => ({
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    isError: body.success === false,
})

describe('booking page agent API (AT-3161)', () => {
    let dispose

    beforeEach(() => {
        resetAgentApiAnnouncements()
        jest.spyOn(console, 'info').mockImplementation(() => {})
        delete window.alldone
        delete document.modelContext
    })

    afterEach(() => {
        if (dispose) dispose()
        dispose = null
        jest.restoreAllMocks()
    })

    test('installs window.alldone in state public_booking, discoverable without sign-in', async () => {
        const fetchImpl = createFetch(() => ({ tools: TOOLS }))
        dispose = await installPublicBookingAgentApi({ win: window, slug: 'karsten-wysk', origin: '', fetchImpl })

        expect(Object.keys(window)).toContain('alldone')
        expect(window.alldone.state).toBe('public_booking')
        expect(document.documentElement.getAttribute(AGENT_API_STATE_ATTRIBUTE)).toBe('public_booking')
        const manifest = JSON.parse(document.getElementById(AGENT_API_MANIFEST_ID).textContent)
        expect(manifest).toEqual(
            expect.objectContaining({
                state: 'public_booking',
                authentication: 'none',
                tools: PUBLIC_BOOKING_TOOL_NAMES,
                mcpServer: '/api/booking/mcp/karsten-wysk',
                docs: '/meet/karsten-wysk/llms.txt',
            })
        )
        expect(window.alldone.help()).toContain('No sign-in needed')
        expect(window.alldone.help()).toContain('/meet/karsten-wysk/llms.txt')
        // An agent that is signed in to Alldone elsewhere is pointed at its own tools (AT-3161 follow-up).
        expect(window.alldone.help()).toContain('find_public_booking_times and book_public_meeting')
        expect(window.alldone.docs).toBe('/meet/karsten-wysk/llms.txt')
        expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Booking page agent API ready'))
        // Nothing is requested until an agent asks (no WebMCP in this browser).
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('calls the public booking MCP endpoint anonymously', async () => {
        const fetchImpl = createFetch(request =>
            request.method === 'tools/list'
                ? { tools: TOOLS }
                : toolResult({ success: true, timeZone: 'Europe/Berlin', options: [] })
        )
        dispose = await installPublicBookingAgentApi({
            win: window,
            slug: 'karsten-wysk',
            origin: 'https://my.alldone.app',
            fetchImpl,
        })

        const tools = await window.alldone.listTools()
        const result = await window.alldone.tools.find_available_times({ start: 'a', end: 'b' })

        expect(tools.map(tool => tool.name)).toEqual(PUBLIC_BOOKING_TOOL_NAMES)
        expect(tools.find(tool => tool.name === 'book_meeting').annotations).toEqual(
            expect.objectContaining({ readOnlyHint: false, consequentialHint: true })
        )
        expect(result).toEqual({ success: true, timeZone: 'Europe/Berlin', options: [] })
        const [url, options] = fetchImpl.mock.calls[1]
        expect(url).toBe('https://my.alldone.app/api/booking/mcp/karsten-wysk')
        expect(options.headers).not.toHaveProperty('Authorization')
        expect(options.credentials).toBe('omit')
        expect(options.headers[BROWSER_AGENT_CLIENT_HEADER]).toBe('alldone-browser-agent')
        expect(JSON.parse(options.body)).toEqual(
            expect.objectContaining({
                method: 'tools/call',
                params: { name: 'find_available_times', arguments: { start: 'a', end: 'b' } },
            })
        )
    })

    test('a refused booking throws AlldoneToolError carrying the code', async () => {
        const fetchImpl = createFetch(() =>
            toolResult({ success: false, code: 'slot_unavailable', error: 'This slot is no longer available.' })
        )
        dispose = await installPublicBookingAgentApi({ win: window, slug: 'karsten-wysk', origin: '', fetchImpl })

        const error = await window.alldone.callTool('book_meeting', {}).catch(caught => caught)

        expect(error).toBeInstanceOf(AlldoneToolError)
        expect(error.message).toBe('This slot is no longer available.')
        expect(error.data.code).toBe('slot_unavailable')
    })

    test('registers the tools with WebMCP where the browser has it', async () => {
        const registerTool = jest.fn()
        document.modelContext = { registerTool }
        const fetchImpl = createFetch(() => ({ tools: TOOLS }))

        dispose = await installPublicBookingAgentApi({ win: window, slug: 'karsten-wysk', origin: '', fetchImpl })

        expect(registerTool.mock.calls.map(([definition]) => definition.name)).toEqual(PUBLIC_BOOKING_TOOL_NAMES)
        expect(JSON.parse(document.getElementById(AGENT_API_MANIFEST_ID).textContent).webMcp).toEqual({
            available: true,
            registeredTools: 3,
        })
    })

    test('dispose removes the API and its markers', async () => {
        const fetchImpl = createFetch(() => ({ tools: TOOLS }))
        const disposeApi = await installPublicBookingAgentApi({
            win: window,
            slug: 'karsten-wysk',
            origin: '',
            fetchImpl,
        })

        disposeApi()

        expect('alldone' in window).toBe(false)
        expect(document.getElementById(AGENT_API_MANIFEST_ID)).toBeNull()
        expect(document.documentElement.hasAttribute(AGENT_API_STATE_ATTRIBUTE)).toBe(false)
    })

    test('paths encode the slug', () => {
        expect(getPublicBookingMcpPath('a b')).toBe('/api/booking/mcp/a%20b')
        expect(getPublicBookingDocsPath('karsten-wysk')).toBe('/meet/karsten-wysk/llms.txt')
    })
})
