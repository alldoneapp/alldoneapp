'use strict'

// AT-3161: a public MCP endpoint for Alldone booking pages, so anybody can point an AI agent at
// https://my.alldone.app/meet/<slug> and let it find times and book.
//
//   POST /api/booking/mcp/<slug>   tools bound to one booking page (what the page advertises)
//   POST /api/booking/mcp          the same tools for any page, `slug` required in every call
//
// It is deliberately NOT the authenticated /mcpServer: that one acts as a signed-in Alldone user,
// with that user's projects and data. This endpoint has no identity at all and exactly three tools,
// which run the same operations as the public web page (publicBooking.js): same validation, same
// rate limits, same double-booking lock, free slots only and never calendar contents. Stateless
// Streamable HTTP: every POST is answered with plain JSON, no session id, no SSE stream.

const {
    BOOKED_VIA,
    bookPublicMeeting,
    findPublicSlots,
    getBookingUrl,
    getPublicBookingPageInfo,
} = require('./publicBooking')
const { MAX_BOOKING_RANGE_DAYS, MAX_PUBLIC_SLOT_OPTIONS, slugify } = require('./bookingSettings')
const { getClientIp } = require('./bookingRateLimit')

const SERVER_INFO = { name: 'alldone-public-booking', title: 'Alldone meeting booking', version: '1.0.0' }
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const BROWSER_AGENT_CLIENT_NAME = 'alldone-browser-agent'

// Connected clients may truncate longer text (see mcpAgentInstructions.js); keep it under 512.
const PUBLIC_BOOKING_MCP_INSTRUCTIONS =
    'Public meeting booking for one Alldone user; no sign-in. 1) get_booking_page: host, durations, timezone. ' +
    `2) find_available_times for a range (max ${MAX_BOOKING_RANGE_DAYS} days). ` +
    '3) Only after the person you act for confirmed a slot and gave name and email: book_meeting with start/end ' +
    'exactly as returned and a unique idempotencyKey (reuse it on retries). Booking is immediate and emails a ' +
    'confirmation. Only free slots are shown, never calendar contents.'

const slugProperty = {
    type: 'string',
    description: 'Booking page slug: the part after /meet/ in the booking URL.',
}

const isoProperty = description => ({ type: 'string', format: 'date-time', description })

function buildTools({ boundSlug }) {
    const withSlug = (properties, required) => ({
        type: 'object',
        properties: boundSlug ? properties : { slug: slugProperty, ...properties },
        required: boundSlug ? required : ['slug', ...required],
        additionalProperties: false,
    })
    return [
        {
            name: 'get_booking_page',
            title: 'Get booking page',
            description:
                "The booking page's host (display name, photo), the meeting durations it offers, the host's " +
                'timezone, working hours, weekend and same-day rules, and request limits.',
            inputSchema: withSlug({}, []),
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        {
            name: 'find_available_times',
            title: 'Find available times',
            description:
                'Free meeting slots in a time range. Returns options [{ start, end }] in the host timezone (ISO 8601 ' +
                'with offset; displayStart/displayEnd in timeZone when given). ' +
                `At most ${MAX_BOOKING_RANGE_DAYS} days per request and ${MAX_PUBLIC_SLOT_OPTIONS} options; ` +
                'when truncated is true, search again from nextSearchStart. Availability can change at any time; ' +
                'book_meeting re-checks it.',
            inputSchema: withSlug(
                {
                    start: isoProperty('Range start, ISO 8601 with offset, e.g. 2026-12-01T00:00:00+01:00.'),
                    end: isoProperty('Range end, ISO 8601 with offset. Must be after start.'),
                    timeZone: {
                        type: 'string',
                        description:
                            'Optional IANA timezone of the person you act for (e.g. America/New_York), for display.',
                    },
                    durationMinutes: {
                        type: 'integer',
                        description: 'One of the durations from get_booking_page. Defaults to the page default.',
                    },
                },
                ['start', 'end']
            ),
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        {
            name: 'book_meeting',
            title: 'Book a meeting',
            description:
                'Books a free slot immediately: creates the calendar event with a join link and emails a ' +
                'confirmation to visitorEmail and a notification to the host. Call it only after the person you act ' +
                'for confirmed the time, their name and email. Pass start and end exactly as find_available_times ' +
                'returned them. A slot taken in the meantime returns code slot_unavailable: search again.',
            inputSchema: withSlug(
                {
                    start: isoProperty('Slot start exactly as returned by find_available_times.'),
                    end: isoProperty('Slot end exactly as returned by find_available_times.'),
                    durationMinutes: {
                        type: 'integer',
                        description: 'The duration the slot was searched with.',
                    },
                    visitorName: { type: 'string', description: 'Name of the person the meeting is for.' },
                    visitorEmail: {
                        type: 'string',
                        format: 'email',
                        description: 'Email of that person. The invitation and confirmation go there.',
                    },
                    note: { type: 'string', description: 'Optional message to the host (max 2000 characters).' },
                    timeZone: {
                        type: 'string',
                        description: "Optional IANA timezone for the visitor's confirmation email.",
                    },
                    idempotencyKey: {
                        type: 'string',
                        description:
                            'A unique random string (8-200 chars) per intended booking. Retrying with the same key ' +
                            'returns the first result instead of booking twice.',
                    },
                },
                ['start', 'end', 'visitorName', 'visitorEmail']
            ),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
    ]
}

class ToolInputError extends Error {}

function resolveSlug(args, boundSlug) {
    const requested = slugify(args?.slug)
    if (boundSlug) {
        if (requested && requested !== slugify(boundSlug)) {
            throw new ToolInputError(
                `This endpoint serves the booking page "${boundSlug}" only. Use /api/booking/mcp/${requested} for another page.`
            )
        }
        return slugify(boundSlug)
    }
    if (!requested) throw new ToolInputError('slug is required: the part after /meet/ in the booking URL.')
    return requested
}

async function runTool(name, args, { boundSlug, ip, bookedVia }) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    const slug = resolveSlug(input, boundSlug)
    if (name === 'get_booking_page') return getPublicBookingPageInfo(slug)
    if (name === 'find_available_times') {
        return findPublicSlots({
            slug,
            start: input.start,
            end: input.end,
            timeZone: input.timeZone,
            durationMinutes: input.durationMinutes,
            ip,
        })
    }
    if (name === 'book_meeting') {
        return bookPublicMeeting({
            slug,
            start: input.start,
            end: input.end,
            timeZone: input.timeZone,
            durationMinutes: input.durationMinutes,
            visitorName: input.visitorName,
            visitorEmail: input.visitorEmail,
            note: input.note,
            idempotencyKey: input.idempotencyKey,
            ip,
            bookedVia,
        })
    }
    return null
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message, data) => ({
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
})

function negotiateProtocolVersion(requested) {
    return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
}

function buildInstructions(boundSlug) {
    return boundSlug
        ? `${PUBLIC_BOOKING_MCP_INSTRUCTIONS} Page: ${getBookingUrl(slugify(boundSlug))}`
        : `${PUBLIC_BOOKING_MCP_INSTRUCTIONS} Pass slug (the part after /meet/) to every tool.`
}

async function handleMessage(message, context) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return rpcError(message?.id, -32600, 'Invalid Request')
    }
    const { id, method, params } = message
    // Notifications (no id) get no response.
    if (id === undefined || id === null) return null

    switch (method) {
        case 'initialize':
            return rpcResult(id, {
                protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions: buildInstructions(context.boundSlug),
            })
        case 'ping':
            return rpcResult(id, {})
        case 'tools/list':
            return rpcResult(id, { tools: buildTools(context) })
        case 'resources/list':
            return rpcResult(id, { resources: [] })
        case 'resources/templates/list':
            return rpcResult(id, { resourceTemplates: [] })
        case 'prompts/list':
            return rpcResult(id, { prompts: [] })
        case 'tools/call': {
            const name = params?.name
            let outcome
            try {
                outcome = await runTool(name, params?.arguments, context)
            } catch (error) {
                if (!(error instanceof ToolInputError)) throw error
                outcome = { status: 400, body: { success: false, code: 'invalid_request', error: error.message } }
            }
            if (!outcome) return rpcError(id, -32602, `Unknown tool: ${name}`)
            const body = outcome.body || {}
            return rpcResult(id, {
                content: [{ type: 'text', text: JSON.stringify(body) }],
                structuredContent: body,
                isError: body.success === false,
            })
        }
        default:
            return rpcError(id, -32601, `Method not found: ${method}`)
    }
}

function buildDiscovery(boundSlug) {
    const slug = boundSlug ? slugify(boundSlug) : ''
    return {
        name: SERVER_INFO.title,
        description: 'Public MCP server for an Alldone meeting booking page. No sign-in needed.',
        transport: 'streamable-http (POST JSON-RPC 2.0, stateless, JSON responses)',
        authentication: 'none',
        ...(slug ? { bookingPage: getBookingUrl(slug) } : {}),
        tools: buildTools({ boundSlug }).map(tool => tool.name),
        instructions: buildInstructions(boundSlug),
        ...(slug ? { docs: `${getBookingUrl(slug)}/llms.txt` } : {}),
    }
}

function parseBody(req) {
    if (req.body && typeof req.body === 'object') return req.body
    if (typeof req.body === 'string' && req.body.trim()) {
        try {
            return JSON.parse(req.body)
        } catch (_) {
            return undefined
        }
    }
    if (Buffer.isBuffer(req.rawBody)) {
        try {
            return JSON.parse(req.rawBody.toString('utf8'))
        } catch (_) {
            return undefined
        }
    }
    return undefined
}

async function handlePublicBookingMcp(req, res, { boundSlug = '' } = {}) {
    if (req.method === 'GET') {
        // A GET with Accept: text/event-stream asks for a server-to-client stream, which a stateless
        // server does not offer (the spec's answer is 405). Anything else is a person or an agent
        // looking at the URL: tell them what this is.
        const accept = String(req.headers?.accept || '')
        if (accept.includes('text/event-stream')) {
            res.status(405).set('Allow', 'POST').send('')
            return
        }
        res.status(200).json(buildDiscovery(boundSlug))
        return
    }
    if (req.method !== 'POST') {
        res.status(405).set('Allow', 'GET, POST').send('')
        return
    }

    const payload = parseBody(req)
    if (payload === undefined) {
        res.status(400).json(rpcError(null, -32700, 'Parse error'))
        return
    }
    const clientHeader = String(req.headers?.['x-alldone-mcp-client'] || '').trim()
    const context = {
        boundSlug,
        ip: getClientIp(req),
        bookedVia: clientHeader === BROWSER_AGENT_CLIENT_NAME ? BOOKED_VIA.BROWSER_AGENT : BOOKED_VIA.MCP,
    }

    if (Array.isArray(payload)) {
        if (payload.length === 0) {
            res.status(400).json(rpcError(null, -32600, 'Invalid Request'))
            return
        }
        // JSON-RPC batches (protocol 2025-03-26) are capped at 10 messages; every tool call in one
        // still spends its own rate-limit quota.
        const responses = []
        for (const message of payload.slice(0, 10)) {
            const response = await handleMessage(message, context)
            if (response) responses.push(response)
        }
        if (responses.length === 0) res.status(202).send('')
        else res.status(200).json(responses)
        return
    }

    const response = await handleMessage(payload, context)
    if (!response) {
        res.status(202).send('')
        return
    }
    res.status(200).json(response)
}

module.exports = {
    PUBLIC_BOOKING_MCP_INSTRUCTIONS,
    SUPPORTED_PROTOCOL_VERSIONS,
    buildTools,
    handlePublicBookingMcp,
}
