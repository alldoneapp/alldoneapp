const mockState = {
    loggedUser: { uid: 'user-1', isAnonymous: false, guideProjectIds: ['guide'] },
    currentUser: { uid: 'user-1' },
    loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }, { id: 'guide' }],
}

jest.mock('../../../redux/store', () => ({ getState: () => mockState }))

const mockQueries = []
let mockGetImpl = async () => ({ docs: [] })

jest.mock('../firestore', () => ({
    getDb: () => ({
        collection: path => {
            const registration = { path, where: [], limit: null, getOptions: null }
            mockQueries.push(registration)
            const query = {
                where: (...args) => {
                    registration.where.push(args)
                    return query
                },
                limit: value => {
                    registration.limit = value
                    return query
                },
                get: options => {
                    registration.getOptions = options
                    return mockGetImpl(registration)
                },
            }
            return query
        },
    }),
}))

let mockOffline = false
jest.mock('../../connectionState', () => ({ isBrowserOffline: () => mockOffline }))

let mockPageVisible = null
jest.mock('../../appResume', () => ({
    RESUME_INTEGRITY_MS: 5 * 60 * 1000,
    subscribePageVisible: callback => {
        mockPageVisible = callback
        return () => {
            mockPageVisible = null
        }
    },
}))

const mockTraceEnd = jest.fn()
jest.mock('../../performance/performanceLogger', () => ({
    startPerformanceTrace: () => ({ end: (...args) => mockTraceEnd(...args) }),
}))

const mockBeginCycle = jest.fn()
jest.mock('../../performance/openTasksServerSync', () => ({
    beginOpenTasksServerSyncCycle: (...args) => mockBeginCycle(...args),
}))

import moment from 'moment'

import {
    RECENT_COMPLETIONS_MAX_LOOKBACK_MS,
    RECENT_COMPLETIONS_PROJECT_CONCURRENCY,
    RECENT_COMPLETIONS_RESULT_TTL_MS,
    __resetRecentCompletionsPrefetchForTests,
    getRecentCompletionsSince,
    getRecentlyCompletedTasks,
    installRecentCompletionsResumePrefetch,
    prefetchRecentCompletions,
    startRecentCompletionsPrefetchOnBoot,
    subscribeToRecentCompletions,
} from './recentCompletionsPrefetch'

const docsFor = ids => ({ docs: ids.map(id => ({ id, data: () => ({ inDone: true, name: id }) })) })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
    mockQueries.length = 0
    mockGetImpl = async () => ({ docs: [] })
    mockOffline = false
    mockState.loggedUser = { uid: 'user-1', isAnonymous: false, guideProjectIds: ['guide'] }
    mockState.currentUser = { uid: 'user-1' }
    mockTraceEnd.mockClear()
    mockBeginCycle.mockClear()
    __resetRecentCompletionsPrefetchForTests()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

describe('getRecentCompletionsSince', () => {
    const now = moment('2026-10-23T15:00:00').valueOf()
    const startOfToday = moment(now).startOf('day').valueOf()

    it('defaults to the start of today', () => {
        expect(getRecentCompletionsSince({ now })).toBe(startOfToday)
    })

    it('keeps the start of today when the last sync was today', () => {
        expect(getRecentCompletionsSince({ now, lastSyncedAt: now - 60 * 60 * 1000 })).toBe(startOfToday)
    })

    it('reaches back to a last sync before today', () => {
        const yesterdayEvening = startOfToday - 3 * 60 * 60 * 1000
        expect(getRecentCompletionsSince({ now, lastSyncedAt: yesterdayEvening })).toBe(yesterdayEvening)
    })

    it('never reaches back more than 48 hours', () => {
        expect(getRecentCompletionsSince({ now, lastSyncedAt: 0 })).toBe(now - RECENT_COMPLETIONS_MAX_LOOKBACK_MS)
    })
})

describe('prefetchRecentCompletions', () => {
    const run = (overrides = {}) =>
        prefetchRecentCompletions({
            projectIds: ['p1', 'p2'],
            userId: 'user-1',
            readerId: 'user-1',
            since: 1000,
            reason: 'test',
            ...overrides,
        })

    it('asks the server for each project with the Done-tab index shape', async () => {
        await run()

        expect(mockQueries.map(query => query.path)).toEqual(['items/p1/tasks', 'items/p2/tasks'])
        expect(mockQueries[0].where).toEqual([
            ['inDone', '==', true],
            ['userId', '==', 'user-1'],
            ['readerIds', 'array-contains', 'user-1'],
            ['completed', '>=', 1000],
        ])
        expect(mockQueries[0].getOptions).toEqual({ source: 'server' })
        expect(mockQueries[0].limit).toBeGreaterThan(0)
    })

    it('publishes each project to its own subscribers and keeps the result for late readers', async () => {
        mockGetImpl = async ({ path }) => docsFor(path === 'items/p1/tasks' ? ['t1', 't2'] : [])
        const p1Listener = jest.fn()
        const p2Listener = jest.fn()
        subscribeToRecentCompletions('p1', p1Listener)
        subscribeToRecentCompletions('p2', p2Listener)

        const summary = await run()

        expect(summary).toEqual({ projectCount: 2, taskCount: 2, errorCount: 0 })
        expect(p1Listener.mock.calls[0][0].map(task => task.id)).toEqual(['t1', 't2'])
        expect(p2Listener).toHaveBeenCalledWith([])
        expect(getRecentlyCompletedTasks('p1', 'user-1').map(task => task.id)).toEqual(['t1', 't2'])
    })

    it('scopes stored results to the user they were fetched for and expires them', async () => {
        mockGetImpl = async () => docsFor(['t1'])
        await run()

        expect(getRecentlyCompletedTasks('p1', 'someone-else')).toEqual([])
        expect(getRecentlyCompletedTasks('p1', 'user-1', Date.now() + RECENT_COMPLETIONS_RESULT_TTL_MS + 1)).toEqual([])
    })

    it('keeps going when one project fails and never rejects', async () => {
        mockGetImpl = async ({ path }) => {
            if (path === 'items/p1/tasks') throw Object.assign(new Error('nope'), { code: 'permission-denied' })
            return docsFor(['t9'])
        }

        await expect(run()).resolves.toEqual({ projectCount: 2, taskCount: 1, errorCount: 1 })
        expect(getRecentlyCompletedTasks('p2', 'user-1').map(task => task.id)).toEqual(['t9'])
    })

    it('does nothing offline or without a scope', async () => {
        mockOffline = true
        await expect(run()).resolves.toMatchObject({ skipped: 'offline' })
        mockOffline = false
        await expect(run({ projectIds: [] })).resolves.toMatchObject({ skipped: 'no_scope' })
        await expect(run({ userId: null })).resolves.toMatchObject({ skipped: 'no_scope' })
        expect(mockQueries).toHaveLength(0)
    })

    it('bounds the number of queries in flight', async () => {
        let inFlight = 0
        let maxInFlight = 0
        mockGetImpl = async () => {
            inFlight += 1
            maxInFlight = Math.max(maxInFlight, inFlight)
            await flush()
            inFlight -= 1
            return docsFor([])
        }

        await run({ projectIds: Array.from({ length: 10 }, (_, index) => `p${index}`) })

        expect(mockQueries).toHaveLength(10)
        expect(maxInFlight).toBe(RECENT_COMPLETIONS_PROJECT_CONCURRENCY)
    })

    it('stops an older run from publishing once a newer one has started', async () => {
        let releaseFirst
        mockGetImpl = () =>
            new Promise(resolve => {
                releaseFirst = () => resolve(docsFor(['stale']))
            })
        const listener = jest.fn()
        subscribeToRecentCompletions('p1', listener)
        const first = run({ projectIds: ['p1'] })

        mockGetImpl = async () => docsFor(['fresh'])
        await run({ projectIds: ['p1'] })
        releaseFirst()

        await expect(first).resolves.toMatchObject({ skipped: 'superseded' })
        expect(listener).toHaveBeenCalledTimes(1)
        expect(getRecentlyCompletedTasks('p1', 'user-1').map(task => task.id)).toEqual(['fresh'])
    })
})

describe('boot and resume triggers', () => {
    it('opens a boot sync cycle and prefetches the active, non-guide projects', async () => {
        await startRecentCompletionsPrefetchOnBoot()

        expect(mockBeginCycle).toHaveBeenCalledWith('boot')
        expect(mockQueries.map(query => query.path)).toEqual(['items/p1/tasks', 'items/p2/tasks'])
    })

    it('skips anonymous users', async () => {
        mockState.loggedUser = { uid: 'anon', isAnonymous: true }
        await startRecentCompletionsPrefetchOnBoot()
        expect(mockQueries).toHaveLength(0)
    })

    it('prefetches after a resume long enough to rebuild the listeners, and only then', async () => {
        installRecentCompletionsResumePrefetch()

        mockPageVisible({ hiddenMs: 60 * 1000 })
        await flush()
        expect(mockQueries).toHaveLength(0)
        expect(mockBeginCycle).not.toHaveBeenCalled()

        const hiddenMs = 3 * 60 * 60 * 1000
        const before = Date.now()
        mockPageVisible({ hiddenMs })
        await flush()

        expect(mockBeginCycle).toHaveBeenCalledWith('resume')
        expect(mockQueries).toHaveLength(2)
        const since = mockQueries[0].where.find(([field]) => field === 'completed')[2]
        expect(since).toBe(getRecentCompletionsSince({ now: Date.now(), lastSyncedAt: before - hiddenMs }))
    })

    it('falls back to the time since the last visible return when no absence was reported', async () => {
        const nowSpy = jest.spyOn(Date, 'now')
        nowSpy.mockReturnValue(1_000_000_000)
        installRecentCompletionsResumePrefetch()

        nowSpy.mockReturnValue(1_000_000_000 + 10 * 60 * 1000)
        mockPageVisible({ hiddenMs: null })
        await flush()

        expect(mockBeginCycle).toHaveBeenCalledWith('resume')
    })

    it('installs the resume subscription only once', () => {
        const first = installRecentCompletionsResumePrefetch()
        expect(installRecentCompletionsResumePrefetch()).toBe(first)
    })
})
