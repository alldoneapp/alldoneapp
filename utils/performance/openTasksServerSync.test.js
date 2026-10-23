const mockLog = jest.fn()
let mockNow = 0

jest.mock('./performanceLogger', () => ({
    logPerformanceMeasurement: (...args) => mockLog(...args),
    performanceNow: () => mockNow,
}))

import {
    OPEN_TASKS_SERVER_SYNC_SETTLE_MS,
    OPEN_TASKS_SERVER_SYNC_TIMEOUT_MS,
    OPEN_TASKS_SERVER_SYNC_TRACE,
    __resetOpenTasksServerSyncForTests,
    beginOpenTasksServerSyncCycle,
    registerOpenTasksServerSyncListener,
} from './openTasksServerSync'

const advance = ms => {
    mockNow += ms
    jest.advanceTimersByTime(ms)
}

beforeEach(() => {
    jest.useFakeTimers()
    mockNow = 0
    mockLog.mockClear()
    __resetOpenTasksServerSyncForTests()
})

afterEach(() => {
    __resetOpenTasksServerSyncForTests()
    jest.useRealTimers()
})

describe('open tasks server sync cycle', () => {
    it('costs nothing for listeners attached outside a cycle', () => {
        const registration = registerOpenTasksServerSyncListener()
        registration.serverReady()
        registration.dispose()
        jest.runAllTimers()
        expect(mockLog).not.toHaveBeenCalled()
    })

    it('reports when the last registered listener synced, measured at that moment', () => {
        beginOpenTasksServerSyncCycle('resume')
        const first = registerOpenTasksServerSyncListener()
        const second = registerOpenTasksServerSyncListener()

        advance(1000)
        first.serverReady()
        advance(41000)
        second.serverReady()
        expect(mockLog).not.toHaveBeenCalled()

        advance(OPEN_TASKS_SERVER_SYNC_SETTLE_MS)

        expect(mockLog).toHaveBeenCalledTimes(1)
        expect(mockLog).toHaveBeenCalledWith(
            OPEN_TASKS_SERVER_SYNC_TRACE,
            'server_synced',
            42000,
            expect.objectContaining({ source: 'resume', outcome: 'success', watcher_count: 2, count: 0 }),
            expect.any(Object)
        )
    })

    it('keeps waiting for a listener that attaches during the settle window', () => {
        beginOpenTasksServerSyncCycle('boot')
        const first = registerOpenTasksServerSyncListener()
        advance(500)
        first.serverReady()

        advance(OPEN_TASKS_SERVER_SYNC_SETTLE_MS - 1)
        const late = registerOpenTasksServerSyncListener()
        advance(10000)
        expect(mockLog).not.toHaveBeenCalled()

        late.serverReady()
        advance(OPEN_TASKS_SERVER_SYNC_SETTLE_MS)
        expect(mockLog.mock.calls[0][2]).toBe(500 + OPEN_TASKS_SERVER_SYNC_SETTLE_MS - 1 + 10000)
    })

    it('counts only the first server snapshot of each listener', () => {
        beginOpenTasksServerSyncCycle('boot')
        const registration = registerOpenTasksServerSyncListener()
        registration.serverReady()
        registration.serverReady()
        advance(OPEN_TASKS_SERVER_SYNC_SETTLE_MS)
        expect(mockLog.mock.calls[0][3]).toMatchObject({ watcher_count: 1 })
    })

    it('does not let an unmounted listener hold the cycle open', () => {
        beginOpenTasksServerSyncCycle('boot')
        const synced = registerOpenTasksServerSyncListener()
        const unmounted = registerOpenTasksServerSyncListener()
        synced.serverReady()
        unmounted.dispose()
        advance(OPEN_TASKS_SERVER_SYNC_SETTLE_MS)
        expect(mockLog.mock.calls[0][1]).toBe('server_synced')
    })

    it('reports a timeout with the listeners still waiting', () => {
        beginOpenTasksServerSyncCycle('boot')
        registerOpenTasksServerSyncListener()
        advance(OPEN_TASKS_SERVER_SYNC_TIMEOUT_MS)
        expect(mockLog).toHaveBeenCalledWith(
            OPEN_TASKS_SERVER_SYNC_TRACE,
            'timeout',
            OPEN_TASKS_SERVER_SYNC_TIMEOUT_MS,
            expect.objectContaining({ outcome: 'failed', count: 1 }),
            expect.any(Object)
        )
    })

    it('reports a replaced cycle as superseded and ignores its old listeners', () => {
        beginOpenTasksServerSyncCycle('boot')
        const old = registerOpenTasksServerSyncListener()
        advance(2000)
        beginOpenTasksServerSyncCycle('resume')
        expect(mockLog.mock.calls[0][1]).toBe('superseded')

        old.serverReady()
        advance(OPEN_TASKS_SERVER_SYNC_SETTLE_MS)
        expect(mockLog).toHaveBeenCalledTimes(1)
    })
})
