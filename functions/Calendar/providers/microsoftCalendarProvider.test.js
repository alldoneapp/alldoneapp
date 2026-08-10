'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('../../MicrosoftGraph/graphClient', () => {
    const actual = jest.requireActual('../../MicrosoftGraph/graphClient')
    return {
        ...actual,
        getMicrosoftGraphClient: jest.fn(),
    }
})

const admin = require('firebase-admin')
const { getMicrosoftGraphClient } = require('../../MicrosoftGraph/graphClient')
const {
    createMicrosoftCalendarEventForAssistantRequest,
    getMicrosoftCalendarBusyIntervalsForAssistantRequest,
} = require('./microsoftCalendarProvider')

describe('microsoftCalendarProvider availability', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.firestore.mockReturnValue({
            collection: jest.fn(name => {
                if (name !== 'users') throw new Error(`Unexpected collection: ${name}`)
                return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({
                                projectIds: ['project-1'],
                                apisConnected: {
                                    'project-1': {
                                        calendar: true,
                                        calendarProvider: 'microsoft',
                                        calendarEmail: 'owner@example.com',
                                    },
                                },
                            }),
                        }),
                    })),
                }
            }),
        })
    })

    test('requests and returns only busy timing fields', async () => {
        const request = jest
            .fn()
            .mockResolvedValueOnce({
                '@odata.nextLink':
                    'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=private-pagination-token',
                value: [
                    {
                        subject: 'Private meeting',
                        attendees: [{ emailAddress: { address: 'secret@example.com' } }],
                        showAs: 'busy',
                        isCancelled: false,
                        start: { dateTime: '2026-03-10T10:00:00', timeZone: 'UTC' },
                        end: { dateTime: '2026-03-10T11:00:00', timeZone: 'UTC' },
                    },
                    {
                        subject: 'Free event',
                        showAs: 'free',
                        isCancelled: false,
                        start: { dateTime: '2026-03-10T12:00:00', timeZone: 'UTC' },
                        end: { dateTime: '2026-03-10T13:00:00', timeZone: 'UTC' },
                    },
                ],
            })
            .mockResolvedValueOnce({
                value: [
                    {
                        subject: 'Second private meeting',
                        showAs: 'busy',
                        isCancelled: false,
                        start: { dateTime: '2026-03-10T14:00:00', timeZone: 'UTC' },
                        end: { dateTime: '2026-03-10T15:00:00', timeZone: 'UTC' },
                    },
                ],
            })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        const result = await getMicrosoftCalendarBusyIntervalsForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00.000Z',
            timeMax: '2026-03-10T17:00:00.000Z',
        })

        expect(result.searchedCalendarCount).toBe(1)
        expect(result.failedCalendarCount).toBe(0)
        expect(result.busyIntervals).toHaveLength(2)
        expect(JSON.stringify(result)).not.toMatch(
            /Private meeting|Second private meeting|secret@example.com|owner@example.com/
        )
        expect(request.mock.calls[0][0]).toContain('%24select=start%2Cend%2CshowAs%2CisCancelled%2CisAllDay')
        expect(request.mock.calls[1][0]).toBe('/me/calendarView?$skiptoken=private-pagination-token')
    })

    test('ignores all-day and multi-day events while timed same-day events remain busy', async () => {
        const request = jest.fn().mockResolvedValue({
            value: [
                {
                    showAs: 'busy',
                    isCancelled: false,
                    isAllDay: true,
                    start: { dateTime: '2026-03-10T00:00:00', timeZone: 'UTC' },
                    end: { dateTime: '2026-03-11T00:00:00', timeZone: 'UTC' },
                },
                {
                    showAs: 'busy',
                    isCancelled: false,
                    isAllDay: false,
                    start: { dateTime: '2026-03-10T09:00:00', timeZone: 'UTC' },
                    end: { dateTime: '2026-03-11T11:00:00', timeZone: 'UTC' },
                },
                {
                    showAs: 'busy',
                    isCancelled: false,
                    isAllDay: false,
                    start: { dateTime: '2026-03-10T10:00:00', timeZone: 'UTC' },
                    end: { dateTime: '2026-03-10T10:30:00', timeZone: 'UTC' },
                },
            ],
        })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        const result = await getMicrosoftCalendarBusyIntervalsForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00.000Z',
            timeMax: '2026-03-10T17:00:00.000Z',
        })

        expect(result).toEqual({
            busyIntervals: [
                {
                    startMs: Date.parse('2026-03-10T10:00:00.000Z'),
                    endMs: Date.parse('2026-03-10T10:30:00.000Z'),
                },
            ],
            searchedCalendarCount: 1,
            failedCalendarCount: 0,
        })
    })

    test('fails the account check when a busy event has invalid timing', async () => {
        const request = jest.fn().mockResolvedValue({
            value: [
                {
                    showAs: 'busy',
                    isCancelled: false,
                    start: { dateTime: 'invalid', timeZone: 'UTC' },
                    end: { dateTime: '2026-03-10T11:00:00', timeZone: 'UTC' },
                },
            ],
        })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        const result = await getMicrosoftCalendarBusyIntervalsForAssistantRequest({
            userId: 'user-1',
            timeMin: '2026-03-10T09:00:00.000Z',
            timeMax: '2026-03-10T17:00:00.000Z',
        })

        expect(result).toEqual({
            busyIntervals: [],
            searchedCalendarCount: 0,
            failedCalendarCount: 1,
        })
    })
})

// AT-2198: Google Meet cannot be provisioned on a Microsoft calendar, so a
// Teams online meeting is the equivalent guarantee.
describe('microsoftCalendarProvider automatic Teams conferencing', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.firestore.mockReturnValue({
            collection: jest.fn(name => {
                if (name !== 'users') throw new Error(`Unexpected collection: ${name}`)
                return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({
                                projectIds: ['project-1'],
                                apisConnected: {
                                    'project-1': {
                                        calendar: true,
                                        calendarProvider: 'microsoft',
                                        calendarEmail: 'owner@example.com',
                                    },
                                },
                            }),
                        }),
                    })),
                }
            }),
        })
    })

    const TIMED_EVENT = {
        userId: 'user-1',
        summary: 'Meeting with Karsten',
        start: '2026-03-11T09:00:00+01:00',
        end: '2026-03-11T10:00:00+01:00',
        timeZone: 'Europe/Berlin',
    }

    const TEAMS_JOIN_URL = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0'

    function parseBody(request, callIndex = 0) {
        return JSON.parse(request.mock.calls[callIndex][1].body)
    }

    test('asks Graph for a Teams meeting and returns the join URL', async () => {
        const request = jest.fn().mockResolvedValue({
            id: 'evt-teams',
            subject: 'Meeting with Karsten',
            start: { dateTime: '2026-03-11T09:00:00', timeZone: 'Europe/Berlin' },
            end: { dateTime: '2026-03-11T10:00:00', timeZone: 'Europe/Berlin' },
            onlineMeeting: { joinUrl: TEAMS_JOIN_URL },
        })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        const result = await createMicrosoftCalendarEventForAssistantRequest(TIMED_EVENT)

        expect(result.success).toBe(true)
        expect(result.joinUrl).toBe(TEAMS_JOIN_URL)
        expect(result.joinProvider).toBe('teams')
        expect(parseBody(request)).toMatchObject({
            isOnlineMeeting: true,
            onlineMeetingProvider: 'teamsForBusiness',
        })
    })

    test('falls back to a plain event when the tenant refuses online meetings', async () => {
        const request = jest
            .fn()
            .mockRejectedValueOnce(new Error('Online meeting is not enabled for this tenant'))
            .mockResolvedValueOnce({
                id: 'evt-plain',
                subject: 'Meeting with Karsten',
                start: { dateTime: '2026-03-11T09:00:00', timeZone: 'Europe/Berlin' },
                end: { dateTime: '2026-03-11T10:00:00', timeZone: 'Europe/Berlin' },
            })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        const result = await createMicrosoftCalendarEventForAssistantRequest(TIMED_EVENT)

        expect(result.success).toBe(true)
        expect(result.joinUrl).toBe('')
        expect(result.event.eventId).toBe('evt-plain')
        expect(request).toHaveBeenCalledTimes(2)
        expect(parseBody(request, 1).isOnlineMeeting).toBeUndefined()
    })

    test('propagates an unrelated failure instead of retrying', async () => {
        const request = jest.fn().mockRejectedValue(new Error('socket hang up'))
        getMicrosoftGraphClient.mockResolvedValue({ request })

        await expect(createMicrosoftCalendarEventForAssistantRequest(TIMED_EVENT)).rejects.toThrow('socket hang up')
        expect(request).toHaveBeenCalledTimes(1)
    })

    test('does not add conferencing to all-day events', async () => {
        const request = jest.fn().mockResolvedValue({ id: 'evt-allday', subject: 'Vacation' })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        await createMicrosoftCalendarEventForAssistantRequest({
            userId: 'user-1',
            summary: 'Vacation',
            start: { date: '2026-03-12' },
            end: { date: '2026-03-13' },
        })

        expect(parseBody(request).isOnlineMeeting).toBeUndefined()
    })
})
