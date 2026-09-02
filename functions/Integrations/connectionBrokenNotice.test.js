'use strict'

// AT-2491. Nothing ever told a user that a connected account had stopped working — the
// breakage was recorded on the user document and only Settings > Integrations read it. A
// production Gmail connection was dead for four days with every label sweep and email-line
// summary failing silently.

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({})),
}))

const {
    notifyUserBrokenConnections,
    sweepBrokenConnectionNotices,
    NOTICE_FIELD,
    __private__,
} = require('./connectionBrokenNotice')
const { buildConnectionId } = require('./providerConnections')

const { findConnectionsNeedingNotice, buildNoticeCommentId, buildNoticeText } = __private__

const USER_ID = 'user-1'
const EMAIL = 'karsten.wysk@gmail.com'
const CONNECTION_ID = buildConnectionId('email', 'google', EMAIL)
const CALENDAR_CONNECTION_ID = buildConnectionId('calendar', 'google', EMAIL)
const NOW = Date.UTC(2026, 8, 2, 12, 0, 0)
const BROKE_AT = Date.UTC(2026, 7, 29, 10, 59, 5)

function userData(overrides = {}) {
    return {
        defaultProjectId: 'project-1',
        assistantId: 'assistant-1',
        emailConnections: {
            [CONNECTION_ID]: {
                provider: 'google',
                emailAddress: EMAIL,
                defaultProjectId: 'project-1',
                isDefaultAccount: true,
                authInvalid: true,
                authInvalidAt: BROKE_AT,
            },
        },
        ...overrides,
    }
}

function makeHarness() {
    const updates = []
    const notificationDocs = []
    const stored = []
    const db = {
        doc: jest.fn(path => ({
            update: jest.fn(async update => {
                updates.push({ path, update })
            }),
            set: jest.fn(async data => {
                notificationDocs.push({ path, data })
            }),
        })),
    }
    return {
        db,
        updates,
        notificationDocs,
        stored,
        deps: {
            db,
            now: NOW,
            getBaseUrl: () => 'https://my.alldone.app',
            getOrCreateWhatsAppDailyTopic: jest.fn(async () => ({ chatId: 'BotChat02092026user-1' })),
            storeAssistantMessageInTopicOnce: jest.fn(async params => {
                stored.push(params)
                return { commentId: params.commentId, stored: true }
            }),
        },
    }
}

describe('findConnectionsNeedingNotice', () => {
    test('reports a broken connection that has never been announced', () => {
        expect(findConnectionsNeedingNotice(userData()).map(c => c.connectionId)).toEqual([CONNECTION_ID])
    })

    test('says nothing about a healthy connection', () => {
        const data = userData()
        data.emailConnections[CONNECTION_ID].authInvalid = false

        expect(findConnectionsNeedingNotice(data)).toEqual([])
    })

    test('does not repeat itself once the user has been told', () => {
        const data = userData({ [NOTICE_FIELD]: { [CONNECTION_ID]: BROKE_AT + 1000 } })

        expect(findConnectionsNeedingNotice(data)).toEqual([])
    })

    test('announces a SECOND breakage after a reconnect', () => {
        // Reconnected (marker stamped), then broke again — a newer authInvalidAt is the
        // only thing that distinguishes this from the case above.
        const data = userData({ [NOTICE_FIELD]: { [CONNECTION_ID]: BROKE_AT - 1000 } })

        expect(findConnectionsNeedingNotice(data).map(c => c.connectionId)).toEqual([CONNECTION_ID])
    })

    test('tells the user exactly once about a breakage whose date was never recorded', () => {
        // Every connection flagged before AT-2491 started stamping authInvalidAt — including
        // the reported one. With no marker it is announced; with a marker it never repeats,
        // because an unknown breakage time can never be "newer".
        const data = userData()
        delete data.emailConnections[CONNECTION_ID].authInvalidAt

        expect(findConnectionsNeedingNotice(data).map(c => c.connectionId)).toEqual([CONNECTION_ID])

        const afterNotice = userData({ [NOTICE_FIELD]: { [CONNECTION_ID]: NOW } })
        delete afterNotice.emailConnections[CONNECTION_ID].authInvalidAt
        expect(findConnectionsNeedingNotice(afterNotice)).toEqual([])
    })

    test('covers calendar connections as well as email', () => {
        const data = userData({
            calendarConnections: {
                [CALENDAR_CONNECTION_ID]: {
                    provider: 'google',
                    emailAddress: EMAIL,
                    defaultProjectId: 'project-1',
                    authInvalid: true,
                },
            },
        })

        expect(findConnectionsNeedingNotice(data).map(c => c.service)).toEqual(['email', 'calendar'])
    })
})

describe('the message itself', () => {
    test('names the account, the consequence and where to fix it', () => {
        const [connection] = findConnectionsNeedingNotice(userData())
        const text = buildNoticeText(connection, 'https://my.alldone.app')

        expect(text).toContain(EMAIL)
        expect(text).toContain('Emails are no longer being read')
        expect(text).toContain('https://my.alldone.app/settings/integrations')
    })

    test('describes a calendar breakage in calendar terms', () => {
        const text = buildNoticeText({ service: 'calendar', emailAddress: EMAIL }, 'https://my.alldone.app')

        expect(text).toContain('Events are no longer being synced')
        expect(text).not.toContain('Emails are no longer')
    })

    test('keys the comment id to the breakage, so a retry cannot post a duplicate', () => {
        const [connection] = findConnectionsNeedingNotice(userData())

        expect(buildNoticeCommentId(connection)).toBe(`conn-broken-${CONNECTION_ID}-${BROKE_AT}`)
        // A later, separate breakage of the same account gets its own id.
        expect(buildNoticeCommentId({ ...connection, authInvalidAt: BROKE_AT + 1 })).not.toBe(
            buildNoticeCommentId(connection)
        )
    })
})

describe('notifyUserBrokenConnections', () => {
    test('posts into the daily topic, badges it unread and records the marker', async () => {
        const harness = makeHarness()

        const result = await notifyUserBrokenConnections({ userId: USER_ID, userData: userData(), ...harness.deps })

        expect(result).toEqual({ notified: 1, skipped: 0 })
        expect(harness.stored).toHaveLength(1)
        expect(harness.stored[0].projectId).toBe('project-1')
        expect(harness.stored[0].assistantId).toBe('assistant-1')
        expect(harness.stored[0].responseText).toContain(EMAIL)
        expect(harness.stored[0].extraCommentFields.isSystemNotice).toBe(true)

        // The unread badge is a separate document; without it the message sits there
        // looking already-read.
        expect(harness.notificationDocs).toHaveLength(1)
        expect(harness.notificationDocs[0].path).toContain(`chatNotifications/project-1/${USER_ID}/`)
        expect(harness.notificationDocs[0].data.followed).toBe(true)

        expect(harness.updates).toEqual([
            { path: `users/${USER_ID}`, update: { [`${NOTICE_FIELD}.${CONNECTION_ID}`]: NOW } },
        ])
    })

    test('does nothing at all for a healthy user', async () => {
        const harness = makeHarness()
        const data = userData()
        data.emailConnections[CONNECTION_ID].authInvalid = false

        await expect(
            notifyUserBrokenConnections({ userId: USER_ID, userData: data, ...harness.deps })
        ).resolves.toEqual({ notified: 0, skipped: 0 })
        expect(harness.deps.getOrCreateWhatsAppDailyTopic).not.toHaveBeenCalled()
    })

    test('records no marker when there is nowhere to post, so the user is told later', async () => {
        const harness = makeHarness()
        const data = userData({ assistantId: '' })

        const result = await notifyUserBrokenConnections({ userId: USER_ID, userData: data, ...harness.deps })

        expect(result.notified).toBe(0)
        expect(harness.updates).toEqual([])
    })

    test('a failed post leaves no marker, so it is retried rather than lost', async () => {
        const harness = makeHarness()
        harness.deps.storeAssistantMessageInTopicOnce = jest.fn(async () => {
            throw new Error('topic write failed')
        })
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

        const result = await notifyUserBrokenConnections({ userId: USER_ID, userData: userData(), ...harness.deps })

        expect(result).toEqual({ notified: 0, skipped: 1 })
        expect(harness.updates).toEqual([])
        consoleError.mockRestore()
    })

    test('one failing connection does not silence the others', async () => {
        const harness = makeHarness()
        let call = 0
        harness.deps.storeAssistantMessageInTopicOnce = jest.fn(async params => {
            call++
            if (call === 1) throw new Error('transient')
            return { commentId: params.commentId, stored: true }
        })
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const data = userData({
            calendarConnections: {
                [CALENDAR_CONNECTION_ID]: {
                    provider: 'google',
                    emailAddress: EMAIL,
                    defaultProjectId: 'project-1',
                    authInvalid: true,
                },
            },
        })

        const result = await notifyUserBrokenConnections({ userId: USER_ID, userData: data, ...harness.deps })

        expect(result).toEqual({ notified: 1, skipped: 1 })
        // Only the one that actually went out is marked as told.
        expect(Object.keys(harness.updates[0].update)).toEqual([`${NOTICE_FIELD}.${CALENDAR_CONNECTION_ID}`])
        consoleError.mockRestore()
    })
})

describe('sweepBrokenConnectionNotices', () => {
    const makeDb = docs => ({
        collection: () => ({
            where: () => ({
                limit: () => ({ get: async () => ({ docs }) }),
            }),
        }),
    })

    test('processes recently active users and reports what it sent', async () => {
        const notifyUser = jest.fn(async () => ({ notified: 1, skipped: 0 }))
        const db = makeDb([{ id: USER_ID, data: () => ({ lastLogin: NOW - 1000 }) }])

        await expect(sweepBrokenConnectionNotices({ now: NOW, db, notifyUser })).resolves.toEqual({
            activeUsers: 1,
            notifiedUsers: 1,
            notifiedConnections: 1,
        })
    })

    test('re-checks activity itself, because a stored Timestamp sorts apart from a number', async () => {
        const notifyUser = jest.fn(async () => ({ notified: 1, skipped: 0 }))
        const db = makeDb([{ id: USER_ID, data: () => ({ lastLogin: NOW - 400 * 24 * 60 * 60 * 1000 }) }])

        await expect(sweepBrokenConnectionNotices({ now: NOW, db, notifyUser })).resolves.toEqual({
            activeUsers: 1,
            notifiedUsers: 0,
            notifiedConnections: 0,
        })
        expect(notifyUser).not.toHaveBeenCalled()
    })

    test('one broken user does not abort the sweep', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const notifyUser = jest
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ notified: 2, skipped: 0 })
        const db = makeDb([
            { id: 'user-a', data: () => ({ lastLogin: NOW - 1000 }) },
            { id: 'user-b', data: () => ({ lastLogin: NOW - 1000 }) },
        ])

        await expect(sweepBrokenConnectionNotices({ now: NOW, db, notifyUser })).resolves.toEqual({
            activeUsers: 2,
            notifiedUsers: 1,
            notifiedConnections: 2,
        })
        consoleError.mockRestore()
    })
})
