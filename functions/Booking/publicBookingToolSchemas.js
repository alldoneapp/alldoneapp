'use strict'

// AT-3161 follow-up: the public booking pages (/meet/<slug>) as tools of the CONNECTED Alldone
// surfaces: the signed-in MCP server (/mcpServer), `window.alldone` / WebMCP in a signed-in tab
// (which proxy that server) and in-app assistants. Before, those tools existed only on the
// anonymous per-page endpoint (/api/booking/mcp/<slug>, publicBookingMcp.js); an agent connected
// to Alldone found find_calendar_availability for its own user but nothing for somebody else's
// booking link, and fell back to clicking the page with browser tools.
//
// Names, the one Tools Access key and the OpenAI schemas. Dependency-free like
// Artifacts/artifactToolSchemas.js, so the schema list, the execution gate and the executor read the
// same names. The numbers below mirror bookingSettings.js (MAX_BOOKING_RANGE_DAYS,
// MAX_PUBLIC_SLOT_OPTIONS); publicBookingTools.test.js pins them.

const PUBLIC_BOOKING_TOOL_KEY = 'public_booking'

const GET_PUBLIC_BOOKING_PAGE = 'get_public_booking_page'
const FIND_PUBLIC_BOOKING_TIMES = 'find_public_booking_times'
const BOOK_PUBLIC_MEETING = 'book_public_meeting'

const PUBLIC_BOOKING_TOOL_NAMES = [GET_PUBLIC_BOOKING_PAGE, FIND_PUBLIC_BOOKING_TIMES, BOOK_PUBLIC_MEETING]
const PUBLIC_BOOKING_TOOL_NAME_SET = new Set(PUBLIC_BOOKING_TOOL_NAMES)

const MAX_RANGE_DAYS = 31
const MAX_HOST_OPTIONS = 96

const isPublicBookingToolName = toolName => PUBLIC_BOOKING_TOOL_NAME_SET.has(toolName)

const bookingUrlProperty = {
    type: 'string',
    description:
        'The Alldone booking link of the HOST, e.g. https://my.alldone.app/meet/karsten-wysk (or just its slug, ' +
        'karsten-wysk). Use the link exactly as the user gave it.',
}

const PUBLIC_BOOKING_TOOL_SCHEMAS = {
    [GET_PUBLIC_BOOKING_PAGE]: {
        type: 'function',
        function: {
            name: GET_PUBLIC_BOOKING_PAGE,
            description:
                "Read someone else's public Alldone booking link (/meet/<slug>): the host's name, the meeting " +
                "durations offered, the host's timezone, working hours, weekend/same-day rules and request limits. " +
                'Also says which name, email and timezone book_public_meeting would use for the user and whether ' +
                "the user's own calendar is connected. Use this instead of opening the booking page in a browser.",
            parameters: {
                type: 'object',
                properties: { bookingUrl: bookingUrlProperty },
                required: ['bookingUrl'],
            },
        },
    },
    [FIND_PUBLIC_BOOKING_TIMES]: {
        type: 'function',
        function: {
            name: FIND_PUBLIC_BOOKING_TIMES,
            description:
                "Free slots on someone else's Alldone booking link (/meet/<slug>), the same slots the page offers " +
                "(host's working hours, buffers, minimum free time, same-day rule). By default each slot is also " +
                "checked against the user's OWN connected calendars, so only times free for both are returned " +
                "(visitorCalendar.checked says whether that happened; it never reveals the host's events). Times are " +
                `in the host's timezone with displayStart/displayEnd in the user's. At most ${MAX_RANGE_DAYS} days ` +
                'per request; if truncated, search again from nextSearchStart. Use this instead of ' +
                'find_calendar_availability, which only knows the user, not the host.',
            parameters: {
                type: 'object',
                properties: {
                    bookingUrl: bookingUrlProperty,
                    start: {
                        type: 'string',
                        description:
                            'Optional range start, ISO 8601 with offset (e.g. 2026-12-01T00:00:00+01:00). Defaults to now.',
                    },
                    end: {
                        type: 'string',
                        description: `Optional range end, ISO 8601 with offset. Defaults to 7 days after start; at most ${MAX_RANGE_DAYS} days after it.`,
                    },
                    durationMinutes: {
                        type: 'integer',
                        description:
                            'Optional meeting length; must be one of the durations of get_public_booking_page. Defaults to the page default.',
                    },
                    timeZone: {
                        type: 'string',
                        description:
                            "Optional IANA timezone for displayStart/displayEnd. Defaults to the user's timezone.",
                    },
                    matchMyCalendar: {
                        type: 'boolean',
                        description:
                            "Optional. Default true: drop slots where the user's own connected calendars are busy. Pass false only to see all of the host's free slots.",
                    },
                },
                required: ['bookingUrl'],
            },
        },
    },
    [BOOK_PUBLIC_MEETING]: {
        type: 'function',
        function: {
            name: BOOK_PUBLIC_MEETING,
            description:
                "Book a slot on someone else's Alldone booking link (/meet/<slug>) for the user, directly, without the " +
                'browser. It creates the event in the host calendar with a join link and emails a confirmation to the ' +
                'visitor and a notification to the host, so FIRST show the user the exact time (in their timezone), ' +
                'the duration and the name/email it will use, and call this only after they explicitly confirmed; then ' +
                'pass confirmedByUser: true. Pass start/end exactly as find_public_booking_times returned them. ' +
                'Name, email and timezone default to the signed-in user. A slot taken meanwhile returns ' +
                'code slot_unavailable: search again.',
            parameters: {
                type: 'object',
                properties: {
                    bookingUrl: bookingUrlProperty,
                    start: {
                        type: 'string',
                        description: 'Slot start exactly as find_public_booking_times returned it.',
                    },
                    end: { type: 'string', description: 'Slot end exactly as find_public_booking_times returned it.' },
                    durationMinutes: {
                        type: 'integer',
                        description: 'The duration the slot was searched with.',
                    },
                    confirmedByUser: {
                        type: 'boolean',
                        description:
                            'Must be true, and only after the user explicitly confirmed this exact slot in the conversation.',
                    },
                    visitorName: {
                        type: 'string',
                        description: "Optional. Who the meeting is for. Defaults to the user's Alldone name.",
                    },
                    visitorEmail: {
                        type: 'string',
                        description:
                            "Optional. Where the invitation and confirmation go. Defaults to the user's Alldone email.",
                    },
                    timeZone: {
                        type: 'string',
                        description: "Optional IANA timezone for the confirmation email. Defaults to the user's.",
                    },
                    note: { type: 'string', description: 'Optional message to the host (max 2000 characters).' },
                    idempotencyKey: {
                        type: 'string',
                        description:
                            'Optional key (8-200 chars of A-Z a-z 0-9 . _ : -). A retry with the same key returns the first booking. Defaults to one derived from user, page, slot and email.',
                    },
                },
                required: ['bookingUrl', 'start', 'end', 'confirmedByUser'],
            },
        },
    },
}

module.exports = {
    BOOK_PUBLIC_MEETING,
    FIND_PUBLIC_BOOKING_TIMES,
    GET_PUBLIC_BOOKING_PAGE,
    MAX_HOST_OPTIONS,
    MAX_RANGE_DAYS,
    PUBLIC_BOOKING_TOOL_KEY,
    PUBLIC_BOOKING_TOOL_NAMES,
    PUBLIC_BOOKING_TOOL_SCHEMAS,
    isPublicBookingToolName,
}
