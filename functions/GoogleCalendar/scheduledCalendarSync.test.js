'use strict'

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const {
    SCHEDULED_SYNC_STATE_DOC,
    getCalendarConnectedProjectIds,
    getProjectIdsDueForSync,
    isUserRecentlyActive,
    syncCalendarsForActiveUsers,
    syncUserCalendars,
} = require('./scheduledCalendarSync')
const { ACTIVE_USER_WINDOW_MS } = require('../Assistant/assistantHeartbeatSchedule')

const NOW = Date.parse('2026-09-01T06:08:09.141Z')
const BERLIN_TODAY = '2026-09-01'

const CONNECTED = {
    'project-private': { calendar: true, calendarDefault: true, calendarEmail: 'me@gmail.com' },
    'project-work': { calendar: true, calendarEmail: 'me@work.com' },
    'project-off': { calendar: false, gmail: true },
}

/**
 * A Firestore double covering exactly the two shapes this module uses: the
 * `users where lastLogin >= x limit n` query and the per-user
 * `users/{uid}/private/calendarScheduledSync` doc.
 */
const buildDb = ({ users = [], syncState = {}, failStateRead = false, failStateWrite = false } = {}) => {
    const state = { ...syncState }
    const writes = []

    const stateDoc = userId => ({
        get: async () => {
            if (failStateRead) throw new Error('state read failed')
            return { exists: !!state[userId], data: () => state[userId] }
        },
        set: async (value, options) => {
            if (failStateWrite) throw new Error('state write failed')
            writes.push({ userId, value, options })
            const previous = state[userId] || {}
            state[userId] = {
                ...previous,
                ...value,
                lastSyncedLocalDateByProject: {
                    ...(previous.lastSyncedLocalDateByProject || {}),
                    ...(value.lastSyncedLocalDateByProject || {}),
                },
            }
        },
    })

    const db = {
        queries: [],
        writes,
        state,
        collection: name => {
            if (name !== 'users') throw new Error(`unexpected collection ${name}`)
            const query = {
                where: (field, op, value) => {
                    db.queries.push({ field, op, value })
                    return query
                },
                limit: value => {
                    db.queries.push({ limit: value })
                    return query
                },
                get: async () => ({ docs: users.map(user => ({ id: user.id, data: () => user })) }),
            }
            return {
                ...query,
                doc: userId => ({
                    collection: sub => {
                        if (sub !== 'private') throw new Error(`unexpected subcollection ${sub}`)
                        return {
                            doc: docId => {
                                if (docId !== SCHEDULED_SYNC_STATE_DOC) throw new Error(`unexpected doc ${docId}`)
                                return stateDoc(userId)
                            },
                        }
                    },
                }),
            }
        },
    }

    return db
}

const activeUser = (overrides = {}) => ({
    id: 'user-1',
    lastLogin: NOW - 60 * 1000,
    timezone: 2,
    apisConnected: CONNECTED,
    ...overrides,
})

describe('getCalendarConnectedProjectIds', () => {
    it('returns only projects with the calendar integration on, in a stable order', () => {
        expect(getCalendarConnectedProjectIds({ apisConnected: CONNECTED })).toEqual([
            'project-private',
            'project-work',
        ])
    })

    it('survives a user with no integrations at all', () => {
        expect(getCalendarConnectedProjectIds({})).toEqual([])
        expect(getCalendarConnectedProjectIds({ apisConnected: {} })).toEqual([])
    })
})

describe('isUserRecentlyActive', () => {
    // Karsten asked for the heartbeat definition of "active"; this asserts it IS that definition
    // rather than a second 30-day constant that can drift away from it.
    it('uses the heartbeat active-user window on lastLogin', () => {
        expect(isUserRecentlyActive({ lastLogin: NOW - ACTIVE_USER_WINDOW_MS + 1000 }, NOW)).toBe(true)
        expect(isUserRecentlyActive({ lastLogin: NOW - ACTIVE_USER_WINDOW_MS - 1000 }, NOW)).toBe(false)
    })

    it('treats a user who has never logged in as inactive', () => {
        expect(isUserRecentlyActive({}, NOW)).toBe(false)
    })

    // Firestore sorts a stored Timestamp apart from a stored number, so the in-memory re-check
    // has to coerce both the way the heartbeat scheduler does.
    it('accepts a Firestore Timestamp as well as a number', () => {
        const recent = NOW - 1000
        expect(isUserRecentlyActive({ lastLogin: { toMillis: () => recent } }, NOW)).toBe(true)
        expect(isUserRecentlyActive({ lastLogin: new Date(recent) }, NOW)).toBe(true)
    })
})

describe('getProjectIdsDueForSync', () => {
    it('treats an unknown project as never synced', () => {
        expect(getProjectIdsDueForSync(['a', 'b'], undefined, BERLIN_TODAY)).toEqual(['a', 'b'])
        expect(getProjectIdsDueForSync(['a', 'b'], {}, BERLIN_TODAY)).toEqual(['a', 'b'])
    })

    it('drops a project already synced for this local day', () => {
        const state = { lastSyncedLocalDateByProject: { a: BERLIN_TODAY } }

        expect(getProjectIdsDueForSync(['a', 'b'], state, BERLIN_TODAY)).toEqual(['b'])
    })

    it('re-syncs a project whose recorded day is yesterday', () => {
        const state = { lastSyncedLocalDateByProject: { a: '2026-08-31' } }

        expect(getProjectIdsDueForSync(['a'], state, BERLIN_TODAY)).toEqual(['a'])
    })
})

describe('syncUserCalendars', () => {
    it('syncs every connected calendar and records the local day', async () => {
        const db = buildDb()
        const syncCalendarEvents = jest.fn().mockResolvedValue({})

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser(),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(syncCalendarEvents.mock.calls).toEqual([
            ['user-1', 'project-private'],
            ['user-1', 'project-work'],
        ])
        expect(result).toMatchObject({ skipped: false, syncedProjects: 2, failedProjects: 0 })
        expect(db.state['user-1'].lastSyncedLocalDateByProject).toEqual({
            'project-private': BERLIN_TODAY,
            'project-work': BERLIN_TODAY,
        })
    })

    it('does nothing on a second run in the same local day', async () => {
        const db = buildDb({
            syncState: { 'user-1': { lastSyncedLocalDateByProject: { 'project-private': BERLIN_TODAY } } },
        })
        const syncCalendarEvents = jest.fn().mockResolvedValue({})

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ apisConnected: { 'project-private': { calendar: true } } }),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(syncCalendarEvents).not.toHaveBeenCalled()
        expect(result).toEqual({ skipped: true, reason: 'already_synced_today' })
    })

    // A user west of Greenwich is still on 2026-08-31 at 06:08Z. Keying on the UTC date would
    // sync them for a day they have not reached yet and then skip their real morning.
    it('keys the marker on the user local day, not the UTC one', async () => {
        const db = buildDb()
        const syncCalendarEvents = jest.fn().mockResolvedValue({})

        await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ timezone: -8, apisConnected: { 'project-private': { calendar: true } } }),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(db.state['user-1'].lastSyncedLocalDateByProject).toEqual({ 'project-private': '2026-08-31' })
    })

    it('syncs again once the user local midnight has passed', async () => {
        const db = buildDb({
            syncState: { 'user-1': { lastSyncedLocalDateByProject: { 'project-private': BERLIN_TODAY } } },
        })
        const syncCalendarEvents = jest.fn().mockResolvedValue({})

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ apisConnected: { 'project-private': { calendar: true } } }),
            now: Date.parse('2026-09-01T22:00:01.000Z'),
            db,
            syncCalendarEvents,
        })

        expect(syncCalendarEvents).toHaveBeenCalledWith('user-1', 'project-private')
        expect(result).toMatchObject({ skipped: false, localDateKey: '2026-09-02' })
    })

    it('skips a user with no connected calendar without touching Firestore', async () => {
        const db = buildDb()
        const syncCalendarEvents = jest.fn()

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ apisConnected: { 'project-off': { calendar: false } } }),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(result).toEqual({ skipped: true, reason: 'no_calendar_connected' })
        expect(db.writes).toHaveLength(0)
        expect(syncCalendarEvents).not.toHaveBeenCalled()
    })

    // A revoked Google token throws on every attempt. Recording the day anyway is what keeps that
    // at one failed call per day instead of one per hour, forever.
    it('records the day even when the sync throws, so a broken connection is not retried hourly', async () => {
        const db = buildDb()
        const syncCalendarEvents = jest.fn().mockRejectedValue(new Error('Google auth revoked'))

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ apisConnected: { 'project-private': { calendar: true } } }),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(result).toMatchObject({ syncedProjects: 0, failedProjects: 1 })
        expect(db.state['user-1'].lastSyncedLocalDateByProject).toEqual({ 'project-private': BERLIN_TODAY })
    })

    it('keeps syncing the remaining projects after one of them fails', async () => {
        const db = buildDb()
        const syncCalendarEvents = jest
            .fn()
            .mockRejectedValueOnce(new Error('Google auth revoked'))
            .mockResolvedValueOnce({})

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser(),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(result).toMatchObject({ syncedProjects: 1, failedProjects: 1 })
    })

    // A failed state read looks exactly like "already synced today" if it is allowed to skip -
    // it would silently disable the job for that user forever.
    it('syncs anyway when the sync-state read fails', async () => {
        const db = buildDb({ failStateRead: true })
        const syncCalendarEvents = jest.fn().mockResolvedValue({})

        await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ apisConnected: { 'project-private': { calendar: true } } }),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(syncCalendarEvents).toHaveBeenCalledWith('user-1', 'project-private')
    })

    it('still syncs when the sync-state write fails', async () => {
        const db = buildDb({ failStateWrite: true })
        const syncCalendarEvents = jest.fn().mockResolvedValue({})

        const result = await syncUserCalendars({
            userId: 'user-1',
            userData: activeUser({ apisConnected: { 'project-private': { calendar: true } } }),
            now: NOW,
            db,
            syncCalendarEvents,
        })

        expect(result).toMatchObject({ syncedProjects: 1 })
    })
})

describe('syncCalendarsForActiveUsers', () => {
    it('queries users by the heartbeat active window and bounds the run', async () => {
        const db = buildDb({ users: [activeUser()] })

        await syncCalendarsForActiveUsers({ now: NOW, db, limit: 50, syncCalendarEvents: jest.fn() })

        expect(db.queries).toEqual([
            { field: 'lastLogin', op: '>=', value: NOW - ACTIVE_USER_WINDOW_MS },
            { limit: 50 },
        ])
    })

    it('reports what it did', async () => {
        const db = buildDb({
            users: [activeUser(), activeUser({ id: 'user-2', apisConnected: { 'project-off': { calendar: false } } })],
        })

        const result = await syncCalendarsForActiveUsers({ now: NOW, db, syncCalendarEvents: jest.fn() })

        expect(result).toEqual({
            success: true,
            activeUsers: 2,
            processedUsers: 1,
            skippedUsers: 1,
            syncedProjects: 2,
            failedProjects: 0,
        })
    })

    it('skips a stale user the query returned anyway', async () => {
        const db = buildDb({ users: [activeUser({ lastLogin: NOW - ACTIVE_USER_WINDOW_MS - 1000 })] })
        const syncCalendarEvents = jest.fn()

        const result = await syncCalendarsForActiveUsers({ now: NOW, db, syncCalendarEvents })

        expect(syncCalendarEvents).not.toHaveBeenCalled()
        expect(result).toMatchObject({ processedUsers: 0, skippedUsers: 1 })
    })

    it('carries on after one user blows up', async () => {
        const db = buildDb({ users: [activeUser({ id: 'user-1' }), activeUser({ id: 'user-2' })] })
        const syncCalendarEvents = jest.fn(userId => {
            if (userId === 'user-1') throw new Error('boom')
            return Promise.resolve({})
        })

        const result = await syncCalendarsForActiveUsers({ now: NOW, db, syncCalendarEvents })

        expect(result).toMatchObject({ success: true, activeUsers: 2 })
        expect(syncCalendarEvents).toHaveBeenCalledWith('user-2', 'project-private')
    })
})
