'use strict'

const mockCreateProjectIntegrationActivityFeed = jest.fn()
const mockLoadFeedsState = jest.fn(async () => {})
const mockBatchCommit = jest.fn(async () => {})
let mockNow = Date.parse('2026-11-12T09:00:00Z')
let mockIdCounter = 0

jest.mock('./projectsFeeds', () => ({
    createProjectIntegrationActivityFeed: (...args) => mockCreateProjectIntegrationActivityFeed(...args),
}))
jest.mock('../shared/contactUpdateHelper', () => ({
    loadFeedsStateForContactWrite: (...args) => mockLoadFeedsState(...args),
}))
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({ commit: mockBatchCommit })),
}))
jest.mock('./globalFeedsHelper', () => ({
    generateCurrentDateObject: () => ({ currentDateFormated: '12112026', currentMilliseconds: mockNow }),
}))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => `feed-${++mockIdCounter}` }))

const { FEED_PROJECT_EMAIL_ACTIVITY, FEED_PROJECT_CALENDAR_ACTIVITY } = require('./FeedsConstants')
const {
    BURST_WINDOW_MS,
    buildIntegrationActivity,
    formatEventStart,
    formatPeople,
    recordIntegrationToolActivity,
    resolveIntegrationFeedProject,
} = require('./integrationToolFeeds')

const BERLIN = { dateFormat: 'DD.MM.YYYY', timeZone: 'Europe/Berlin' }

// Enough Firestore for the feed layer: doc().get/set and runTransaction(get/set).
function createDb(seed = {}) {
    const store = new Map(Object.entries(seed))
    const snapshot = path => ({ exists: store.has(path), data: () => store.get(path) })
    const db = {
        store,
        doc: path => ({ path, get: async () => snapshot(path) }),
        runTransaction: async fn =>
            fn({
                get: async ref => snapshot(ref.path),
                set: (ref, data) => store.set(ref.path, data),
            }),
    }
    return db
}

function seedUser(overrides = {}) {
    return {
        'users/user-1': {
            defaultProjectId: 'default-project',
            preferredTimezone: 'Europe/Berlin',
            dateFormat: 'DD.MM.YYYY',
            emailConnections: {
                email_google_aaaa: {
                    provider: 'google',
                    emailAddress: 'karsten@acme.com',
                    defaultProjectId: 'mail-project',
                },
            },
            calendarConnections: {
                calendar_google_bbbb: {
                    provider: 'google',
                    emailAddress: 'karsten@acme.com',
                    defaultProjectId: 'calendar-project',
                },
            },
            ...overrides,
        },
        'projects/mail-project': { name: 'Sales', color: '#f00', userIds: ['user-1', 'user-2'] },
        'projects/calendar-project': { name: 'Ops', userIds: ['user-1'] },
        'projects/default-project': { name: 'Mine', userIds: ['user-1'] },
        'projects/other-project': { name: 'Not mine', userIds: ['user-2'] },
    }
}

const mcpFeedUser = { uid: 'user-1', displayName: 'Karsten Wysk', via: 'mcp', viaClient: 'Claude' }

describe('buildIntegrationActivity: what an entry says', () => {
    test('a new Gmail draft names subject and recipients, never the body or Bcc', () => {
        const activity = buildIntegrationActivity(
            'create_gmail_draft',
            { subject: 'Offer', body: 'Secret pricing inside', bcc: ['hidden@acme.com'] },
            {
                success: true,
                projectId: 'email_google_aaaa',
                subject: 'Offer',
                to: ['Anna Becker <anna@acme.com>'],
                bcc: ['hidden@acme.com'],
            }
        )
        expect(activity).toMatchObject({
            service: 'email',
            feedType: FEED_PROJECT_EMAIL_ACTIVITY,
            connectionKey: 'email_google_aaaa',
            entryText: "created a Gmail draft 'Offer' to Anna Becker",
        })
        expect(activity.entryText).not.toContain('Secret')
        expect(activity.entryText).not.toContain('hidden')
    })

    test('an Outlook draft and a reply draft say so', () => {
        expect(
            buildIntegrationActivity(
                'create_gmail_draft',
                {},
                { success: true, provider: 'microsoft', subject: 'Offer', to: ['anna@acme.com'] }
            ).entryText
        ).toBe("created an Outlook draft 'Offer' to anna@acme.com")
        expect(
            buildIntegrationActivity(
                'create_gmail_reply_draft',
                { body: 'Thanks!' },
                { success: true, targetSubject: 'Offer', to: ['Anna Becker <anna@acme.com>'] }
            ).entryText
        ).toBe("created a Gmail reply draft 'Re: Offer' to Anna Becker")
    })

    test('a draft update that changed nothing writes nothing', () => {
        const result = { success: true, subject: 'Offer', to: ['anna@acme.com'] }
        expect(buildIntegrationActivity('update_gmail_draft', { body: 'same' }, { ...result, changed: false })).toBe(
            null
        )
        expect(buildIntegrationActivity('update_gmail_draft', { draftId: 'd1' }, result)).toBe(null)
        expect(
            buildIntegrationActivity('update_gmail_draft', { body: 'new' }, { ...result, changed: true }).entryText
        ).toBe("updated the Gmail draft 'Offer' to anna@acme.com")
    })

    test('email changes read as one sentence, and as a count for a burst', () => {
        const result = {
            success: true,
            projectId: 'email_google_aaaa',
            subject: 'Invoice 42',
            changedLabels: { added: ['Finance'], removed: ['INBOX', 'UNREAD'] },
        }
        const activity = buildIntegrationActivity('update_gmail_email', { messageId: 'm1' }, result)
        expect(activity.entryText).toBe("archived the email 'Invoice 42', marked it as read and labeled it as Finance")
        expect(activity.burst.textForCount(3)).toBe(
            'archived 3 emails, marked them as read and labeled them as Finance'
        )

        const archive = buildIntegrationActivity(
            'update_gmail_email',
            {},
            {
                ...result,
                changedLabels: { added: [], removed: ['INBOX'] },
            }
        )
        expect(archive.entryText).toBe("archived the email 'Invoice 42'")
        expect(archive.burst.textForCount(3)).toBe('archived 3 emails')
        expect(archive.burst.signature).not.toBe(activity.burst.signature)

        expect(
            buildIntegrationActivity(
                'update_gmail_email',
                {},
                {
                    ...result,
                    subject: '',
                    changedLabels: { added: [], removed: ['Clients'] },
                }
            ).entryText
        ).toBe('removed the label Clients from an email')
    })

    test('an email call that changed nothing writes nothing', () => {
        expect(
            buildIntegrationActivity(
                'update_gmail_email',
                {},
                {
                    success: true,
                    subject: 'Invoice 42',
                    changedLabels: { added: [], removed: [] },
                }
            )
        ).toBe(null)
    })

    test('a classification correction names the email and the new classification', () => {
        expect(
            buildIntegrationActivity(
                'correct_email_classification',
                { correctFollowUpType: 'actionable', correctLabel: 'Finance' },
                { success: true, projectId: 'email_google_aaaa', subject: 'Invoice 42', correctLabel: 'Finance' }
            ).entryText
        ).toBe("corrected the classification of the email 'Invoice 42' to Finance (actionable)")
    })

    test('calendar events name title, time in the user zone and attendees, never the description', () => {
        const created = buildIntegrationActivity(
            'create_calendar_event',
            { summary: 'Team sync', description: 'Private agenda' },
            {
                success: true,
                projectId: 'calendar_google_bbbb',
                event: {
                    summary: 'Team sync',
                    description: 'Private agenda',
                    start: { dateTime: '2026-11-12T09:00:00Z' },
                    attendees: [{ email: 'anna@acme.com', displayName: 'Anna Becker' }, { email: 'tom@acme.com' }],
                },
            },
            BERLIN
        )
        expect(created).toMatchObject({
            service: 'calendar',
            feedType: FEED_PROJECT_CALENDAR_ACTIVITY,
            entryText: "created the calendar event 'Team sync' on 12.11.2026 10:00 with Anna Becker and tom@acme.com",
        })
        expect(created.entryText).not.toContain('Private')

        expect(
            buildIntegrationActivity(
                'update_calendar_event',
                { eventId: 'e1', start: '2026-11-13T11:00:00+01:00', end: '2026-11-13T12:00:00+01:00', attendees: [] },
                { success: true, event: { summary: 'Team sync', start: { dateTime: '2026-11-13T11:00:00+01:00' } } },
                BERLIN
            ).entryText
        ).toBe("updated the calendar event 'Team sync' • changed the time to 13.11.2026 11:00 and the attendees")

        expect(
            buildIntegrationActivity(
                'delete_calendar_event',
                { eventId: 'e1', scope: 'series' },
                {
                    success: true,
                    provider: 'microsoft',
                    summary: 'Standup',
                    start: { dateTime: '2026-11-12T08:30:00.0000000', timeZone: 'UTC' },
                },
                BERLIN
            ).entryText
        ).toBe("deleted the calendar event 'Standup' on 12.11.2026 09:30 (all occurrences)")
    })

    test('a failed call writes nothing', () => {
        expect(buildIntegrationActivity('create_calendar_event', {}, { success: false, message: 'nope' })).toBe(null)
        expect(buildIntegrationActivity('get_tasks', {}, { success: true })).toBe(null)
    })

    test('formats all-day events and long recipient lists', () => {
        expect(formatEventStart({ date: '2026-11-12' }, BERLIN)).toBe('12.11.2026')
        expect(formatPeople(['a@x.com', 'b@x.com', 'c@x.com'])).toBe('a@x.com, b@x.com and c@x.com')
        expect(formatPeople(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'])).toBe('a@x.com, b@x.com and 2 others')
    })
})

describe('resolveIntegrationFeedProject: the project the connection belongs to', () => {
    test('uses the connection project, then the default project, and only projects the user is in', async () => {
        const seed = seedUser()
        const db = createDb(seed)
        const userData = seed['users/user-1']

        await expect(
            resolveIntegrationFeedProject({
                db,
                userId: 'user-1',
                userData,
                service: 'email',
                connectionKey: 'email_google_aaaa',
            })
        ).resolves.toMatchObject({ projectId: 'mail-project', project: { name: 'Sales' } })

        await expect(
            resolveIntegrationFeedProject({
                db,
                userId: 'user-1',
                userData,
                service: 'calendar',
                connectionKey: 'calendar_google_bbbb',
            })
        ).resolves.toMatchObject({ projectId: 'calendar-project' })

        // A legacy key is the project itself, when the user is a member of it.
        await expect(
            resolveIntegrationFeedProject({
                db,
                userId: 'user-1',
                userData,
                service: 'email',
                connectionKey: 'mail-project',
            })
        ).resolves.toMatchObject({ projectId: 'mail-project' })
        await expect(
            resolveIntegrationFeedProject({
                db,
                userId: 'user-1',
                userData,
                service: 'email',
                connectionKey: 'other-project',
            })
        ).resolves.toMatchObject({ projectId: 'default-project' })

        await expect(
            resolveIntegrationFeedProject({ db, userId: 'user-1', userData, service: 'email', connectionKey: '' })
        ).resolves.toMatchObject({ projectId: 'default-project' })
    })
})

describe('recordIntegrationToolActivity', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockNow = Date.parse('2026-11-12T09:00:00Z')
        mockCreateProjectIntegrationActivityFeed.mockImplementation(async (...args) => ({
            feedId: args[6].feedId || 'generated',
        }))
    })

    test('writes one entry on the connection project, by the actor, badging only the mailbox owner', async () => {
        const db = createDb(seedUser())
        const written = await recordIntegrationToolActivity({
            db,
            toolName: 'create_calendar_event',
            toolArgs: { summary: 'Team sync' },
            result: {
                success: true,
                projectId: 'calendar_google_bbbb',
                event: { summary: 'Team sync', start: { dateTime: '2026-11-12T09:00:00Z' } },
            },
            userId: 'user-1',
            getFeedUser: async () => mcpFeedUser,
        })

        expect(written).toMatchObject({ projectId: 'calendar-project', feedType: FEED_PROJECT_CALENDAR_ACTIVITY })
        expect(mockLoadFeedsState).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'calendar-project', feedUser: mcpFeedUser, userId: 'user-1' })
        )
        expect(mockCreateProjectIntegrationActivityFeed).toHaveBeenCalledWith(
            'calendar-project',
            expect.objectContaining({ id: 'calendar-project', name: 'Ops' }),
            FEED_PROJECT_CALENDAR_ACTIVITY,
            "created the calendar event 'Team sync' on 12.11.2026 10:00",
            expect.any(Object),
            mcpFeedUser,
            expect.objectContaining({ feedId: null, notifyUserIds: ['user-1'] })
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    })

    test('a failed or unchanged call writes nothing', async () => {
        const db = createDb(seedUser())
        const getFeedUser = jest.fn(async () => mcpFeedUser)
        await recordIntegrationToolActivity({
            db,
            toolName: 'update_gmail_email',
            toolArgs: {},
            result: { success: false, message: 'No matching email' },
            userId: 'user-1',
            getFeedUser,
        })
        await recordIntegrationToolActivity({
            db,
            toolName: 'update_gmail_email',
            toolArgs: {},
            result: { success: true, changedLabels: { added: [], removed: [] } },
            userId: 'user-1',
            getFeedUser,
        })
        expect(getFeedUser).not.toHaveBeenCalled()
        expect(mockCreateProjectIntegrationActivityFeed).not.toHaveBeenCalled()
    })

    test('a burst of the same email change stays one entry with a count', async () => {
        const db = createDb(seedUser())
        const archive = subject => ({
            db,
            toolName: 'update_gmail_email',
            toolArgs: { removeLabelIds: ['INBOX'] },
            result: {
                success: true,
                projectId: 'email_google_aaaa',
                subject,
                changedLabels: { added: [], removed: ['INBOX'] },
            },
            userId: 'user-1',
            getFeedUser: async () => mcpFeedUser,
        })

        const first = await recordIntegrationToolActivity(archive('Newsletter 1'))
        mockNow += 60 * 1000
        const second = await recordIntegrationToolActivity(archive('Newsletter 2'))
        mockNow += 60 * 1000
        const third = await recordIntegrationToolActivity(archive('Newsletter 3'))

        expect(first.entryText).toBe("archived the email 'Newsletter 1'")
        expect(second.feedId).toBe(first.feedId)
        expect(third.feedId).toBe(first.feedId)
        expect(third.entryText).toBe('archived 3 emails')
        expect(mockCreateProjectIntegrationActivityFeed.mock.calls[2][6]).toMatchObject({ feedId: first.feedId })

        // After a pause the next change starts a new entry.
        mockNow += BURST_WINDOW_MS + 1
        const later = await recordIntegrationToolActivity(archive('Newsletter 4'))
        expect(later.feedId).not.toBe(first.feedId)
        expect(later.entryText).toBe("archived the email 'Newsletter 4'")
    })

    test('a feed failure never reaches the tool call', async () => {
        const db = createDb(seedUser())
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockCreateProjectIntegrationActivityFeed.mockRejectedValueOnce(new Error('boom'))
        await expect(
            recordIntegrationToolActivity({
                db,
                toolName: 'delete_calendar_event',
                toolArgs: { eventId: 'e1' },
                result: { success: true, projectId: 'calendar_google_bbbb', summary: 'X' },
                userId: 'user-1',
                getFeedUser: async () => mcpFeedUser,
            })
        ).resolves.toBe(null)
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    test('without a project the user belongs to, nothing is written', async () => {
        const db = createDb({
            'users/user-1': { defaultProjectId: 'other-project' },
            'projects/other-project': { userIds: ['user-2'] },
        })
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(
            recordIntegrationToolActivity({
                db,
                toolName: 'create_gmail_draft',
                toolArgs: {},
                result: { success: true, subject: 'Offer', to: ['anna@acme.com'] },
                userId: 'user-1',
                getFeedUser: async () => mcpFeedUser,
            })
        ).resolves.toBe(null)
        expect(mockCreateProjectIntegrationActivityFeed).not.toHaveBeenCalled()
        warn.mockRestore()
    })
})
