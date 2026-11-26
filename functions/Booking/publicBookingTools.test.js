// AT-3161 follow-up: someone else's booking link as tools of the connected Alldone surfaces.
//
// The flow below runs the REAL booking stack (publicBookingTools -> publicBooking -> bookingSettings ->
// availability engine in assistantCalendarTools, booking lock, rate limits, idempotency) on the fake
// Firestore. Only the outside world is stubbed: the Google Calendar API (busy timings per user), the
// creation of the host's calendar event and the two mails. So it proves that an agent can read the page,
// get times free for host AND visitor, and book, with nothing but tool calls.

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: jest.fn(() => 'now') } }))
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
jest.mock('./bookingEmails', () => ({
    sendBookingNotificationToHost: jest.fn().mockResolvedValue(undefined),
    sendBookingConfirmationToVisitor: jest.fn().mockResolvedValue(undefined),
}))

const admin = require('firebase-admin')
const { google } = require('googleapis')
const { getAuthorizedOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const bookingEmails = require('./bookingEmails')
const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { hashKey } = require('./bookingRateLimit')
const { MAX_BOOKING_RANGE_DAYS, MAX_PUBLIC_SLOT_OPTIONS } = require('./bookingSettings')
const { executePublicBookingTool, resolveBookingSlug } = require('./publicBookingTools')
const {
    MAX_HOST_OPTIONS,
    MAX_RANGE_DAYS,
    PUBLIC_BOOKING_MCP_ANNOTATIONS,
    PUBLIC_BOOKING_TOOL_NAMES,
    PUBLIC_BOOKING_TOOL_SCHEMAS,
} = require('./publicBookingToolSchemas')

const BOOKING_URL = 'https://my.alldone.app/meet/karsten-wysk'
const DAY_START = '2030-06-18T00:00:00+02:00' // a Tuesday, far in the future
const DAY_END = '2030-06-19T00:00:00+02:00'
const MCP = { sourceChannel: 'mcp', mcpClient: 'Claude' }

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

describe('public booking tools for connected agents (get_public_booking_page, find_public_booking_times, book_public_meeting)', () => {
    let db
    let eventsByUser
    let listCalls

    const run = (toolName, args, { userId = 'visitor-1', runtime = MCP, assistantId = null } = {}) =>
        executePublicBookingTool({ toolName, args, db, userId, assistantId, runtime })

    beforeEach(() => {
        jest.clearAllMocks()
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
                email: 'Me@Example.com',
                timezone: 'Europe/London',
                ...calendarConnection('me@example.com'),
            },
            'users/no-calendar': { displayName: 'No Cal', email: 'nocal@example.com', timezone: 'Europe/Berlin' },
        })
        admin.firestore.mockReturnValue(db)

        // Host busy 09:00-10:00 Berlin, visitor busy 10:00-11:00 Berlin (09:00-10:00 London).
        eventsByUser = {
            'host-1': [busyEvent('2030-06-18T09:00:00+02:00', '2030-06-18T10:00:00+02:00', 'Secret board meeting')],
            'visitor-1': [busyEvent('2030-06-18T10:00:00+02:00', '2030-06-18T11:00:00+02:00', 'Private doctor')],
        }
        listCalls = []
        getAuthorizedOAuth2Client.mockImplementation(async userId => ({ __userId: userId }))
        google.calendar.mockImplementation(({ auth }) => ({
            events: {
                list: jest.fn(async params => {
                    listCalls.push({ userId: auth.__userId, ...params })
                    return { data: { items: eventsByUser[auth.__userId] || [] } }
                }),
            },
        }))
        createCalendarEventForAssistantRequest.mockResolvedValue({
            success: true,
            provider: 'google',
            calendarId: 'primary',
            event: { eventId: 'evt-1', htmlLink: 'https://calendar.example/evt-1' },
            joinUrl: 'https://meet.example/abc',
            joinProvider: 'google_meet',
        })
    })

    describe('the booking link', () => {
        test.each([
            ['https://my.alldone.app/meet/karsten-wysk', 'karsten-wysk'],
            ['my.alldone.app/meet/Karsten-Wysk/', 'karsten-wysk'],
            ['https://my.alldone.app/meet/karsten-wysk?utm=x#top', 'karsten-wysk'],
            ['https://my.alldone.app/meet/karsten-wysk/llms.txt', 'karsten-wysk'],
            ['https://my.alldone.app/api/booking/mcp/karsten-wysk', 'karsten-wysk'],
            ['karsten-wysk', 'karsten-wysk'],
        ])('accepts %s', (input, slug) => {
            expect(resolveBookingSlug(input)).toEqual({ slug })
        })

        test.each([
            ['https://evil.example/meet/karsten-wysk', 'foreign_booking_link'],
            ['https://my.alldone.app.evil.example/meet/karsten-wysk', 'foreign_booking_link'],
            ['https://mystaging.alldone.app/meet/karsten-wysk', 'foreign_booking_link'],
            ['http://my.alldone.app/meet/karsten-wysk', 'foreign_booking_link'],
            ['https://my.alldone.app/projects/p1/tasks/t1', 'invalid_booking_link'],
            ['', 'invalid_booking_link'],
            ['not a link at all', 'invalid_booking_link'],
        ])('refuses %s', async (input, code) => {
            const result = await run('get_public_booking_page', { bookingUrl: input })
            expect(result).toEqual(expect.objectContaining({ success: false, code }))
            expect(google.calendar).not.toHaveBeenCalled()
        })
    })

    test('full tool-only flow over MCP: read the page, find times free for host and visitor, book after confirmation', async () => {
        const page = await run('get_public_booking_page', { bookingUrl: BOOKING_URL })
        expect(page).toEqual(
            expect.objectContaining({
                success: true,
                page: expect.objectContaining({
                    slug: 'karsten-wysk',
                    bookingUrl: BOOKING_URL,
                    settings: expect.objectContaining({ timeZone: 'Europe/Berlin', availableDurations: [15, 30, 60] }),
                }),
                you: {
                    name: 'Mia Visitor',
                    email: 'me@example.com',
                    timeZone: 'Europe/London',
                    calendarConnected: true,
                },
            })
        )
        expect(page.ownPage).toBeUndefined()

        const times = await run('find_public_booking_times', {
            bookingUrl: BOOKING_URL,
            start: DAY_START,
            end: DAY_END,
            durationMinutes: 30,
        })
        expect(times.success).toBe(true)
        expect(times.availability).toBe('free_for_host_and_user')
        expect(times.timeZone).toBe('Europe/Berlin')
        expect(times.displayTimeZone).toBe('Europe/London')
        expect(times.visitorCalendar).toEqual({ checked: true, calendarsChecked: 1, hostSlotsBusyForYou: 2 })
        // Host: 10:00 onwards (09:00-10:00 busy). Visitor: 10:00-11:00 busy. Free for both: 11:00 onwards.
        expect(times.hostOptionCount).toBe(14)
        expect(times.options).toHaveLength(12)
        expect(times.options[0]).toEqual({
            start: '2030-06-18T11:00:00+02:00',
            end: '2030-06-18T11:30:00+02:00',
            displayStart: '2030-06-18T10:00:00+01:00',
            displayEnd: '2030-06-18T10:30:00+01:00',
        })
        // Both calendars were read as busy timings only; nothing of either leaves the tool.
        expect(new Set(listCalls.map(call => call.userId))).toEqual(new Set(['host-1', 'visitor-1']))
        listCalls.forEach(call => expect(call.fields).toBe('nextPageToken,items(start,end,status,transparency)'))
        const serialized = JSON.stringify([page, times])
        expect(serialized).not.toMatch(/Secret board meeting|Private doctor|secret@example\.com|host@example\.com/)

        // Not confirmed: nothing happens.
        const slot = times.options[0]
        const unconfirmed = await run('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slot.start,
            end: slot.end,
        })
        expect(unconfirmed).toEqual(expect.objectContaining({ success: false, code: 'confirmation_required' }))
        expect(unconfirmed.message).toMatch(/date, time and time zone/)
        expect(unconfirmed.message).toMatch(/If they pick another slot, ask again/)
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()

        const booking = await run('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slot.start,
            end: slot.end,
            durationMinutes: 30,
            confirmedByUser: true,
        })
        expect(booking).toEqual(
            expect.objectContaining({
                success: true,
                status: 'confirmed',
                start: slot.start,
                end: slot.end,
                durationMinutes: 30,
                timeZone: 'Europe/Berlin',
                joinUrl: 'https://meet.example/abc',
                visitorName: 'Mia Visitor',
                visitorEmail: 'me@example.com',
                bookingUrl: BOOKING_URL,
            })
        )
        expect(createCalendarEventForAssistantRequest).toHaveBeenCalledTimes(1)
        expect(createCalendarEventForAssistantRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'host-1',
                start: slot.start,
                end: slot.end,
                timeZone: 'Europe/Berlin',
                attendees: [{ email: 'me@example.com', displayName: 'Mia Visitor' }],
                description: expect.stringContaining("connected to the visitor's Alldone account"),
            })
        )
        expect(bookingEmails.sendBookingConfirmationToVisitor).toHaveBeenCalledWith(
            expect.objectContaining({
                visitorEmail: 'me@example.com',
                timeZone: 'Europe/London',
                hostName: 'Karsten Wysk',
            })
        )
        expect(bookingEmails.sendBookingNotificationToHost).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'host-1', bookedViaText: expect.stringContaining('Alldone MCP') })
        )
        const stored = [...db.docs.entries()].filter(([path]) => path.startsWith('users/host-1/bookings/'))
        expect(stored).toHaveLength(1)
        expect(stored[0][1]).toEqual(
            expect.objectContaining({
                bookedVia: 'alldone_mcp',
                visitorEmail: 'me@example.com',
                visitorTimeZone: 'Europe/London',
                idempotencyKeyHash: expect.any(String),
            })
        )
        // Rate limits count against the Alldone account, not a header-borne IP.
        expect(db.docs.has(`bookingRateLimits/${hashKey('ip', 'alldone-user:visitor-1')}`)).toBe(true)
        expect(db.docs.has(`bookingRateLimits/${hashKey('slotsIp', 'alldone-user:visitor-1')}`)).toBe(true)

        // An agent's retry books nothing twice (derived idempotency key).
        const retry = await run('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: slot.start,
            end: slot.end,
            durationMinutes: 30,
            confirmedByUser: true,
        })
        expect(retry).toEqual(
            expect.objectContaining({ success: true, idempotentReplay: true, bookingId: booking.bookingId })
        )
        expect(createCalendarEventForAssistantRequest).toHaveBeenCalledTimes(1)
        expect(bookingEmails.sendBookingConfirmationToVisitor).toHaveBeenCalledTimes(1)
    })

    test('a slot taken meanwhile is refused with slot_unavailable and nothing is created', async () => {
        eventsByUser['host-1'].push(busyEvent('2030-06-18T11:00:00+02:00', '2030-06-18T12:00:00+02:00', 'New'))
        const result = await run('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: '2030-06-18T11:00:00+02:00',
            end: '2030-06-18T11:30:00+02:00',
            confirmedByUser: true,
        })
        expect(result).toEqual(expect.objectContaining({ success: false, code: 'slot_unavailable' }))
        expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        expect(bookingEmails.sendBookingConfirmationToVisitor).not.toHaveBeenCalled()
    })

    test('without a connected calendar the host slots come back marked host_only, never as mutual', async () => {
        const times = await run(
            'find_public_booking_times',
            { bookingUrl: BOOKING_URL, start: DAY_START, end: DAY_END },
            { userId: 'no-calendar' }
        )
        expect(times.success).toBe(true)
        expect(times.availability).toBe('host_only')
        expect(times.visitorCalendar).toEqual(expect.objectContaining({ checked: false, reason: 'not_connected' }))
        expect(times.options).toHaveLength(14)
        expect(times.message).toMatch(/host's free slots only/)
    })

    test("a visitor calendar that cannot be read is reported, and the host's slots are not presented as mutual", async () => {
        google.calendar.mockImplementation(({ auth }) => ({
            events: {
                list: jest.fn(async () => {
                    if (auth.__userId === 'visitor-1') throw new Error('invalid_grant')
                    return { data: { items: eventsByUser[auth.__userId] || [] } }
                }),
            },
        }))
        const times = await run('find_public_booking_times', {
            bookingUrl: BOOKING_URL,
            start: DAY_START,
            end: DAY_END,
        })
        expect(times.availability).toBe('host_only')
        expect(times.visitorCalendar).toEqual(expect.objectContaining({ checked: false, reason: 'unavailable' }))
    })

    test('matchMyCalendar: false skips the visitor calendar entirely', async () => {
        const times = await run('find_public_booking_times', {
            bookingUrl: BOOKING_URL,
            start: DAY_START,
            end: DAY_END,
            matchMyCalendar: false,
        })
        expect(times.visitorCalendar).toEqual({ checked: false, reason: 'not_requested' })
        expect(times.options).toHaveLength(14)
        expect(listCalls.some(call => call.userId === 'visitor-1')).toBe(false)
    })

    test('page rules still apply: unknown duration, too long a range, unknown timezone, disabled page', async () => {
        await expect(
            run('find_public_booking_times', {
                bookingUrl: BOOKING_URL,
                start: DAY_START,
                end: DAY_END,
                durationMinutes: 45,
            })
        ).resolves.toEqual(expect.objectContaining({ success: false, code: 'invalid_duration' }))
        await expect(
            run('find_public_booking_times', {
                bookingUrl: BOOKING_URL,
                start: DAY_START,
                end: '2030-08-18T00:00:00+02:00',
            })
        ).resolves.toEqual(expect.objectContaining({ success: false, code: 'range_too_long' }))
        await expect(
            run('find_public_booking_times', {
                bookingUrl: BOOKING_URL,
                start: DAY_START,
                end: DAY_END,
                timeZone: 'Mars/Base',
            })
        ).resolves.toEqual(expect.objectContaining({ success: false, code: 'invalid_timezone' }))
        await db.doc('bookingPages/karsten-wysk').update({ enabled: false })
        await expect(run('get_public_booking_page', { bookingUrl: BOOKING_URL })).resolves.toEqual(
            expect.objectContaining({ success: false, code: 'not_found' })
        )
    })

    test("the host's own link is flagged, so an agent does not book a meeting with its own user unawares", async () => {
        const page = await run('get_public_booking_page', { bookingUrl: BOOKING_URL }, { userId: 'host-1' })
        expect(page.ownPage).toBe(true)
        expect(page.message).toMatch(/OWN booking link/)
    })

    test('an explicit visitor name and email are used instead of the profile', async () => {
        const result = await run('book_public_meeting', {
            bookingUrl: BOOKING_URL,
            start: '2030-06-18T14:00:00+02:00',
            end: '2030-06-18T14:30:00+02:00',
            confirmedByUser: true,
            visitorName: 'Ada Lovelace',
            visitorEmail: 'ada@example.com',
        })
        expect(result).toEqual(expect.objectContaining({ success: true, visitorEmail: 'ada@example.com' }))
        expect(createCalendarEventForAssistantRequest).toHaveBeenCalledWith(
            expect.objectContaining({ attendees: [{ email: 'ada@example.com', displayName: 'Ada Lovelace' }] })
        )
    })

    describe('in-app assistants', () => {
        const slotArgs = {
            bookingUrl: BOOKING_URL,
            start: '2030-06-18T15:00:00+02:00',
            end: '2030-06-18T15:30:00+02:00',
            confirmedByUser: true,
        }
        const chatRuntime = {
            sourceChannel: 'chat',
            humanTurn: true,
            projectId: 'p1',
            objectType: 'topics',
            objectId: 'chat-1',
            messageId: 'm-1',
        }

        test('refuse to book outside a turn the user typed (email, heartbeat, workflow prompt)', async () => {
            const emailRun = await run('book_public_meeting', slotArgs, {
                assistantId: 'anna',
                runtime: { sourceChannel: 'email' },
            })
            expect(emailRun).toEqual(expect.objectContaining({ success: false, code: 'confirmation_required' }))

            // A message by somebody else (or the assistant) does not count as the user's confirmation.
            await db.doc('chatComments/p1/topics/chat-1/comments/m-1').set({ creatorId: 'someone-else' })
            const othersTurn = await run('book_public_meeting', slotArgs, { assistantId: 'anna', runtime: chatRuntime })
            expect(othersTurn).toEqual(expect.objectContaining({ success: false, code: 'confirmation_required' }))
            expect(createCalendarEventForAssistantRequest).not.toHaveBeenCalled()
        })

        test("book in the user's own typed turn, labelled as booked by the visitor's assistant", async () => {
            await db.doc('chatComments/p1/topics/chat-1/comments/m-1').set({ creatorId: 'visitor-1' })
            const result = await run('book_public_meeting', slotArgs, { assistantId: 'anna', runtime: chatRuntime })
            expect(result).toEqual(expect.objectContaining({ success: true, status: 'confirmed' }))
            const stored = [...db.docs.entries()].find(([path]) => path.startsWith('users/host-1/bookings/'))
            expect(stored[1].bookedVia).toBe('alldone_assistant')
        })

        test('may read the page and find times in any turn (reads book nothing)', async () => {
            const times = await run(
                'find_public_booking_times',
                { bookingUrl: BOOKING_URL, start: DAY_START, end: DAY_END },
                { assistantId: 'anna', runtime: { sourceChannel: 'email' } }
            )
            expect(times.success).toBe(true)
        })
    })

    test('schemas: three tools, the confirmation is required, and the limits match the booking engine', () => {
        expect(PUBLIC_BOOKING_TOOL_NAMES).toEqual([
            'get_public_booking_page',
            'find_public_booking_times',
            'book_public_meeting',
        ])
        expect(MAX_RANGE_DAYS).toBe(MAX_BOOKING_RANGE_DAYS)
        expect(MAX_HOST_OPTIONS).toBe(MAX_PUBLIC_SLOT_OPTIONS)
        const book = PUBLIC_BOOKING_TOOL_SCHEMAS.book_public_meeting.function
        expect(book.parameters.required).toEqual(['bookingUrl', 'start', 'end', 'confirmedByUser'])
        expect(book.description).toMatch(/only after they explicitly confirmed/)
        for (const name of PUBLIC_BOOKING_TOOL_NAMES) {
            const schema = PUBLIC_BOOKING_TOOL_SCHEMAS[name].function
            expect(schema.name).toBe(name)
            expect(schema.parameters.required).toContain('bookingUrl')
        }
        // A changed slot needs a new confirmation; the reads need none.
        expect(book.description).toMatch(/If the slot or any detail changes, ask again/)
        expect(book.parameters.properties.confirmedByUser.description).toMatch(
            /a changed slot needs a new confirmation/
        )
        expect(PUBLIC_BOOKING_TOOL_SCHEMAS.get_public_booking_page.function.description).toMatch(/Read-only/)
        expect(PUBLIC_BOOKING_TOOL_SCHEMAS.find_public_booking_times.function.description).toMatch(/Read-only/)
        // MCP annotations: reads are read-only, booking is a (non-destructive, idempotent) write.
        expect(PUBLIC_BOOKING_MCP_ANNOTATIONS.get_public_booking_page.readOnlyHint).toBe(true)
        expect(PUBLIC_BOOKING_MCP_ANNOTATIONS.find_public_booking_times.readOnlyHint).toBe(true)
        expect(PUBLIC_BOOKING_MCP_ANNOTATIONS.book_public_meeting).toEqual(
            expect.objectContaining({ readOnlyHint: false, destructiveHint: false, idempotentHint: true })
        )
        // The read tools say what they replace, so an agent stops reaching for the browser.
        expect(PUBLIC_BOOKING_TOOL_SCHEMAS.get_public_booking_page.function.description).toMatch(/instead of opening/)
        expect(PUBLIC_BOOKING_TOOL_SCHEMAS.find_public_booking_times.function.description).toMatch(
            /user's OWN connected calendars/
        )
    })
})
