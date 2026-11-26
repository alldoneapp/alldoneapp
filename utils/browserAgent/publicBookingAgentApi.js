/**
 * Browser agents on a public booking page (AT-3161).
 *
 * On https://my.alldone.app/meet/<slug> anybody's agent (Claude in Chrome, ChatGPT agent, Gemini in
 * Chrome, Comet, …) can find free times and book, without an Alldone account. The surfaces are the
 * ones the signed-in app uses (AT-2871/AT-2890): `window.alldone` (enumerable, help(), listTools(),
 * callTool(), tools.<name>()), WebMCP where the browser has it, the JSON manifest, the <html> data
 * attributes and one console line, all in state `public_booking`.
 *
 * Like the signed-in bridge it has no tools of its own: it is an anonymous MCP client of the public
 * booking MCP endpoint (`/api/booking/mcp/<slug>`, functions/Booking/publicBookingMcp.js), which runs
 * the same server-side operations as the page's own form. No Firebase token is ever read or sent,
 * so a signed-in visitor's session cannot reach this endpoint through it.
 */

import {
    AGENT_API_STATES,
    BROWSER_AGENT_API_VERSION,
    BROWSER_AGENT_READY_EVENT,
    WINDOW_API_NAME,
    createMcpSessionClient,
    installBrowserAgentApi,
} from './browserAgentApi'

export const PUBLIC_BOOKING_TOOL_NAMES = ['get_booking_page', 'find_available_times', 'book_meeting']

const encodeSlug = slug => encodeURIComponent(String(slug || '').trim())

export const getPublicBookingMcpPath = slug => `/api/booking/mcp/${encodeSlug(slug)}`
export const getPublicBookingDocsPath = slug => `/meet/${encodeSlug(slug)}/llms.txt`

// An agent already connected to Alldone (MCP connector, `window.alldone` in a signed-in tab, an Alldone
// assistant) books from its own tool list, with the user's details and calendar (AT-3161 follow-up).
export const CONNECTED_ALLDONE_AGENT_HINT =
    'Already connected to Alldone as a signed-in user? Then you need no browser: call get_public_booking_page, find_public_booking_times and book_public_meeting from your Alldone tools with bookingUrl set to this page.'

export const buildPublicBookingInstructions = ({ slug, webMcpSupported, toolNames } = {}) =>
    [
        'Alldone booking page API (window.alldone, state: public_booking). No sign-in needed; it can only read free times of this page and book them.',
        "await alldone.callTool('get_booking_page', {})  -> host, durations, host timezone, rules",
        "await alldone.callTool('find_available_times', { start: '2026-12-01T00:00:00+01:00', end: '2026-12-08T00:00:00+01:00', durationMinutes: 30, timeZone: 'Europe/London' })",
        "await alldone.callTool('book_meeting', { start, end, durationMinutes, visitorName, visitorEmail, note, timeZone, idempotencyKey })",
        'Pass start/end exactly as find_available_times returned them. Book only after the person you act for confirmed the time, their name and email; booking is immediate and emails a confirmation.',
        'Use a unique idempotencyKey per booking and reuse it when retrying. Errors throw AlldoneToolError; error.data.code says why (slot_unavailable: search again).',
        Array.isArray(toolNames) && toolNames.length ? `Tools: ${toolNames.join(', ')}` : '',
        webMcpSupported
            ? 'The same tools are also registered with WebMCP (document.modelContext).'
            : 'WebMCP (document.modelContext) is not available in this browser; use window.alldone.',
        `MCP server for agents outside the browser: ${getPublicBookingMcpPath(slug)} (no authentication).`,
        CONNECTED_ALLDONE_AGENT_HINT,
        `Docs: ${getPublicBookingDocsPath(slug)}`,
    ]
        .filter(Boolean)
        .join('\n')

export const buildPublicBookingManifest = ({ slug, state, webMcpSupported = false, webMcpRegistered = 0 } = {}) => ({
    name: 'Alldone booking page agent API',
    version: BROWSER_AGENT_API_VERSION,
    state: state || AGENT_API_STATES.PUBLIC_BOOKING,
    javascript: `window.${WINDOW_API_NAME}`,
    usage: [
        'alldone.help()',
        "await alldone.callTool('get_booking_page', {})",
        "await alldone.callTool('find_available_times', { start, end })",
    ],
    tools: PUBLIC_BOOKING_TOOL_NAMES,
    authentication: 'none',
    mcpServer: getPublicBookingMcpPath(slug),
    readyEvent: BROWSER_AGENT_READY_EVENT,
    webMcp: { available: !!webMcpSupported, registeredTools: webMcpRegistered || 0 },
    docs: getPublicBookingDocsPath(slug),
})

/**
 * Installs the booking tools for `slug`. Resolves to a dispose function that removes only what this
 * call installed. `origin` is the page origin; the hosting rewrite (and the dev proxy) route
 * /api/booking/** to the bookingApi function.
 */
export const installPublicBookingAgentApi = ({ win, slug, origin, fetchImpl, onError, signal }) => {
    const client = createMcpSessionClient({
        endpoint: `${origin || ''}${getPublicBookingMcpPath(slug)}`,
        anonymous: true,
        fetchImpl,
    })
    return installBrowserAgentApi({
        win,
        client,
        onError,
        signal,
        windowApiOptions: {
            state: AGENT_API_STATES.PUBLIC_BOOKING,
            docs: getPublicBookingDocsPath(slug),
            buildInstructions: status => buildPublicBookingInstructions({ ...status, slug }),
            buildManifest: status => buildPublicBookingManifest({ ...status, slug }),
        },
        announcement: ({ webMcpRegistered }) =>
            `[Alldone] Booking page agent API ready: window.alldone (no sign-in) — run alldone.help(), then find_available_times and book_meeting. ${
                webMcpRegistered
                    ? `${webMcpRegistered} tools are also registered with WebMCP (document.modelContext).`
                    : 'WebMCP is not available in this browser.'
            } Docs: ${getPublicBookingDocsPath(slug)}`,
    })
}
