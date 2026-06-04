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
const { getMicrosoftCalendarBusyIntervalsForAssistantRequest } = require('./microsoftCalendarProvider')

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
        expect(request.mock.calls[0][0]).toContain('%24select=start%2Cend%2CshowAs%2CisCancelled')
        expect(request.mock.calls[1][0]).toBe('/me/calendarView?$skiptoken=private-pagination-token')
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
