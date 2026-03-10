jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('googleapis', () => ({
    google: {
        calendar: jest.fn(),
    },
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: jest.fn(),
    getOAuth2Client: jest.fn(),
}))

const admin = require('firebase-admin')
const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')

const firestoreState = {
    users: {},
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
    }
}

function createOAuthClient() {
    return {
        __projectId: null,
        setCredentials(credentials) {
            this.__projectId = String(credentials.access_token || '').replace(/^token-/, '')
        },
    }
}

describe('assistantCalendarTools', () => {
    let assistantCalendarTools

    beforeEach(() => {
        firestoreState.users = {}
        Object.keys(calendarClients).forEach(key => delete calendarClients[key])
        jest.clearAllMocks()

        admin.firestore.mockImplementation(() => buildFirestore())
        getAccessToken.mockImplementation((userId, projectId) => Promise.resolve(`token-${projectId}`))
        getOAuth2Client.mockImplementation(() => createOAuthClient())
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
