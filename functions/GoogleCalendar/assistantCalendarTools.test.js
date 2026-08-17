jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('googleapis', () => ({
    google: {
        calendar: jest.fn(),
    },
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAuthorizedOAuth2Client: jest.fn(),
}))

const admin = require('firebase-admin')
const { google } = require('googleapis')
const moment = require('moment-timezone')
const { getAuthorizedOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')

const firestoreState = {
    users: {},
    bookingSettings: {},
    bookingSettingsErrors: {},
}

const calendarClients = {}

function makeUserDoc(userId) {
    const data = firestoreState.users[userId]
    return {
        exists: !!data,
        data: () => data,
    }
}

function buildFirestore() {
    return {
        collection: jest.fn(name => {
            if (name !== 'users') throw new Error(`Unexpected collection: ${name}`)
            return {
                doc: jest.fn(userId => ({
                    get: jest.fn().mockResolvedValue(makeUserDoc(userId)),
                })),
            }
        }),
        // AT-2278: the meeting settings doc that carries minFreeHoursPerDay.
        doc: jest.fn(path => {
            const match = /^users\/([^/]+)\/bookingSettings\/default$/.exec(path)
            if (!match) throw new Error(`Unexpected doc path: ${path}`)
            const error = firestoreState.bookingSettingsErrors[match[1]]
            if (error) return { get: jest.fn().mockRejectedValue(error) }
            const data = firestoreState.bookingSettings[match[1]]
            return {
                get: jest.fn().mockResolvedValue({ exists: !!data, data: () => data }),
            }
        }),
    }
}

// The handler now returns a ready, fully-credentialed client instead of a bare token.
function createOAuthClient(projectId) {
    return { __projectId: projectId, setCredentials: jest.fn(), on: jest.fn() }
}

describe('assistantCalendarTools', () => {
    let assistantCalendarTools

    beforeEach(() => {
        firestoreState.users = {}
        firestoreState.bookingSettings = {}
        firestoreState.bookingSettingsErrors = {}
        Object.keys(calendarClients).forEach(key => delete calendarClients[key])
        jest.clearAllMocks()

        admin.firestore.mockImplementation(() => buildFirestore())
        getAuthorizedOAuth2Client.mockImplementation((userId, projectId) =>
            Promise.resolve(createOAuthClient(projectId))
        )
        google.calendar.mockImplementation(({ auth }) => {
            const client = calendarClients[auth.__projectId]
            if (!client) throw new Error(`Missing mocked calendar client for project ${auth.__projectId}`)
            return client
        })

        assistantCalendarTools = require('./assistantCalendarTools')
    })

    function setUser(userId, data) {
        firestoreState.users[userId] = data
    }

    function setBookingSettings(userId, data) {
        firestoreState.bookingSettings[userId] = data
    }

    function setCalendarClient(projectId, overrides = {}) {
        calendarClients[projectId] = {
            events: {
                list: jest.fn().mockResolvedValue({ data: { items: [] } }),
                get: jest.fn(),
                insert: jest.fn(),
                patch: jest.fn(),
                delete: jest.fn(),
            },
            calendars: {
                get: jest.fn().mockResolvedValue({ data: { id: 'primary' } }),
            },
            ...overrides,
        }
        return calendarClients[projectId]
    }

    test('deduplicates connected calendar accounts by calendar email', async () => {
        setUser('user-1', {
            defaultProjectId: 'p1',
            projectIds: ['p1', 'p2', 'p3'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'me@example.com' },
                p2: { calendar: true, calendarEmail: 'me@example.com' },
                p3: { calendar: true, calendarEmail: 'other@example.com' },
            },
        })

        const accounts = await assistantCalendarTools.__private__.getConnectedCalendarAccounts('user-1')

        expect(accounts).toEqual([
            { projectId: 'p1', calendarEmail: 'me@example.com', calendarDefault: false },
            { projectId: 'p3', calendarEmail: 'other@example.com', calendarDefault: false },
        ])
    })

    test('applies before and after buffers to busy intervals', () => {
        const result = assistantCalendarTools.__private__.applyBusyIntervalBuffers(
            [{ startMs: 1000 * 60 * 60, endMs: 2 * 1000 * 60 * 60 }],
            10,
            15
        )

        expect(result).toEqual([{ startMs: 50 * 60 * 1000, endMs: 135 * 60 * 1000 }])
    })

    test('searches across connected calendar accounts and returns normalized events', async () => {
        setUser('user-1', {
            projectIds: ['p1', 'p2'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
                p2: { calendar: true, calendarEmail: 'two@example.com' },
            },
        })

        setCalendarClient('p1', {
            events: {
                list: jest.fn().mockResolvedValue({
                    data: {
                        items: [
                            {
                                id: 'evt-1',
                                summary: 'Design Review',
                                description: 'Quarterly review',
                                start: { dateTime: '2026-03-10T09:00:00+01:00' },
                                end: { dateTime: '2026-03-10T10:00:00+01:00' },
                                attendees: [{ email: 'alice@example.com', responseStatus: 'accepted' }],
                            },
                        ],
                    },
                }),
                get: jest.fn(),
                insert: jest.fn(),
                patch: jest.fn(),
                delete: jest.fn(),
            },
        })
        setCalendarClient('p2')

        const result = await assistantCalendarTools.searchCalendarEventsForAssistantRequest({
            userId: 'user-1',
            query: 'review',
            limit: 5,
        })

        expect(result.success).toBe(true)
        expect(result.searchedAccounts).toHaveLength(2)
        expect(result.results[0]).toMatchObject({
            projectId: 'p1',
            calendarEmail: 'one@example.com',
            calendarId: 'primary',
            eventId: 'evt-1',
            summary: 'Design Review',
            description: 'Quarterly review',
            attendees: [{ email: 'alice@example.com', responseStatus: 'accepted' }],
        })
    })

    test('finds free options without returning calendar event metadata', async () => {
        setUser('user-1', {
            timezone: 'Europe/Berlin',
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'private@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.list
            .mockResolvedValueOnce({
                data: {
                    nextPageToken: 'private-next-page-token',
                    items: [
                        {
                            summary: 'Private board meeting',
                            description: 'Confidential',
                            attendees: [{ email: 'secret@example.com' }],
                            location: 'Private room',
                            status: 'confirmed',
                            start: { dateTime: '2026-03-10T10:00:00+01:00' },
                            end: { dateTime: '2026-03-10T10:30:00+01:00' },
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                data: {
                    items: [
                        {
                            summary: 'Second private meeting',
                            status: 'confirmed',
                            start: { dateTime: '2026-03-10T10:30:00+01:00' },
                            end: { dateTime: '2026-03-10T11:00:00+01:00' },
                        },
                    ],
                },
            })

        const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00+01:00',
            timeMax: '2026-03-10T12:00:00+01:00',
            durationMinutes: 30,
            maxOptions: 3,
        })

        expect(result.success).toBe(true)
        expect(result.options).toEqual([
            { start: '2026-03-10T09:00:00+01:00', end: '2026-03-10T09:30:00+01:00' },
            { start: '2026-03-10T09:30:00+01:00', end: '2026-03-10T10:00:00+01:00' },
            { start: '2026-03-10T11:00:00+01:00', end: '2026-03-10T11:30:00+01:00' },
        ])
        expect(JSON.stringify(result)).not.toMatch(/Private board meeting|Confidential|secret@example.com|Private room/)
        expect(client.events.list).toHaveBeenCalledWith(
            expect.objectContaining({
                fields: 'nextPageToken,items(start,end,status,transparency)',
            })
        )
        expect(client.events.list).toHaveBeenCalledTimes(2)
        expect(client.events.list.mock.calls[1][0]).toEqual(
            expect.objectContaining({ pageToken: 'private-next-page-token' })
        )
    })

    test('ignores all-day and multi-day events while timed same-day events remain busy', async () => {
        setUser('user-1', {
            timezone: 'Europe/Berlin',
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'private@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.list.mockResolvedValue({
            data: {
                items: [
                    {
                        status: 'confirmed',
                        start: { date: '2026-03-10' },
                        end: { date: '2026-03-11' },
                    },
                    {
                        status: 'confirmed',
                        start: { dateTime: '2026-03-10T09:00:00+01:00' },
                        end: { dateTime: '2026-03-11T11:00:00+01:00' },
                    },
                    {
                        status: 'confirmed',
                        start: { dateTime: '2026-03-10T10:00:00+01:00' },
                        end: { dateTime: '2026-03-10T10:30:00+01:00' },
                    },
                ],
            },
        })

        const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00+01:00',
            timeMax: '2026-03-10T12:00:00+01:00',
            durationMinutes: 30,
            maxOptions: 6,
        })

        expect(result.success).toBe(true)
        expect(result.options).toEqual([
            { start: '2026-03-10T09:00:00+01:00', end: '2026-03-10T09:30:00+01:00' },
            { start: '2026-03-10T09:30:00+01:00', end: '2026-03-10T10:00:00+01:00' },
            { start: '2026-03-10T10:30:00+01:00', end: '2026-03-10T11:00:00+01:00' },
            { start: '2026-03-10T11:00:00+01:00', end: '2026-03-10T11:30:00+01:00' },
            { start: '2026-03-10T11:30:00+01:00', end: '2026-03-10T12:00:00+01:00' },
        ])
    })

    describe('minimum free calendar time per day (AT-2278)', () => {
        const CALENDAR_USER = {
            timezone: 'Europe/Berlin',
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        }

        function busyEvent(startIso, endIso) {
            return { status: 'confirmed', start: { dateTime: startIso }, end: { dateTime: endIso } }
        }

        test('skips a day that would drop below the default 4 free hours and keeps the next one', async () => {
            setUser('user-1', CALENDAR_USER)
            const client = setCalendarClient('p1')
            // 5h booked inside a 09:00-17:00 window leaves 3h free — a 30min meeting would
            // leave 2.5h, below the 4h default. The following day is empty.
            client.events.list.mockResolvedValue({
                data: { items: [busyEvent('2026-03-10T09:00:00+01:00', '2026-03-10T14:00:00+01:00')] },
            })

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-03-10T09:00:00+01:00',
                timeMax: '2026-03-11T17:00:00+01:00',
                durationMinutes: 30,
                maxOptions: 2,
            })

            expect(result.success).toBe(true)
            expect(result.minFreeHours).toEqual({
                perDay: 4,
                source: 'settings',
                applied: true,
                skippedDays: ['2026-03-10'],
            })
            expect(result.options).toEqual([
                { start: '2026-03-11T09:00:00+01:00', end: '2026-03-11T09:30:00+01:00' },
                { start: '2026-03-11T09:30:00+01:00', end: '2026-03-11T10:00:00+01:00' },
            ])
            expect(result.message).toContain('1 day was skipped')
        })

        test('counts meetings outside the searched window but inside the same working day', async () => {
            setUser('user-1', CALENDAR_USER)
            const client = setCalendarClient('p1')
            client.events.list.mockResolvedValue({
                data: { items: [busyEvent('2026-03-10T09:00:00+01:00', '2026-03-10T14:00:00+01:00')] },
            })

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                // The morning load sits entirely outside this window; the day is still full.
                timeMin: '2026-03-10T15:00:00+01:00',
                timeMax: '2026-03-10T17:00:00+01:00',
                durationMinutes: 30,
                maxOptions: 2,
            })

            expect(client.events.list).toHaveBeenCalledWith(
                expect.objectContaining({ timeMin: '2026-03-09T23:00:00.000Z' })
            )
            // Soft fallback: no day in the range qualifies, so the options are offered anyway
            // and flagged as cutting into the protected free time.
            expect(result.minFreeHours).toMatchObject({ perDay: 4, applied: false, skippedDays: ['2026-03-10'] })
            expect(result.options).toEqual([
                { start: '2026-03-10T15:00:00+01:00', end: '2026-03-10T15:30:00+01:00' },
                { start: '2026-03-10T15:30:00+01:00', end: '2026-03-10T16:00:00+01:00' },
            ])
            expect(result.message).toContain('cut into that protected time')
        })

        test('uses the saved per-user setting instead of the default', async () => {
            setUser('user-1', CALENDAR_USER)
            setBookingSettings('user-1', { minFreeHoursPerDay: 6 })
            const client = setCalendarClient('p1')
            // 2h booked leaves 6h free: fine under the 4h default, too little under 6h.
            client.events.list.mockResolvedValue({
                data: { items: [busyEvent('2026-03-10T09:00:00+01:00', '2026-03-10T11:00:00+01:00')] },
            })

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-03-10T09:00:00+01:00',
                timeMax: '2026-03-11T17:00:00+01:00',
                durationMinutes: 30,
                maxOptions: 1,
            })

            expect(result.minFreeHours).toMatchObject({
                perDay: 6,
                source: 'settings',
                applied: true,
                skippedDays: ['2026-03-10'],
            })
            expect(result.options).toEqual([{ start: '2026-03-11T09:00:00+01:00', end: '2026-03-11T09:30:00+01:00' }])
        })

        test('an explicit request value overrides the setting, and 0 disables the rule', async () => {
            setUser('user-1', CALENDAR_USER)
            setBookingSettings('user-1', { minFreeHoursPerDay: 6 })
            const client = setCalendarClient('p1')
            client.events.list.mockResolvedValue({
                data: { items: [busyEvent('2026-03-10T09:00:00+01:00', '2026-03-10T14:00:00+01:00')] },
            })

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-03-10T09:00:00+01:00',
                timeMax: '2026-03-10T17:00:00+01:00',
                durationMinutes: 30,
                maxOptions: 1,
                minFreeHoursPerDay: 0,
            })

            expect(result.minFreeHours).toEqual({
                perDay: 0,
                source: 'request',
                applied: true,
                skippedDays: [],
            })
            expect(result.options).toEqual([{ start: '2026-03-10T14:00:00+01:00', end: '2026-03-10T14:30:00+01:00' }])
        })
    })

    describe('public meeting-link policy for emailed options', () => {
        const NOW = moment.tz('2026-08-12T14:00:00', 'Europe/Berlin').valueOf()
        const CALENDAR_USER = {
            timezone: 'Europe/Berlin',
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        }

        beforeEach(() => {
            jest.useFakeTimers()
            jest.setSystemTime(NOW)
            setUser('user-1', CALENDAR_USER)
        })

        afterEach(() => {
            jest.useRealTimers()
        })

        test('clamps an emailed search to tomorrow and applies the saved availability settings', async () => {
            setBookingSettings('user-1', {
                timeZone: 'Europe/Berlin',
                workingHoursStart: '10:00',
                workingHoursEnd: '16:00',
                includeWeekends: true,
                allowSameDayBooking: false,
                bufferBeforeMinutes: 15,
                bufferAfterMinutes: 20,
                minFreeHoursPerDay: 0,
            })
            setCalendarClient('p1')

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-08-12T09:00:00+02:00',
                timeMax: '2026-08-13T17:00:00+02:00',
                maxOptions: 2,
                respectPublicMeetingLinkSettings: true,
            })

            expect(result.success).toBe(true)
            expect(result.requestedRange.start).toBe('2026-08-13T00:00:00+02:00')
            expect(result.workingHours).toEqual({
                start: '10:00',
                end: '16:00',
                includeWeekends: true,
                bufferBeforeMinutes: 15,
                bufferAfterMinutes: 20,
            })
            expect(result.minFreeHours).toMatchObject({ perDay: 0, source: 'settings' })
            expect(result.options).toEqual([
                { start: '2026-08-13T10:00:00+02:00', end: '2026-08-13T10:30:00+02:00' },
                { start: '2026-08-13T10:30:00+02:00', end: '2026-08-13T11:00:00+02:00' },
            ])
        })

        test('returns no emailed options for today when same-day meetings are disabled', async () => {
            setBookingSettings('user-1', {
                timeZone: 'Europe/Berlin',
                allowSameDayBooking: false,
            })
            const client = setCalendarClient('p1')

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-08-12T14:00:00+02:00',
                timeMax: '2026-08-12T17:00:00+02:00',
                respectPublicMeetingLinkSettings: true,
            })

            expect(result).toMatchObject({
                success: true,
                options: [],
            })
            expect(result.message).toContain('do not allow same-day meetings')
            expect(client.events.list).not.toHaveBeenCalled()
        })

        test('keeps today available when the current request explicitly overrides the saved setting', async () => {
            setBookingSettings('user-1', {
                timeZone: 'Europe/Berlin',
                allowSameDayBooking: false,
                minFreeHoursPerDay: 0,
            })
            setCalendarClient('p1')

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-08-12T14:00:00+02:00',
                timeMax: '2026-08-12T17:00:00+02:00',
                maxOptions: 1,
                allowSameDayBooking: true,
                respectPublicMeetingLinkSettings: true,
            })

            expect(result.options).toEqual([{ start: '2026-08-12T14:00:00+02:00', end: '2026-08-12T14:30:00+02:00' }])
        })

        test('does not invent a same-day policy when no public meeting settings were saved', async () => {
            setCalendarClient('p1')

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-08-12T14:00:00+02:00',
                timeMax: '2026-08-12T17:00:00+02:00',
                maxOptions: 1,
                minFreeHoursPerDay: 0,
                respectPublicMeetingLinkSettings: true,
            })

            expect(result.options).toEqual([{ start: '2026-08-12T14:00:00+02:00', end: '2026-08-12T14:30:00+02:00' }])
        })

        test('fails closed when emailed availability settings cannot be read', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
            firestoreState.bookingSettingsErrors['user-1'] = new Error('firestore unavailable')
            const client = setCalendarClient('p1')

            const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
                userId: 'user-1',
                timeMin: '2026-08-12T14:00:00+02:00',
                timeMax: '2026-08-13T17:00:00+02:00',
                respectPublicMeetingLinkSettings: true,
            })

            expect(result).toMatchObject({
                success: false,
                options: [],
                message: 'Meeting availability settings could not be checked right now. Please try again later.',
            })
            expect(client.events.list).not.toHaveBeenCalled()
            warnSpy.mockRestore()
        })
    })

    test('fails closed when any connected calendar cannot be checked', async () => {
        setUser('user-1', {
            timezone: 'Europe/Berlin',
            projectIds: ['p1', 'p2'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
                p2: { calendar: true, calendarEmail: 'two@example.com' },
            },
        })

        setCalendarClient('p1')
        const failingClient = setCalendarClient('p2')
        failingClient.events.list.mockRejectedValue(new Error('provider account private@example.com failed'))

        const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00+01:00',
            timeMax: '2026-03-10T12:00:00+01:00',
        })

        expect(result).toMatchObject({
            success: false,
            options: [],
            searchedCalendarCount: 1,
            failedCalendarCount: 1,
            message: 'Calendar availability could not be checked completely. Please reconnect Calendar and try again.',
        })
        expect(JSON.stringify(result)).not.toContain('private@example.com')
    })

    test('fails closed when a busy event has invalid timing', async () => {
        setUser('user-1', {
            timezone: 'Europe/Berlin',
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.list.mockResolvedValue({
            data: {
                items: [
                    {
                        status: 'confirmed',
                        start: { dateTime: 'invalid' },
                        end: { dateTime: '2026-03-10T11:00:00+01:00' },
                    },
                ],
            },
        })

        const result = await assistantCalendarTools.findCalendarAvailabilityForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00+01:00',
            timeMax: '2026-03-10T12:00:00+01:00',
        })

        expect(result).toMatchObject({
            success: false,
            options: [],
            searchedCalendarCount: 0,
            failedCalendarCount: 1,
        })
    })

    test('creates timed and all-day calendar events', async () => {
        setUser('user-1', {
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.insert
            .mockResolvedValueOnce({
                data: {
                    id: 'evt-timed',
                    summary: 'Timed Event',
                    start: { dateTime: '2026-03-11T09:00:00+01:00', timeZone: 'Europe/Berlin' },
                    end: { dateTime: '2026-03-11T10:00:00+01:00', timeZone: 'Europe/Berlin' },
                },
            })
            .mockResolvedValueOnce({
                data: {
                    id: 'evt-allday',
                    summary: 'All Day',
                    start: { date: '2026-03-12' },
                    end: { date: '2026-03-13' },
                },
            })

        const timedResult = await assistantCalendarTools.createCalendarEventForAssistantRequest({
            userId: 'user-1',
            summary: 'Timed Event',
            start: '2026-03-11T09:00:00+01:00',
            end: '2026-03-11T10:00:00+01:00',
            timeZone: 'Europe/Berlin',
        })

        const allDayResult = await assistantCalendarTools.createCalendarEventForAssistantRequest({
            userId: 'user-1',
            summary: 'All Day',
            start: { date: '2026-03-12' },
            end: { date: '2026-03-13' },
        })

        expect(timedResult.success).toBe(true)
        expect(client.events.insert.mock.calls[0][0]).toMatchObject({
            calendarId: 'primary',
            requestBody: {
                summary: 'Timed Event',
                start: { dateTime: '2026-03-11T09:00:00+01:00', timeZone: 'Europe/Berlin' },
                end: { dateTime: '2026-03-11T10:00:00+01:00', timeZone: 'Europe/Berlin' },
            },
        })
        expect(allDayResult.success).toBe(true)
        expect(client.events.insert.mock.calls[1][0]).toMatchObject({
            requestBody: {
                summary: 'All Day',
                start: { date: '2026-03-12' },
                end: { date: '2026-03-13' },
            },
        })
    })

    test('falls back to the user IANA timezone for timed events without an explicit offset', async () => {
        setUser('user-1', {
            projectIds: ['p1'],
            preferredTimezone: 'Europe/Berlin',
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.insert.mockResolvedValue({
            data: {
                id: 'evt-iana',
                summary: 'Local Time Event',
                start: { dateTime: '2026-03-11T09:00:00', timeZone: 'Europe/Berlin' },
                end: { dateTime: '2026-03-11T10:00:00', timeZone: 'Europe/Berlin' },
            },
        })

        const result = await assistantCalendarTools.createCalendarEventForAssistantRequest({
            userId: 'user-1',
            summary: 'Local Time Event',
            start: '2026-03-11T09:00:00',
            end: '2026-03-11T10:00:00',
        })

        expect(result.success).toBe(true)
        expect(client.events.insert).toHaveBeenCalledWith({
            calendarId: 'primary',
            requestBody: {
                summary: 'Local Time Event',
                start: { dateTime: '2026-03-11T09:00:00', timeZone: 'Europe/Berlin' },
                end: { dateTime: '2026-03-11T10:00:00', timeZone: 'Europe/Berlin' },
                conferenceData: {
                    createRequest: {
                        requestId: expect.any(String),
                        conferenceSolutionKey: { type: 'hangoutsMeet' },
                    },
                },
            },
            conferenceDataVersion: 1,
        })
    })

    test('rejects timed events without offset when no IANA timezone is available', async () => {
        setUser('user-1', {
            projectIds: ['p1'],
            timezone: 60,
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        })

        setCalendarClient('p1')

        await expect(
            assistantCalendarTools.createCalendarEventForAssistantRequest({
                userId: 'user-1',
                summary: 'Missing Timezone',
                start: '2026-03-11T09:00:00',
                end: '2026-03-11T10:00:00',
            })
        ).rejects.toThrow('missing timezone information')
    })

    test('updates calendar events with patch semantics', async () => {
        setUser('user-1', {
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.patch.mockResolvedValue({
            data: {
                id: 'evt-1',
                summary: 'Renamed Event',
                location: 'Room 2',
                start: { dateTime: '2026-03-11T11:00:00+01:00' },
                end: { dateTime: '2026-03-11T12:00:00+01:00' },
            },
        })

        const result = await assistantCalendarTools.updateCalendarEventForAssistantRequest({
            userId: 'user-1',
            eventId: 'evt-1',
            summary: 'Renamed Event',
            location: 'Room 2',
            start: '2026-03-11T11:00:00+01:00',
            end: '2026-03-11T12:00:00+01:00',
        })

        expect(result.success).toBe(true)
        expect(client.events.patch).toHaveBeenCalledWith({
            calendarId: 'primary',
            eventId: 'evt-1',
            requestBody: {
                summary: 'Renamed Event',
                location: 'Room 2',
                start: { dateTime: '2026-03-11T11:00:00+01:00' },
                end: { dateTime: '2026-03-11T12:00:00+01:00' },
            },
        })
    })

    test('deletes calendar events by exact eventId', async () => {
        setUser('user-1', {
            projectIds: ['p1'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com' },
            },
        })

        const client = setCalendarClient('p1')
        client.events.delete.mockResolvedValue({})

        const result = await assistantCalendarTools.deleteCalendarEventForAssistantRequest({
            userId: 'user-1',
            eventId: 'evt-1',
        })

        expect(result.success).toBe(true)
        expect(client.events.delete).toHaveBeenCalledWith({
            calendarId: 'primary',
            eventId: 'evt-1',
        })
    })

    test('returns a disambiguation error for multi-account writes without calendarId', async () => {
        setUser('user-1', {
            projectIds: ['p1', 'p2'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com', calendarDefault: false },
                p2: { calendar: true, calendarEmail: 'two@example.com', calendarDefault: false },
            },
        })

        setCalendarClient('p1')
        setCalendarClient('p2')

        const result = await assistantCalendarTools.createCalendarEventForAssistantRequest({
            userId: 'user-1',
            summary: 'Ambiguous',
            start: '2026-03-11T09:00:00+01:00',
            end: '2026-03-11T10:00:00+01:00',
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('calendar_account_ambiguous')
    })

    test('prefers the default calendar account for creates when multiple are connected', async () => {
        setUser('user-1', {
            projectIds: ['p1', 'p2'],
            apisConnected: {
                p1: { calendar: true, calendarEmail: 'one@example.com', calendarDefault: false },
                p2: { calendar: true, calendarEmail: 'two@example.com', calendarDefault: true },
            },
        })

        setCalendarClient('p1')
        const defaultClient = setCalendarClient('p2')
        defaultClient.events.insert.mockResolvedValue({
            data: {
                id: 'evt-default',
                summary: 'Default Event',
                start: { dateTime: '2026-03-11T09:00:00+01:00' },
                end: { dateTime: '2026-03-11T10:00:00+01:00' },
            },
        })

        const result = await assistantCalendarTools.createCalendarEventForAssistantRequest({
            userId: 'user-1',
            summary: 'Default Event',
            start: '2026-03-11T09:00:00+01:00',
            end: '2026-03-11T10:00:00+01:00',
        })

        expect(result.success).toBe(true)
        expect(result.projectId).toBe('p2')
        expect(defaultClient.events.insert).toHaveBeenCalled()
        expect(calendarClients.p1.events.insert).not.toHaveBeenCalled()
    })

    // AT-2198: every meeting Anna books must come with a join link already attached.
    describe('automatic Google Meet conferencing', () => {
        function connectSingleAccount() {
            setUser('user-1', {
                projectIds: ['p1'],
                apisConnected: { p1: { calendar: true, calendarEmail: 'one@example.com' } },
            })
            return setCalendarClient('p1')
        }

        const TIMED_EVENT = {
            userId: 'user-1',
            summary: 'Meeting with Karsten',
            start: '2026-03-11T09:00:00+01:00',
            end: '2026-03-11T10:00:00+01:00',
        }

        function meetEventResponse(overrides = {}) {
            return {
                data: {
                    id: 'evt-meet',
                    summary: 'Meeting with Karsten',
                    start: { dateTime: '2026-03-11T09:00:00+01:00' },
                    end: { dateTime: '2026-03-11T10:00:00+01:00' },
                    hangoutLink: 'https://meet.google.com/abc-defg-hij',
                    conferenceData: {
                        createRequest: { status: { statusCode: 'success' } },
                        entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }],
                    },
                    ...overrides,
                },
            }
        }

        test('requests a Meet conference and returns the join URL', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockResolvedValue(meetEventResponse())

            const result = await assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)

            expect(result.success).toBe(true)
            expect(result.joinUrl).toBe('https://meet.google.com/abc-defg-hij')
            expect(result.joinProvider).toBe('google_meet')
            expect(result.provider).toBe('google')

            const insertArgs = client.events.insert.mock.calls[0][0]
            // Without conferenceDataVersion:1 Google silently ignores conferenceData.
            expect(insertArgs.conferenceDataVersion).toBe(1)
            expect(insertArgs.requestBody.conferenceData.createRequest.conferenceSolutionKey).toEqual({
                type: 'hangoutsMeet',
            })
            expect(insertArgs.requestBody.conferenceData.createRequest.requestId).toEqual(expect.any(String))
        })

        test('uses a unique conference requestId per event', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockResolvedValue(meetEventResponse())

            await assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)
            await assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)

            const [first, second] = client.events.insert.mock.calls.map(
                call => call[0].requestBody.conferenceData.createRequest.requestId
            )
            expect(first).not.toBe(second)
        })

        test('exposes the Meet link on the normalized event so downstream readers see it', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockResolvedValue(meetEventResponse())

            const result = await assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)

            expect(result.event.hangoutLink).toBe('https://meet.google.com/abc-defg-hij')
            expect(result.event.conferenceData).toBeTruthy()
        })

        // A Workspace policy can disable Meet. The booking must still succeed.
        test('falls back to a plain event when Google rejects conferencing', async () => {
            const client = connectSingleAccount()
            const rejection = Object.assign(new Error('Invalid conference type value.'), { code: 403 })
            client.events.insert.mockRejectedValueOnce(rejection).mockResolvedValueOnce({
                data: {
                    id: 'evt-plain',
                    summary: 'Meeting with Karsten',
                    start: { dateTime: '2026-03-11T09:00:00+01:00' },
                    end: { dateTime: '2026-03-11T10:00:00+01:00' },
                },
            })

            const result = await assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)

            expect(result.success).toBe(true)
            expect(result.joinUrl).toBe('')
            expect(result.event.eventId).toBe('evt-plain')
            expect(client.events.insert).toHaveBeenCalledTimes(2)
            // The retry must not carry conferencing fields.
            const retryArgs = client.events.insert.mock.calls[1][0]
            expect(retryArgs.requestBody.conferenceData).toBeUndefined()
            expect(retryArgs.conferenceDataVersion).toBeUndefined()
        })

        // A 5xx may have created the event server-side; retrying could double-book.
        test('does not retry a transient failure', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockRejectedValue(Object.assign(new Error('Backend Error'), { code: 500 }))

            await expect(assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)).rejects.toThrow(
                'Backend Error'
            )
            expect(client.events.insert).toHaveBeenCalledTimes(1)
        })

        test('succeeds without a link when Google reports a failed conference', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockResolvedValue(
                meetEventResponse({
                    hangoutLink: undefined,
                    conferenceData: { createRequest: { status: { statusCode: 'failure' } } },
                })
            )

            const result = await assistantCalendarTools.createCalendarEventForAssistantRequest(TIMED_EVENT)

            expect(result.success).toBe(true)
            expect(result.joinUrl).toBe('')
            expect(client.events.insert).toHaveBeenCalledTimes(1)
        })

        // Holidays and vacations are not meetings.
        test('does not add conferencing to all-day events', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockResolvedValue({
                data: {
                    id: 'evt-allday',
                    summary: 'Vacation',
                    start: { date: '2026-03-12' },
                    end: { date: '2026-03-13' },
                },
            })

            await assistantCalendarTools.createCalendarEventForAssistantRequest({
                userId: 'user-1',
                summary: 'Vacation',
                start: { date: '2026-03-12' },
                end: { date: '2026-03-13' },
            })

            const insertArgs = client.events.insert.mock.calls[0][0]
            expect(insertArgs.requestBody.conferenceData).toBeUndefined()
            expect(insertArgs.conferenceDataVersion).toBeUndefined()
        })

        test('honours the internal addConferencing opt-out', async () => {
            const client = connectSingleAccount()
            client.events.insert.mockResolvedValue(meetEventResponse())

            await assistantCalendarTools.createCalendarEventForAssistantRequest({
                ...TIMED_EVENT,
                addConferencing: false,
            })

            expect(client.events.insert.mock.calls[0][0].requestBody.conferenceData).toBeUndefined()
        })
    })

    test('returns reconnect guidance when no calendar account is connected', async () => {
        setUser('user-1', {
            projectIds: ['p1'],
            apisConnected: {},
        })

        const result = await assistantCalendarTools.searchCalendarEventsForAssistantRequest({
            userId: 'user-1',
            query: 'anything',
        })

        expect(result.success).toBe(false)
        expect(result.message).toMatch(/Please connect Calendar first/)
    })
})
