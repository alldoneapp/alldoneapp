'use strict'

// AT-3161 follow-up: a client connected to the Alldone MCP server (Claude, ChatGPT, Codex, and
// `window.alldone` / WebMCP in a signed-in tab, which proxy this server) finds the booking-link tools
// in its normal tool list and calls them like every shared tool. Before, the tools existed only on
// the anonymous per-page endpoint, so a connected agent fell back to browser clicks.

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(() => ({ doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) })),
    })),
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
}))
jest.mock('./auth/cloudOAuth.js', () => ({
    CloudOAuthHandler: jest.fn().mockImplementation(() => ({})),
    CloudSessionManager: jest.fn().mockImplementation(() => ({})),
    UserSessionManager: jest.fn().mockImplementation(() => ({})),
}))
jest.mock('./config/environments.js', () => ({
    getEnvironmentConfig: jest.fn(() => ({ mcpBaseUrl: 'https://my.alldone.app' })),
}))
jest.mock('firebase-functions/params', () => ({
    defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
}))
const mockExecuteToolNatively = jest.fn()
jest.mock('../Assistant/assistantHelper', () => ({ executeToolNatively: mockExecuteToolNatively }))

const BOOKING_TOOLS = ['get_public_booking_page', 'find_public_booking_times', 'book_public_meeting']
const BOOKING_URL = 'https://my.alldone.app/meet/karsten-wysk'

describe('booking-link tools on the connected Alldone MCP server', () => {
    let originalSetTimeout
    let AlldoneSimpleMCPServer

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
        ;({ AlldoneSimpleMCPServer } = require('./mcpServerSimple'))
    })
    afterAll(() => {
        global.setTimeout = originalSetTimeout
    })
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => console.error.mockRestore())

    const buildServer = ({
        access = { enabled: true, disabledTools: [], browserAgentEnabled: true },
        client = 'Claude',
    } = {}) => {
        const server = new AlldoneSimpleMCPServer()
        server.getAuthenticatedUserForClient = jest.fn().mockResolvedValue('user-1')
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        server.getUserMcpAccess = jest.fn().mockResolvedValue(access)
        server.getUserProjectList = jest.fn().mockResolvedValue([{ id: 'p1', name: 'Project 1' }])
        server.getUserDefaultProject = jest.fn().mockResolvedValue('p1')
        server.getMcpClientLabel = jest.fn(() => client)
        server.isBrowserAgentRequest = jest.fn(() => client === 'Browser agent')
        return server
    }
    const listTools = async server =>
        (await server.handleSingleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {})).result.tools
    const callTool = (server, name, args) =>
        server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
            {}
        )

    test('tools/list offers the three tools with the shared schemas (bookingUrl, explicit confirmation)', async () => {
        const tools = await listTools(buildServer())
        const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]))
        for (const name of BOOKING_TOOLS) {
            expect(byName[name]).toBeDefined()
            expect(byName[name].inputSchema.required).toContain('bookingUrl')
        }
        expect(byName.book_public_meeting.inputSchema.required).toEqual([
            'bookingUrl',
            'start',
            'end',
            'confirmedByUser',
        ])
        expect(byName.book_public_meeting.description).toMatch(/without the browser/)
        expect(byName.find_public_booking_times.description).toMatch(/OWN connected calendars/)
        expect(byName.find_public_booking_times.inputSchema.properties.matchMyCalendar.type).toBe('boolean')
        // The visitor's own calendar tool stays what it was: it knows the user, not the host.
        expect(byName.find_calendar_availability).toBeDefined()
        // Not to be confused with the anonymous per-page server's names.
        expect(byName.book_meeting).toBeUndefined()
    })

    test('a signed-in tab (window.alldone / WebMCP, "Browser agent") gets the same tools', async () => {
        const names = (await listTools(buildServer({ client: 'Browser agent' }))).map(tool => tool.name)
        expect(names).toEqual(expect.arrayContaining(BOOKING_TOOLS))
    })

    test.each(BOOKING_TOOLS)(
        'tools/call %s runs the shared tool as the user, assistant-less, on the MCP channel',
        async name => {
            mockExecuteToolNatively.mockResolvedValue({ success: true, marker: name })
            const args = {
                bookingUrl: BOOKING_URL,
                ...(name === 'book_public_meeting' ? { confirmedByUser: true } : {}),
            }
            const response = await callTool(buildServer({ client: 'Browser agent' }), name, args)
            expect(mockExecuteToolNatively).toHaveBeenCalledWith(
                name,
                args,
                'p1',
                null,
                'user-1',
                {},
                expect.objectContaining({ sourceChannel: 'mcp', mcpClient: 'Browser agent' })
            )
            expect(JSON.parse(response.result.content[0].text)).toEqual({ success: true, marker: name })
        }
    )

    test('booking can be switched off on its own under Settings → MCP while reading stays available', async () => {
        const server = buildServer({
            access: { enabled: true, disabledTools: ['book_public_meeting'], browserAgentEnabled: true },
        })
        const names = (await listTools(server)).map(tool => tool.name)
        expect(names).not.toContain('book_public_meeting')
        expect(names).toContain('find_public_booking_times')

        const blocked = await callTool(server, 'book_public_meeting', {
            bookingUrl: BOOKING_URL,
            confirmedByUser: true,
        })
        expect(blocked.result.isError).toBe(true)
        expect(JSON.parse(blocked.result.content[0].text).error).toMatch(/disabled/)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
    })

    test('a browser agent switched off gets neither the tools nor a call', async () => {
        const server = buildServer({
            client: 'Browser agent',
            access: { enabled: true, disabledTools: [], browserAgentEnabled: false },
        })
        expect(await listTools(server)).toEqual([])
        const blocked = await callTool(server, 'find_public_booking_times', { bookingUrl: BOOKING_URL })
        expect(blocked.result.isError).toBe(true)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
    })
})
