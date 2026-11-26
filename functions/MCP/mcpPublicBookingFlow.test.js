'use strict'

// AT-3161 follow-up: an agent books someone else's booking link END TO END WITH TOOLS ONLY, through the
// two real entry points a connected agent uses:
//   - an MCP client (Codex, ChatGPT, Claude) sending JSON-RPC to the Alldone MCP server, and
//   - `window.alldone` in a signed-in tab: the web bridge's own JSON-RPC client
//     (utils/browserAgent/browserAgentApi.js, createMcpSessionClient) talking to the same server.
// Below the server everything is real: AlldoneSimpleMCPServer.handleSingleJsonRpc -> per-user MCP
// switches -> executeDelegatedAssistantTool -> executeToolNatively (assistantHelper) ->
// publicBookingTools -> publicBooking (page rules, availability engine, host lock, idempotency) on a
// fake Firestore. Only the outside world is stubbed: OAuth identity (the signed-in user is given),
// the Google Calendar API (busy timings), creating the host's calendar event, the two mails, and the
// browser worker (it must never be reached while booking).
//
// The "agent" is a script that follows the copied prompt; the "user" is a scripted reply. So this pins
// what the tools and the server do for a well-behaved agent, and what the server refuses no matter what
// the agent does. It is NOT a test of a real model or a real client (ChatGPT, Codex, Claude): whether a
// given client refreshes its tool list, honours annotations or follows the prompt is outside it.

jest.mock('firebase-admin', () => {
    const firestore = jest.fn()
    firestore.FieldValue = { serverTimestamp: jest.fn(() => 'now') }
    return { firestore, app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })) }
})
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: jest.fn(() => 'now') } }))
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
jest.mock('googleapis', () => ({ google: { calendar: jest.fn() } }))
jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({ getAuthorizedOAuth2Client: jest.fn() }))
jest.mock('../Calendar/providers/microsoftCalendarProvider', () => ({
    ...jest.requireActual('../Calendar/providers/microsoftCalendarProvider'),
    getConnectedMicrosoftCalendarAccounts: jest.fn(async () => []),
    getMicrosoftCalendarBusyIntervalsForAssistantRequest: jest.fn(async () => ({
        busyIntervals: [],
        searchedCalendarCount: 0,
        failedCalendarCount: 0,
    })),
}))
jest.mock('../GoogleCalendar/assistantCalendarTools', () => ({
    ...jest.requireActual('../GoogleCalendar/assistantCalendarTools'),
    createCalendarEventForAssistantRequest: jest.fn(),
}))
jest.mock('../Booking/bookingEmails', () => ({
    sendBookingNotificationToHost: jest.fn().mockResolvedValue(undefined),
    sendBookingConfirmationToVisitor: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../Assistant/browser/browserSession', () => ({ executeBrowserTool: jest.fn() }))

const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { google } = require('googleapis')
const { getAuthorizedOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const bookingEmails = require('../Booking/bookingEmails')
const { executeBrowserTool } = require('../Assistant/browser/browserSession')
const { createFakeFirestore } = require('../Tests/fakeFirestore')
const {
    BROWSER_AGENT_CLIENT_HEADER,
    BROWSER_AGENT_CLIENT_NAME,
    createMcpSessionClient,
    getToolAnnotations,
} = require('../../utils/browserAgent/browserAgentApi')

const BOOKING_URL = 'https://my.alldone.app/meet/karsten-wysk'
const BOOKING_TOOLS = ['get_public_booking_page', 'find_public_booking_times', 'book_public_meeting']
const DAY_START = '2030-06-18T00:00:00+02:00' // a Tuesday, far in the future
const DAY_END = '2030-06-19T00:00:00+02:00'

const calendarConnection = email => ({
    defaultProjectId: 'p1',
    projectIds: ['p1'],
    apisConnected: { p1: { calendar: true, calendarEmail: email } },
})
const busyEvent = (start, end, summary) => ({
    start: { dateTime: start },
    end: { dateTime: end },
    status: 'confirmed',
    summary,
    attendees: [{ email: 'secret@example.com' }],
})

describe('booking a public booking link end to end with tools only (MCP and window.alldone)', () => {
    let originalSetTimeout
    let AlldoneSimpleMCPServer
    let db
    let eventsByUser
    let eventCount

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        // The server schedules its cleanup timers at construction; the flow needs none of them.
        global.setTimeout = jest.fn(() => 0)
        ;({ AlldoneSimpleMCPServer } = require('./mcpServerSimple'))
        global.setTimeout = originalSetTimeout
    })

    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'info').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
        db = createFakeFirestore({
            'bookingPages/karsten-wysk': {
                enabled: true,
                userId: 'host-1',
                profile: { displayName: 'Karsten Wysk' },
                settings: {
                    durationMinutes: 30,
                    availableDurations: [15, 30, 60],
                    workingHoursStart: '09:00',
                    workingHoursEnd: '17:00',
                    includeWeekends: false,
                    timeZone: 'Europe/Berlin',
                    minFreeHoursPerDay: 0,
                },
            },
            'users/host-1': { displayName: 'Karsten Wysk', ...calendarConnection('host@example.com') },
            'users/visitor-1': {
                displayName: 'Mia Visitor',
                email: 'mia@example.com',
                timezone: 'Europe/London',
                ...calendarConnection('mia@example.com'),
            },
            'users/visitor-2': { displayName: 'Ben Other', email: 'ben@example.com', timezone: 'Europe/Berlin' },
        })
        admin.firestore.mockReturnValue(db)

        // Host busy 09:00-10:00 Berlin; visitor busy 10:00-11:00 Berlin. Free for both: 11:00 onwards.
        eventsByUser = {
            'host-1': [busyEvent('2030-06-18T09:00:00+02:00', '2030-06-18T10:00:00+02:00', 'Secret board meeting')],
            'visitor-1': [busyEvent('2030-06-18T10:00:00+02:00', '2030-06-18T11:00:00+02:00', 'Private doctor')],
        }
        getAuthorizedOAuth2Client.mockImplementation(async userId => ({ __userId: userId }))
        google.calendar.mockImplementation(({ auth }) => ({
            events: {
                list: jest.fn(async () => ({ data: { items: eventsByUser[auth.__userId] || [] } })),
            },
        }))
        eventCount = 0
        createCalendarEventForAssistantRequest.mockImplementation(async () => {
            eventCount += 1
            return {
                success: true,
                provider: 'google',
                calendarId: 'primary',
                event: { eventId: `evt-${eventCount}`, htmlLink: 'https://calendar.example/evt' },
                joinUrl: 'https://meet.example/abc',
                joinProvider: 'google_meet',
            }
        })
    })

    afterEach(() => jest.restoreAllMocks())

    // The server as deployed, with identity resolved (OAuth is not what this test is about).
    const buildServer = ({ userId = 'visitor-1', client = 'Codex' } = {}) => {
        // The constructor schedules cleanup timers against the real Firestore; the flow needs none.
        const realSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
        let server
        try {
            server = new AlldoneSimpleMCPServer()
        } finally {
            global.setTimeout = realSetTimeout
        }
        const isBrowserTab = req =>
            String(req?.headers?.[BROWSER_AGENT_CLIENT_HEADER.toLowerCase()] || '') === BROWSER_AGENT_CLIENT_NAME
        server.getAuthenticatedUserForClient = jest.fn().mockResolvedValue(userId)
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        server.getUserProjectList = jest.fn().mockResolvedValue([{ id: 'p1', name: 'Project 1' }])
        server.getUserDefaultProject = jest.fn().mockResolvedValue('p1')
        server.isBrowserAgentRequest = jest.fn(isBrowserTab)
        server.getMcpClientLabel = jest.fn(req => (isBrowserTab(req) ? 'Browser agent' : client))
        return server
    }

    // An MCP client: JSON-RPC straight to the server, the way Codex / ChatGPT / Claude call it.
    const mcpClient = server => {
        let id = 0
        const rpc = async (method, params) => {
            const response = await server.handleSingleJsonRpc(
                { jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) },
                { headers: {} }
            )
            if (response.error) throw new Error(response.error.message)
            return response.result
        }
        return {
            listTools: async () => (await rpc('tools/list')).tools,
            callTool: async (name, args) => {
                const result = await rpc('tools/call', { name, arguments: args })
                const payload = JSON.parse(result.content[0].text)
                return result.isError ? { isError: true, ...payload } : payload
            },
        }
    }

    // `window.alldone` in a signed-in tab: the web bridge's real client, its fetch wired to the server.
    const browserTabClient = server => {
        const fetchImpl = async (endpoint, init) => {
            expect(endpoint).toBe('https://my.alldone.app/mcpServer')
            const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]))
            const response = await server.handleSingleJsonRpc(JSON.parse(init.body), { headers })
            return { ok: true, status: 200, json: async () => response }
        }
        return createMcpSessionClient({
            endpoint: 'https://my.alldone.app/mcpServer',
            getIdToken: async () => 'firebase-id-token',
            fetchImpl,
        })
    }

    // What the prompt asks the agent to show: one slot with date, time and time zone (user's zone).
    const describeSlot = (slot, timeZone) => {
        const start = moment.parseZone(slot.displayStart).tz(timeZone)
        const end = moment.parseZone(slot.displayEnd).tz(timeZone)
        return `${start.format('dddd, D MMMM YYYY, HH:mm')}–${end.format('HH:mm')} (${timeZone})`
    }

    const hostBookings = () => [...db.docs.entries()].filter(([path]) => path.startsWith('users/host-1/bookings/'))

    test('MCP client: reads without confirmation, proposes a concrete slot, books it only once confirmed, never twice', async () => {
        const agent = mcpClient(buildServer())

        // Discovery: the three tools are in the list; reads are read-only, booking is not.
        const tools = Object.fromEntries((await agent.listTools()).map(tool => [tool.name, tool]))
        BOOKING_TOOLS.forEach(name => expect(tools[name]).toBeDefined())
        expect(tools.get_public_booking_page.annotations).toEqual(expect.objectContaining({ readOnlyHint: true }))
        expect(tools.find_public_booking_times.annotations).toEqual(expect.objectContaining({ readOnlyHint: true }))
        expect(tools.book_public_meeting.annotations).toEqual(
            expect.objectContaining({ readOnlyHint: false, destructiveHint: false, idempotentHint: true })
        )

        // Reads need no confirmation.
        const page = await agent.callTool('get_public_booking_page', { bookingUrl: BOOKING_URL })
        expect(page).toEqual(
            expect.objectContaining({
                success: true,
                you: expect.objectContaining({ email: 'mia@example.com', calendarConnected: true }),
            })
        )
        const times = await agent.callTool('find_public_booking_times', {
            bookingUrl: BOOKING_URL,
            start: DAY_START,
            end: DAY_END,
            durationMinutes: 30,
        })
        expect(times.success).toBe(true)
        // Host availability AND the visitor's connected calendar were both checked.
        expect(times.availability).toBe('free_for_host_and_user')
        expect(times.visitorCalendar).toEqual(expect.objectContaining({ checked: true }))
        expect(JSON.stringify(times)).not.toMatch(/Secret board meeting|Private doctor|secret@example\.com/)

        // The agent proposes one concrete slot with date, time and time zone.
        const slot = times.options[0]
        expect(describeSlot(slot, page.you.timeZone)).toBe('Tuesday, 18 June 2030, 10:00–10:30 (Europe/London)')

        // Booking before the user answered is refused, and nothing happens.
        const early = await agent.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slot.start,
            end: slot.end,
            durationMinutes: 30,
        })
        expect(early).toEqual(expect.objectContaining({ success: false, code: 'confirmation_required' }))
        expect(early.message).toMatch(/exactly that slot/)
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        expect(bookingEmails.sendBookingConfirmationToVisitor).not.toHaveBeenCalled()

        // The user confirms that slot: booked.
        const booked = await agent.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slot.start,
            end: slot.end,
            durationMinutes: 30,
            confirmedByUser: true,
        })
        expect(booked).toEqual(
            expect.objectContaining({ success: true, status: 'confirmed', start: slot.start, end: slot.end })
        )
        expect(eventCount).toBe(1)
        expect(hostBookings()).toHaveLength(1)
        expect(hostBookings()[0][1].bookedVia).toBe('alldone_mcp')

        // A retry (lost response, second click of the agent) books nothing twice.
        const retry = await agent.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slot.start,
            end: slot.end,
            durationMinutes: 30,
            confirmedByUser: true,
        })
        expect(retry).toEqual(expect.objectContaining({ success: true, idempotentReplay: true }))
        expect(eventCount).toBe(1)
        expect(bookingEmails.sendBookingConfirmationToVisitor).toHaveBeenCalledTimes(1)
        expect(bookingEmails.sendBookingNotificationToHost).toHaveBeenCalledTimes(1)

        // Nothing went through the browser.
        expect(executeBrowserTool).not.toHaveBeenCalled()
    })

    test('window.alldone in a signed-in tab: a changed slot needs a new confirmation; only the confirmed one is booked', async () => {
        const agent = browserTabClient(buildServer())

        // The bridge sees the same tools; its WebMCP annotations agree with the server's.
        const listed = Object.fromEntries((await agent.listTools()).map(tool => [tool.name, tool]))
        BOOKING_TOOLS.forEach(name => expect(listed[name]).toBeDefined())
        expect(listed.find_public_booking_times.annotations.readOnlyHint).toBe(true)
        expect(listed.book_public_meeting.annotations).toEqual(getToolAnnotations('book_public_meeting'))
        expect(listed.book_public_meeting.annotations).toEqual(
            expect.objectContaining({ readOnlyHint: false, consequentialHint: true })
        )

        const times = await agent.callTool('find_public_booking_times', {
            bookingUrl: BOOKING_URL,
            start: DAY_START,
            end: DAY_END,
            durationMinutes: 30,
        })
        const [slotA, slotB] = times.options
        expect(slotA.start).not.toBe(slotB.start)

        // The user confirmed A, then changes their mind to B before the agent booked. A well-behaved agent
        // proposes B and waits. Calls for B without that new confirmation are refused...
        const unconfirmedB = await agent.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slotB.start,
            end: slotB.end,
            durationMinutes: 30,
            confirmedByUser: false,
        })
        expect(unconfirmedB).toEqual(expect.objectContaining({ success: false, code: 'confirmation_required' }))
        // ...and a key minted for A cannot be carried over to B either.
        const keyA = 'agent-booking-slot-a-0001'
        await expect(
            agent.callTool('book_public_meeting', {
                bookingUrl: BOOKING_URL,
                start: slotB.start,
                end: slotB.end,
                durationMinutes: 30,
                confirmedByUser: true,
                idempotencyKey: keyA,
            })
        ).resolves.toEqual(expect.objectContaining({ success: true }))
        // (That first use of keyA bound it to B.) Reusing it for A now is refused, not a second booking.
        const reused = await agent.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slotA.start,
            end: slotA.end,
            durationMinutes: 30,
            confirmedByUser: true,
            idempotencyKey: keyA,
        })
        expect(reused.success).toBe(false)
        expect(eventCount).toBe(1)
        expect(hostBookings()).toHaveLength(1)
        expect(hostBookings()[0][1]).toEqual(
            expect.objectContaining({ startMs: moment.parseZone(slotB.start).valueOf() })
        )
        // A browser-tab agent is still labelled as an Alldone MCP booking for the host.
        expect(hostBookings()[0][1].bookedVia).toBe('alldone_mcp')
        expect(executeBrowserTool).not.toHaveBeenCalled()
    })

    test('two agents for two visitors cannot both get the same slot', async () => {
        const mia = mcpClient(buildServer({ userId: 'visitor-1' }))
        const ben = mcpClient(buildServer({ userId: 'visitor-2', client: 'Claude' }))
        const slot = { start: '2030-06-18T14:00:00+02:00', end: '2030-06-18T14:30:00+02:00' }

        const first = await ben.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            ...slot,
            durationMinutes: 30,
            confirmedByUser: true,
        })
        expect(first.success).toBe(true)
        // The host calendar stub does not show the new event yet (free/busy lag): the server's own record
        // of recent bookings still refuses the second one.
        const second = await mia.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            ...slot,
            durationMinutes: 30,
            confirmedByUser: true,
        })
        expect(second).toEqual(expect.objectContaining({ success: false, code: 'slot_unavailable' }))
        expect(eventCount).toBe(1)
        expect(hostBookings()).toHaveLength(1)
    })

    test('the booking tools stay switched off where the user switched them off (Settings → MCP)', async () => {
        await db.doc('users/visitor-1').update({ mcpDisabledTools: ['book_public_meeting'] })
        const agent = mcpClient(buildServer())
        const names = (await agent.listTools()).map(tool => tool.name)
        expect(names).toContain('find_public_booking_times')
        expect(names).not.toContain('book_public_meeting')
        const blocked = await agent.callTool('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: '2030-06-18T15:00:00+02:00',
            end: '2030-06-18T15:30:00+02:00',
            confirmedByUser: true,
        })
        expect(blocked.isError).toBe(true)
        expect(eventCount).toBe(0)
    })

    test('an agent that opened the page with browser tools is pointed at the booking tools; gated steps stay untouched', async () => {
        const agent = mcpClient(buildServer())
        executeBrowserTool.mockResolvedValueOnce({
            success: true,
            action: 'navigate',
            url: BOOKING_URL,
            title: 'Book a meeting with Karsten Wysk',
        })
        const navigated = await agent.callTool('browser_navigate', { url: BOOKING_URL })
        expect(navigated.bookingPage).toEqual(
            expect.objectContaining({ bookingUrl: BOOKING_URL, tools: BOOKING_TOOLS })
        )
        expect(navigated.bookingPage.instruction).toMatch(/Do not click/)
        expect(navigated.bookingPage.instruction).toMatch(/refresh or reconnect the Alldone connector/)

        const gated = {
            success: false,
            status: 'approval_required',
            approvalId: 'appr-1',
            instruction: 'Tell the user exactly what you are about to do and that it needs their approval, then stop.',
        }
        executeBrowserTool.mockResolvedValueOnce(gated)
        const clicked = await agent.callTool('browser_click', { ref: 'e3' })
        expect(clicked.bookingPage).toBeUndefined()
        expect(clicked).toEqual(expect.objectContaining({ status: 'approval_required', approvalId: 'appr-1' }))
        expect(eventCount).toBe(0)
    })
})
