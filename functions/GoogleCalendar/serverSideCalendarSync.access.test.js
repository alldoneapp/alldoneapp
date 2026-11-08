'use strict'

// Security audit 2026-11: a calendar connection's project key is the user's own, owner-writable
// record. The sync writes events as project-public tasks with the Admin SDK, so it must check the
// project's own member list before it touches the provider or the project.

const mockDocs = new Map()
const mockGetAuthorizedOAuth2Client = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: () => ({
        collection: name => ({
            doc: id => ({
                get: async () => {
                    const data = mockDocs.get(`${name}/${id}`)
                    return { exists: data !== undefined, data: () => data }
                },
            }),
        }),
    }),
}))
jest.mock('googleapis', () => ({ google: {} }))
jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAuthorizedOAuth2Client: (...args) => mockGetAuthorizedOAuth2Client(...args),
}))
jest.mock('../MicrosoftGraph/graphClient', () => ({ getMicrosoftGraphClient: jest.fn() }))
jest.mock('../GoogleCalendarTasks/calendarTasks', () => ({
    addCalendarEvents: jest.fn(),
    filterEvents: jest.fn(),
    removeCalendarTasks: jest.fn(),
    getRoutedCalendarEventIds: jest.fn(),
}))
jest.mock('./calendarProjectRouting', () => ({ routeCalendarEventsToProjects: jest.fn() }))

const { syncCalendarEvents } = require('./serverSideCalendarSync')

describe('syncCalendarEvents project access', () => {
    beforeEach(() => {
        mockDocs.clear()
        mockGetAuthorizedOAuth2Client.mockReset()
        mockGetAuthorizedOAuth2Client.mockRejectedValue(new Error('reached the provider'))
        mockDocs.set('users/attacker', { apisConnected: { victimProject: { calendar: true } } })
    })

    it('refuses a project that does not list the user, before contacting the provider', async () => {
        mockDocs.set('projects/victimProject', { userIds: ['victim'] })

        await expect(syncCalendarEvents('attacker', 'victimProject')).rejects.toThrow('No access to this project')
        expect(mockGetAuthorizedOAuth2Client).not.toHaveBeenCalled()
    })

    it('refuses a project that no longer exists', async () => {
        await expect(syncCalendarEvents('attacker', 'victimProject')).rejects.toThrow('No access to this project')
    })

    it('goes on to the provider for a member', async () => {
        mockDocs.set('projects/victimProject', { userIds: ['attacker'] })

        await expect(syncCalendarEvents('attacker', 'victimProject')).rejects.toThrow('reached the provider')
    })
})
