import store from '../../redux/store'
import { getDb, globalWatcherUnsub } from '../backends/firestore'
import { recoverDroppedProject } from './projectRecovery'
import { loadGlobalData, watchProjectData } from './initialLoadHelper'
import {
    resetBootIntegrityHealerForTests,
    runBootIntegrityCheck,
    scheduleBootIntegrityChecks,
} from './bootIntegrityHealer'

jest.mock('../../redux/store', () => ({
    getState: jest.fn(),
    subscribe: jest.fn(),
}))

jest.mock('../backends/firestore', () => ({
    getDb: jest.fn(),
    globalWatcherUnsub: {},
}))

jest.mock('./projectRecovery', () => ({
    recoverDroppedProject: jest.fn(),
}))

jest.mock('./initialLoadHelper', () => ({
    loadGlobalData: jest.fn(),
    watchProjectData: jest.fn(),
}))

// The synchronous browser-level tell; the redux slice is still '' during early boot.
let mockBrowserIsOffline = false
jest.mock('../connectionState', () => ({ isBrowserOffline: () => mockBrowserIsOffline }))

// Mutable state the mocked store serves; repairs mutate it like the real dispatches would.
let state

const buildDbMock = ({ roleUserId = 'admin-1' } = {}) => ({
    doc: jest.fn(path => {
        expect(path).toBe('roles/administrator')
        return { get: jest.fn(() => Promise.resolve({ data: () => ({ userId: roleUserId }) })) }
    }),
    disableNetwork: jest.fn(() => Promise.resolve()),
    enableNetwork: jest.fn(() => Promise.resolve()),
})

describe('runBootIntegrityCheck', () => {
    let consoleWarn

    beforeEach(() => {
        resetBootIntegrityHealerForTests()
        mockBrowserIsOffline = false
        state = {
            loggedUser: { uid: 'user1', projectIds: ['p1', 'p2'] },
            loggedUserProjectsMap: { p1: { id: 'p1' }, p2: { id: 'p2' } },
            administratorUser: { uid: 'admin-1' },
        }
        store.getState.mockImplementation(() => state)
        store.subscribe.mockReset()
        store.subscribe.mockImplementation(() => jest.fn())
        getDb.mockReturnValue(buildDbMock())
        recoverDroppedProject.mockReset()
        recoverDroppedProject.mockImplementation(async projectId => {
            state.loggedUserProjectsMap[projectId] = { id: projectId }
            return true
        })
        loadGlobalData.mockReset()
        loadGlobalData.mockImplementation(async () => {
            state.administratorUser = { uid: 'admin-1' }
        })
        Object.keys(globalWatcherUnsub).forEach(key => delete globalWatcherUnsub[key])
        watchProjectData.mockReset()
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('does nothing when redux holds everything the user is entitled to', async () => {
        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).not.toHaveBeenCalled()
        expect(loadGlobalData).not.toHaveBeenCalled()
        expect(getDb().disableNetwork).not.toHaveBeenCalled()
    })

    it('does nothing for anonymous or logged-out sessions', async () => {
        state.loggedUser = { uid: 'anon', isAnonymous: true, projectIds: ['p1'] }
        state.loggedUserProjectsMap = {}
        await runBootIntegrityCheck({ settleMs: 0 })

        state.loggedUser = undefined
        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).not.toHaveBeenCalled()
    })

    it('stands down entirely while offline — cached-only data is not an anomaly', async () => {
        state.connectionState = 'offline'
        delete state.loggedUserProjectsMap.p2

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).not.toHaveBeenCalled()
        expect(loadGlobalData).not.toHaveBeenCalled()
        expect(getDb().disableNetwork).not.toHaveBeenCalled()
    })

    it('stands down while connection health is stale or manually offline', async () => {
        delete state.loggedUserProjectsMap.p2

        state.connectionHealth = 'stale'
        await runBootIntegrityCheck({ settleMs: 0 })
        expect(recoverDroppedProject).not.toHaveBeenCalled()

        state.connectionHealth = 'offline'
        await runBootIntegrityCheck({ settleMs: 0 })
        expect(recoverDroppedProject).not.toHaveBeenCalled()
        expect(getDb().disableNetwork).not.toHaveBeenCalled()
    })

    it('re-runs after manual offline is explicitly reconnected', async () => {
        jest.useFakeTimers()
        try {
            state.connectionHealth = 'offline'
            delete state.loggedUserProjectsMap.p2

            await runBootIntegrityCheck({ settleMs: 0 })
            const onStoreChange = store.subscribe.mock.calls[0][0]

            state.connectionHealth = 'live'
            onStoreChange()
            jest.runOnlyPendingTimers()
            await Promise.resolve()
            await Promise.resolve()

            expect(recoverDroppedProject).toHaveBeenCalledWith('p2')
        } finally {
            jest.useRealTimers()
        }
    })

    // AT-2340. CHECK_DELAYS_MS are four ONE-SHOT timers armed once per user, and
    // scheduleBootIntegrityChecks refuses to re-arm for the same uid. A boot that
    // is offline for the first 60s therefore used to consume all four passes on
    // early returns and leave the healer dead for the rest of the session — the
    // in-code comment claiming "the scheduled checks keep firing" was wrong. The
    // degraded boot it exists for is exactly the one it stopped covering.
    it('re-runs once connectivity returns after standing down offline', async () => {
        jest.useFakeTimers()
        try {
            const db = buildDbMock()
            getDb.mockReturnValue(db)
            state.connectionState = 'offline'
            delete state.loggedUserProjectsMap.p2

            await runBootIntegrityCheck({ settleMs: 0 })
            expect(recoverDroppedProject).not.toHaveBeenCalled()

            state.connectionState = 'online'
            window.dispatchEvent(new Event('online'))
            jest.runOnlyPendingTimers()
            await Promise.resolve()
            await Promise.resolve()

            expect(recoverDroppedProject).toHaveBeenCalled()
        } finally {
            jest.useRealTimers()
        }
    })

    it('stands down when only the browser reports offline, before the slice is fed', async () => {
        // During early boot connectionState is '' because its listener lives in a
        // component that has not mounted yet; navigator already knows.
        state.connectionState = ''
        mockBrowserIsOffline = true
        delete state.loggedUserProjectsMap.p2

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).not.toHaveBeenCalled()
        expect(loadGlobalData).not.toHaveBeenCalled()
    })

    it('skips the bounded network cycle when the browser goes offline mid-check', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)
        delete state.loggedUserProjectsMap.p2
        // The re-fetch fails to repair AND flips the connection state, simulating
        // connectivity dropping between the first pass and the escalation.
        recoverDroppedProject.mockImplementation(async () => {
            state.connectionState = 'offline'
            return false
        })

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).toHaveBeenCalled()
        expect(db.disableNetwork).not.toHaveBeenCalled()
    })

    it('recovers a dropped project by plain re-fetch, without touching the network', async () => {
        delete state.loggedUserProjectsMap.p2

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(recoverDroppedProject).toHaveBeenCalledWith('p2')
        expect(recoverDroppedProject).toHaveBeenCalledTimes(1)
        expect(watchProjectData).toHaveBeenCalledWith('p2', true, true)
        const db = getDb()
        expect(db.disableNetwork).not.toHaveBeenCalled()
    })

    it('does not replace an existing project watcher after recovery', async () => {
        delete state.loggedUserProjectsMap.p2
        globalWatcherUnsub.p2Project = jest.fn()

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(watchProjectData).not.toHaveBeenCalled()
    })

    it('reloads global data when the administrator user is empty but the role names one', async () => {
        state.administratorUser = {}

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(loadGlobalData).toHaveBeenCalledTimes(1)
    })

    it('does not treat a missing administrator as an anomaly when no role is configured', async () => {
        state.administratorUser = {}
        getDb.mockReturnValue(buildDbMock({ roleUserId: null }))

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(loadGlobalData).not.toHaveBeenCalled()
    })

    it('cycles the Firestore network and retries when plain re-fetches do not help', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)
        delete state.loggedUserProjectsMap.p2
        // First repair round fails (transport still wedged), second succeeds.
        recoverDroppedProject
            .mockImplementationOnce(async () => false)
            .mockImplementationOnce(async projectId => {
                state.loggedUserProjectsMap[projectId] = { id: projectId }
                return true
            })

        await runBootIntegrityCheck({ settleMs: 0 })

        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        expect(recoverDroppedProject).toHaveBeenCalledTimes(2)
    })

    it('bounds network cycles per session', async () => {
        const db = buildDbMock()
        getDb.mockReturnValue(db)
        delete state.loggedUserProjectsMap.p2
        // Recovery never succeeds: every check escalates to a network cycle.
        recoverDroppedProject.mockImplementation(async () => false)

        await runBootIntegrityCheck({ settleMs: 0 })
        await runBootIntegrityCheck({ settleMs: 0 })
        await runBootIntegrityCheck({ settleMs: 0 })

        expect(db.disableNetwork).toHaveBeenCalledTimes(2)
    })
})

describe('scheduleBootIntegrityChecks', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        resetBootIntegrityHealerForTests()
        state = {
            loggedUser: { uid: 'user1', projectIds: [] },
            loggedUserProjectsMap: {},
            administratorUser: { uid: 'admin-1' },
        }
        store.getState.mockImplementation(() => state)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('schedules its checks only once per session', () => {
        scheduleBootIntegrityChecks()
        const timersAfterFirst = jest.getTimerCount()
        expect(timersAfterFirst).toBeGreaterThan(0)

        scheduleBootIntegrityChecks()
        expect(jest.getTimerCount()).toBe(timersAfterFirst)
    })

    it('replaces scheduled checks when another user signs in', () => {
        scheduleBootIntegrityChecks()
        const timersForFirstUser = jest.getTimerCount()

        state.loggedUser = { uid: 'user2', projectIds: [] }
        scheduleBootIntegrityChecks()

        expect(jest.getTimerCount()).toBe(timersForFirstUser)
    })
})
