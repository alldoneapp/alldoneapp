'use strict'

jest.mock('./publicBooking', () => {
    const actual = jest.requireActual('./publicBooking')
    return {
        ...actual,
        getPublicBookingPageInfo: jest.fn(),
        findPublicSlots: jest.fn(),
        bookPublicMeeting: jest.fn(),
    }
})

jest.mock('./bookingSettings', () => ({
    ...jest.requireActual('./bookingSettings'),
    getHostingUrl: () => 'https://my.alldone.app',
}))

const publicBooking = require('./publicBooking')
const { PUBLIC_BOOKING_MCP_INSTRUCTIONS, buildTools, handlePublicBookingMcp } = require('./publicBookingMcp')

function createResponse() {
    return {
        headers: {},
        statusCode: null,
        body: undefined,
        set: jest.fn(function set(key, value) {
            this.headers[key] = value
            return this
        }),
        status: jest.fn(function status(code) {
            this.statusCode = code
            return this
        }),
        json: jest.fn(function json(payload) {
            this.body = payload
            return this
        }),
        send: jest.fn(function send(payload) {
            this.body = payload
            return this
        }),
    }
}

const rpc = async (body, { boundSlug = 'karsten-wysk', headers = {} } = {}) => {
    const res = createResponse()
    await handlePublicBookingMcp({ method: 'POST', body, headers: { 'x-forwarded-for': '5.6.7.8', ...headers } }, res, {
        boundSlug,
    })
    return res
}

const call = (name, args, options) =>
    rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, options)

describe('public booking MCP endpoint (AT-3161)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        publicBooking.getPublicBookingPageInfo.mockResolvedValue({
            status: 200,
            body: { success: true, page: { slug: 'karsten-wysk' } },
        })
        publicBooking.findPublicSlots.mockResolvedValue({
            status: 200,
            body: { success: true, timeZone: 'Europe/Berlin', options: [] },
        })
        publicBooking.bookPublicMeeting.mockResolvedValue({
            status: 200,
            body: { success: true, bookingId: 'b1', status: 'confirmed' },
        })
    })

    test('initialize negotiates the protocol and returns short instructions', async () => {
        const res = await rpc({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-ai' } },
        })

        expect(res.statusCode).toBe(200)
        expect(res.body.result.protocolVersion).toBe('2025-03-26')
        expect(res.body.result.capabilities).toEqual({ tools: { listChanged: false } })
        expect(res.body.result.serverInfo.name).toBe('alldone-public-booking')
        expect(res.body.result.instructions).toContain('https://my.alldone.app/meet/karsten-wysk')
        // Connected clients may truncate longer instructions.
        expect(res.body.result.instructions.length).toBeLessThanOrEqual(512)
        expect(PUBLIC_BOOKING_MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(512)
    })

    test('an unknown protocol version gets the default one', async () => {
        const res = await rpc({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '1999-01-01' },
        })
        expect(res.body.result.protocolVersion).toBe('2025-06-18')
    })

    test('notifications are accepted without a response body', async () => {
        const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
        expect(res.statusCode).toBe(202)
    })

    test('offers exactly the three public booking tools, and nothing of the signed-in MCP server', async () => {
        const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

        const tools = res.body.result.tools
        expect(tools.map(tool => tool.name)).toEqual(['get_booking_page', 'find_available_times', 'book_meeting'])
        // Bound to a page: the slug is implicit.
        tools.forEach(tool => expect(tool.inputSchema.properties).not.toHaveProperty('slug'))
        expect(tools.find(tool => tool.name === 'book_meeting').inputSchema.required).toEqual([
            'start',
            'end',
            'visitorName',
            'visitorEmail',
        ])
        expect(tools.find(tool => tool.name === 'book_meeting').annotations.readOnlyHint).toBe(false)
        expect(tools.find(tool => tool.name === 'find_available_times').annotations.readOnlyHint).toBe(true)
    })

    test('the generic endpoint requires the slug in every tool', () => {
        buildTools({ boundSlug: '' }).forEach(tool => expect(tool.inputSchema.required).toContain('slug'))
    })

    test('find_available_times runs the shared operation with the caller IP', async () => {
        const res = await call('find_available_times', {
            start: '2030-06-18T00:00:00+02:00',
            end: '2030-06-19T00:00:00+02:00',
            timeZone: 'Asia/Tokyo',
        })

        expect(publicBooking.findPublicSlots).toHaveBeenCalledWith({
            slug: 'karsten-wysk',
            start: '2030-06-18T00:00:00+02:00',
            end: '2030-06-19T00:00:00+02:00',
            timeZone: 'Asia/Tokyo',
            durationMinutes: undefined,
            ip: '5.6.7.8',
        })
        expect(res.body.result.isError).toBe(false)
        expect(JSON.parse(res.body.result.content[0].text)).toEqual(res.body.result.structuredContent)
    })

    test('book_meeting is labelled as an MCP booking, or a browser-agent one from the page bridge', async () => {
        const args = {
            start: '2030-06-18T09:00:00+02:00',
            end: '2030-06-18T09:30:00+02:00',
            visitorName: 'Ada',
            visitorEmail: 'ada@example.com',
            idempotencyKey: 'agent-key-123',
        }
        await call('book_meeting', args)
        expect(publicBooking.bookPublicMeeting).toHaveBeenLastCalledWith(
            expect.objectContaining({ ...args, slug: 'karsten-wysk', bookedVia: 'mcp', ip: '5.6.7.8' })
        )

        await call('book_meeting', args, { headers: { 'x-alldone-mcp-client': 'alldone-browser-agent' } })
        expect(publicBooking.bookPublicMeeting).toHaveBeenLastCalledWith(
            expect.objectContaining({ bookedVia: 'browser_agent' })
        )
    })

    test('a failed operation is a tool error with its code, not a protocol error', async () => {
        publicBooking.bookPublicMeeting.mockResolvedValue({
            status: 409,
            body: { success: false, code: 'slot_unavailable', error: 'This slot is no longer available.' },
        })

        const res = await call('book_meeting', {
            start: 'x',
            end: 'y',
            visitorName: 'Ada',
            visitorEmail: 'ada@example.com',
        })

        expect(res.statusCode).toBe(200)
        expect(res.body.result.isError).toBe(true)
        expect(res.body.result.structuredContent.code).toBe('slot_unavailable')
    })

    test('an endpoint bound to one page refuses calls for another page', async () => {
        const res = await call('get_booking_page', { slug: 'someone-else' })

        expect(res.body.result.isError).toBe(true)
        expect(res.body.result.structuredContent.code).toBe('invalid_request')
        expect(publicBooking.getPublicBookingPageInfo).not.toHaveBeenCalled()
    })

    test('the generic endpoint refuses a tool call without slug', async () => {
        const res = await call('get_booking_page', {}, { boundSlug: '' })

        expect(res.body.result.isError).toBe(true)
        expect(publicBooking.getPublicBookingPageInfo).not.toHaveBeenCalled()
    })

    test('unknown tools and methods are JSON-RPC errors', async () => {
        const unknownTool = await call('get_tasks', {})
        expect(unknownTool.body.error.code).toBe(-32602)

        const unknownMethod = await rpc({ jsonrpc: '2.0', id: 3, method: 'sampling/createMessage' })
        expect(unknownMethod.body.error.code).toBe(-32601)
    })

    test('malformed JSON is a parse error', async () => {
        const res = await rpc('{not json')
        expect(res.statusCode).toBe(400)
        expect(res.body.error.code).toBe(-32700)
    })

    test('a GET describes the endpoint, a GET for an event stream is refused', async () => {
        const discovery = createResponse()
        await handlePublicBookingMcp({ method: 'GET', headers: { accept: 'application/json' } }, discovery, {
            boundSlug: 'karsten-wysk',
        })
        expect(discovery.statusCode).toBe(200)
        expect(discovery.body).toEqual(
            expect.objectContaining({
                authentication: 'none',
                bookingPage: 'https://my.alldone.app/meet/karsten-wysk',
                tools: ['get_booking_page', 'find_available_times', 'book_meeting'],
                docs: 'https://my.alldone.app/meet/karsten-wysk/llms.txt',
            })
        )

        const stream = createResponse()
        await handlePublicBookingMcp({ method: 'GET', headers: { accept: 'text/event-stream' } }, stream, {
            boundSlug: 'karsten-wysk',
        })
        expect(stream.statusCode).toBe(405)
    })

    test('the bookingApi function routes /api/booking/mcp/<slug> here', async () => {
        const res = createResponse()
        await publicBooking.bookingApiHandler(
            {
                method: 'POST',
                path: '/api/booking/mcp/karsten-wysk',
                url: '/api/booking/mcp/karsten-wysk',
                headers: {},
                body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            },
            res
        )

        expect(res.statusCode).toBe(200)
        expect(res.body.result.tools).toHaveLength(3)
        expect(res.headers['Access-Control-Allow-Headers']).toContain('Mcp-Protocol-Version')
    })
})
