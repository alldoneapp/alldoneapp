/**
 * AT-2391 — the New Day popup must offer a way back online.
 *
 * The popup's offline state is not a guess about the network: it is what
 * happens when the per-project statistics read fails (`getUserStatistics`'s
 * offline callback), which is exactly the case where yesterday's numbers are
 * not in the local cache. Before this, that state was a dead end — it said it
 * could not read the numbers and offered no way to ask again, so the only
 * routes to the summary were reloading the whole app (losing every open editor
 * and scroll position in the session) or starting the day blind.
 *
 * What this suite pins, in order of how badly each one failed the user:
 *
 *   - the button exists at all, and only on the offline card;
 *   - a successful reconnect shows the REAL numbers, in place, without
 *     closing the popup — including that the popup never blinks out while the
 *     re-read is in flight (`checkIfDataIsLoaded()` is false for that window,
 *     which on its own would unmount the whole thing);
 *   - a failed reconnect says so and leaves the day startable, because
 *     acknowledging a new day works offline (AT-2340) and a reconnect that
 *     could not help must never look like a blocked popup;
 *   - a re-read that never answers still ends, rather than spinning forever.
 *
 * The two network edges are mocked and nothing else is: `reconnectNow` (the
 * shared manual-reconnect path from PT-4660) and the statistics read.
 */

import { newDayRecoveryStore, createNewDayRecoveryStore } from '../../utils/newDayRecoveryStore'
import { dayReloadCoordinator, createDayReloadCoordinator } from '../../utils/dayReloadCoordinator'

beforeEach(() => {
    localStorage.clear()
    Object.assign(newDayRecoveryStore, createNewDayRecoveryStore())
    Object.assign(dayReloadCoordinator, createDayReloadCoordinator())
})

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'
import moment from 'moment'

jest.mock('lottie-react', () => () => null)
jest.mock('../../utils/backends/Users/reportNewDayStatisticsError', () => ({
    reportNewDayStatisticsError: jest.fn(() => Promise.resolve(true)),
}))

jest.mock('../../utils/BackendBridge', () => ({
    getUserStatistics: jest.fn(),
    setProjectHappiness: jest.fn(() => Promise.resolve()),
    watchProjectHappinessByRange: jest.fn(),
    unwatch: jest.fn(),
}))

jest.mock('../../utils/Observers', () => ({
    deleteCacheAndRefresh: jest.fn(() => Promise.resolve()),
}))

jest.mock('../../utils/backends/Users/usersFirestore', () => ({
    setUserStatisticsModalDate: jest.fn(() => Promise.resolve()),
}))

jest.mock('../../utils/UserDataCache', () => ({
    setCachedUserData: jest.fn(),
}))

// The day-rate backfill is a write path of its own with its own coverage; here
// it would only add Firestore edges to a test about the reconnect decision.
jest.mock('../../utils/DayRateTimeLogHelper', () => ({
    normalizeDayRateTimeLogConfig: config => ({ enabled: config?.enabled === true }),
    reconcileProjectDayRateTimeLogsBackfill: jest.fn(() => Promise.resolve()),
}))

// Only `reconnectNow` is replaced; the state constants keep their real values
// so a rename upstream shows up here as a failure rather than as a silently
// `undefined` comparison that quietly stops matching.
jest.mock('../../utils/connectionHealth', () => ({
    ...jest.requireActual('../../utils/connectionHealth'),
    reconnectNow: jest.fn(),
}))

import EndDayStatisticsModal, {
    RECONNECT_ATTEMPT_TIMEOUT_MS,
    RECONNECT_STATISTICS_TIMEOUT_MS,
} from '../../components/UIComponents/FloatModals/EndDayStatisticsModal'
import store from '../../redux/store'
import {
    setConnectionHealth,
    setConnectionState,
    setProjectsInitialData,
    setShowNewDayNotification,
    setSidebarNumbers,
    storeLoggedUser,
} from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import { reconnectNow } from '../../utils/connectionHealth'
import { setUserStatisticsModalDate } from '../../utils/backends/Users/usersFirestore'
import { reportNewDayStatisticsError } from '../../utils/backends/Users/reportNewDayStatisticsError'
import { reconcileProjectDayRateTimeLogsBackfill } from '../../utils/DayRateTimeLogHelper'

const YESTERDAY = moment().subtract(1, 'day').startOf('day').add(9, 'hours').valueOf()

const PROJECT = {
    id: 'p1',
    index: 0,
    name: 'Alldone Product',
    estimationType: 'points',
    sortIndexByUser: { 'user-1': 0 },
}

const signIn = () => {
    store.dispatch(
        storeLoggedUser({
            uid: 'user-1',
            isAnonymous: false,
            projectIds: ['p1'],
            realProjectIds: ['p1'],
            templateProjectIds: [],
            archivedProjectIds: [],
            guideProjectIds: [],
            emptyInboxDays: [],
            statisticsModalDate: YESTERDAY,
        })
    )
    store.dispatch(setProjectsInitialData([PROJECT], { p1: PROJECT }, {}, {}, {}, {}))
    store.dispatch(setSidebarNumbers({ loading: false }))
}

/** The read fails the way an offline read fails: through the offline callback. */
const readsOffline = () =>
    Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback, callbackOffline) =>
        callbackOffline()
    )

const readsStatistics = statistics =>
    Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback) => callback(projectId, statistics))

/** A read that neither resolves nor rejects — the hang the timeout exists for. */
const readsNothing = () => Backend.getUserStatistics.mockImplementation(() => {})

let currentTree = null

const flush = async () => {
    await renderer.act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

const render = async () => {
    let tree
    renderer.act(() => {
        tree = renderer.create(
            <Provider store={store}>
                <EndDayStatisticsModal />
            </Provider>
        )
    })
    currentTree = tree
    // The statistics read is issued from a promise continuation, so nothing has
    // reported yet on the render pass itself.
    await flush()
    return tree
}

const text = tree => JSON.stringify(tree.toJSON())
const has = (tree, testID) => tree.root.findAllByProps({ testID }).length > 0

const pressReconnect = async tree => {
    const button = tree.root.findByProps({ testID: 'newDayReconnectButton' })
    await renderer.act(async () => {
        await button.props.onPress({ preventDefault: () => {}, stopPropagation: () => {} })
    })
    await flush()
}

describe('EndDayStatisticsModal — reconnect from the offline card (AT-2391)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        reconcileProjectDayRateTimeLogsBackfill.mockResolvedValue([])
        setUserStatisticsModalDate.mockResolvedValue(undefined)
        reconnectNow.mockResolvedValue('live')
        readsOffline()
        renderer.act(() => {
            store.dispatch(setShowNewDayNotification(false))
            // Both connection slices are app-wide and survive between tests.
            store.dispatch(setConnectionState(''))
            store.dispatch(setConnectionHealth('live'))
            signIn()
        })
    })

    afterEach(() => {
        if (currentTree) renderer.act(() => currentTree.unmount())
        currentTree = null
        jest.useRealTimers()
    })

    it('offers a reconnect button when the statistics could not be read', async () => {
        const tree = await render()

        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        // Offline is not a blocked popup: the day is still startable, because
        // the acknowledgement is queued locally (AT-2340).
        expect(has(tree, 'startNewDayButton')).toBe(true)
        expect(text(tree)).toContain('Try again')
    })

    it('uses yesterday local confirmation when the server still holds an older offline date', async () => {
        const olderDate = moment(YESTERDAY).subtract(1, 'day').valueOf()
        renderer.act(() =>
            store.dispatch(storeLoggedUser({ ...store.getState().loggedUser, statisticsModalDate: olderDate }))
        )
        newDayRecoveryStore.acknowledge('user-1', olderDate, YESTERDAY)
        readsStatistics({ doneTasks: 24 })
        const tree = await render()
        expect(Backend.getUserStatistics.mock.calls[0][2]).toBe(moment(YESTERDAY).format('DDMMYYYY'))
        expect(has(tree, 'newDayStatistics')).toBe(true)
        const readsBefore = Backend.getUserStatistics.mock.calls.length
        renderer.act(() =>
            store.dispatch(storeLoggedUser({ ...store.getState().loggedUser, statisticsModalDate: YESTERDAY }))
        )
        await flush()
        expect(Backend.getUserStatistics).toHaveBeenCalledTimes(readsBefore)
        expect(has(tree, 'startNewDayButton')).toBe(true)
    })

    it('shows the saved summary while day-rate maintenance is stuck and refreshes when it finally completes', async () => {
        jest.useFakeTimers()
        const project = { ...PROJECT, dayRateTimeLog: { enabled: true } }
        renderer.act(() => store.dispatch(setProjectsInitialData([project], { p1: project }, {}, {}, {}, {})))
        let completeMaintenance
        reconcileProjectDayRateTimeLogsBackfill.mockImplementation(
            () =>
                new Promise(resolve => {
                    completeMaintenance = resolve
                })
        )
        readsStatistics({ doneTasks: 24, gold: 35 })
        const tree = await render()
        expect(has(tree, 'newDayStatistics')).toBe(true)
        expect(text(tree)).toContain('"24"')
        expect(text(tree)).toContain('Updating day-rate figures')
        await renderer.act(async () => jest.advanceTimersByTimeAsync(RECONNECT_STATISTICS_TIMEOUT_MS))
        expect(has(tree, 'newDayStatistics')).toBe(true)
        expect(text(tree)).not.toContain('Your summary could not be loaded')
        expect(text(tree)).toContain('Day-rate figures could not be updated')
        await pressReconnect(tree)
        expect(reconcileProjectDayRateTimeLogsBackfill).toHaveBeenCalledTimes(1)
        readsStatistics({ doneTasks: 24, gold: 40 })
        await renderer.act(async () => completeMaintenance([]))
        await flush()
        expect(text(tree)).toContain('"40"')
        expect(has(tree, 'newDayDayRateStatus')).toBe(false)
    })

    it('loads missing statistics while transport recovery is still stuck, and ignores its completion after closing', async () => {
        renderer.act(() => store.dispatch(setConnectionHealth('stale')))
        let completeReconnect
        reconnectNow.mockImplementation(
            () =>
                new Promise(resolve => {
                    completeReconnect = resolve
                })
        )
        const tree = await render()
        readsStatistics({ doneTasks: 24 })
        let reconnect
        await renderer.act(async () => {
            reconnect = tree.root.findByProps({ testID: 'newDayReconnectButton' }).props.onPress()
        })
        expect(has(tree, 'newDayStatistics')).toBe(true)
        expect(text(tree)).toContain('"24"')
        renderer.act(() => tree.root.findByProps({ testID: 'startNewDayButton' }).props.onPress())
        const calls = Backend.getUserStatistics.mock.calls.length
        await renderer.act(async () => {
            completeReconnect('live')
            await reconnect
        })
        expect(tree.toJSON()).toBeNull()
        expect(Backend.getUserStatistics).toHaveBeenCalledTimes(calls)
    })

    it('does not offer it when the statistics loaded and the connection is live', async () => {
        readsStatistics({ doneTasks: 4, donePoints: 7, xp: 30, gold: 2 })

        const tree = await render()

        expect(has(tree, 'newDayReconnectButton')).toBe(false)
        expect(has(tree, 'startNewDayButton')).toBe(true)
    })

    it('shows the real summary in place once the connection is back', async () => {
        const tree = await render()
        readsStatistics({ doneTasks: 4, donePoints: 7, xp: 30, gold: 2 })

        await pressReconnect(tree)

        expect(reconnectNow).not.toHaveBeenCalled()
        // The popup is still open, now showing what it could not read before.
        expect(tree.toJSON()).not.toBeNull()
        expect(has(tree, 'newDayReconnectButton')).toBe(false)
        expect(text(tree)).toContain('Tasks done:')
        expect(text(tree)).toContain('"4"')
        expect(text(tree)).not.toContain('offline right now')
    })

    it('never blinks the popup out while the re-read is in flight', async () => {
        const tree = await render()
        // A read that has not answered yet: `checkIfDataIsLoaded()` is false for
        // this whole window, which unmounted the popup before AT-2391.
        readsNothing()

        await pressReconnect(tree)

        expect(tree.toJSON()).not.toBeNull()
        expect(text(tree)).toContain('Reconnecting')
    })

    it('reports a reconnect that did not work and keeps the day startable', async () => {
        renderer.act(() => store.dispatch(setConnectionHealth('stale')))
        reconnectNow.mockResolvedValue('offline')
        const tree = await render()

        await pressReconnect(tree)

        expect(Backend.getUserStatistics).toHaveBeenCalledTimes(2) // saved summary retries independently of the probe
        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        expect(has(tree, 'startNewDayButton')).toBe(true)
        expect(text(tree)).toContain('Your summary could not be loaded')
    })

    it('can be pressed again after a failed attempt', async () => {
        renderer.act(() => store.dispatch(setConnectionHealth('stale')))
        reconnectNow.mockResolvedValue('offline')
        const tree = await render()

        await pressReconnect(tree)
        reconnectNow.mockImplementation(async () => {
            store.dispatch(setConnectionHealth('live'))
            return 'live'
        })
        readsStatistics({ doneTasks: 2, donePoints: 3, xp: 10, gold: 1 })
        await pressReconnect(tree)

        expect(reconnectNow).toHaveBeenCalledTimes(2)
        expect(has(tree, 'newDayReconnectButton')).toBe(false)
        expect(text(tree)).toContain('"2"')
    })

    it('survives a reconnect that throws, rather than leaving a spinner', async () => {
        renderer.act(() => store.dispatch(setConnectionHealth('stale')))
        reconnectNow.mockRejectedValue(new Error('boom'))
        const tree = await render()

        await pressReconnect(tree)

        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        expect(text(tree)).toContain('Your summary could not be loaded')
    })

    it('gives up when the shared reconnect operation itself never answers', async () => {
        renderer.act(() => store.dispatch(setConnectionHealth('stale')))
        jest.useFakeTimers()
        reconnectNow.mockImplementation(() => new Promise(() => {}))
        const tree = await render()
        const button = tree.root.findByProps({ testID: 'newDayReconnectButton' })
        let pressing

        renderer.act(() => {
            pressing = button.props.onPress({ preventDefault: () => {}, stopPropagation: () => {} })
        })
        await flush()
        expect(text(tree)).toContain('Reconnecting')

        await renderer.act(async () => {
            jest.advanceTimersByTime(RECONNECT_ATTEMPT_TIMEOUT_MS)
            await pressing
        })

        expect(text(tree)).not.toContain('Reconnecting')
        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        expect(has(tree, 'startNewDayButton')).toBe(true)
        expect(text(tree)).toContain('Your summary could not be loaded')
    })

    it('gives up on a re-read that never answers', async () => {
        jest.useFakeTimers()
        const tree = await render()
        readsNothing()

        await pressReconnect(tree)
        expect(text(tree)).toContain('Reconnecting')

        await renderer.act(async () => {
            jest.advanceTimersByTime(RECONNECT_STATISTICS_TIMEOUT_MS)
        })

        expect(text(tree)).not.toContain('Reconnecting')
        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        expect(has(tree, 'startNewDayButton')).toBe(true)
    })

    /**
     * The second half of the feature: yesterday's numbers can come out of the
     * local Firestore cache while the app is not talking to the server at all,
     * so a complete-looking summary is no proof of a working connection. The
     * button belongs there too — but it must not touch the summary.
     */
    describe('with a complete summary on screen', () => {
        const summary = { doneTasks: 4, donePoints: 7, xp: 30, gold: 2 }

        const renderCachedSummary = async signal => {
            readsStatistics(summary)
            renderer.act(() => store.dispatch(signal))
            return render()
        }

        it('offers the button when the browser reports offline', async () => {
            const tree = await renderCachedSummary(setConnectionState('offline'))

            expect(has(tree, 'newDayReconnectButton')).toBe(true)
            // Still the summary, not the offline card.
            expect(text(tree)).toContain('Tasks done:')
            expect(text(tree)).not.toContain('offline right now')
        })

        it('offers the button when the app is showing data of unknown age', async () => {
            const tree = await renderCachedSummary(setConnectionHealth('stale'))

            expect(has(tree, 'newDayReconnectButton')).toBe(true)
            expect(text(tree)).toContain('Tasks done:')
        })

        it('is already busy while the app-wide monitor is probing', async () => {
            const tree = await renderCachedSummary(setConnectionHealth('reconnecting'))

            expect(tree.root.findByProps({ testID: 'newDayReconnectButton' }).props.disabled).toBe(true)
            expect(text(tree)).toContain('Reconnecting')
        })

        it('reconnects without re-reading a closed day', async () => {
            const tree = await renderCachedSummary(setConnectionState('offline'))
            const readsBefore = Backend.getUserStatistics.mock.calls.length

            await pressReconnect(tree)

            expect(reconnectNow).toHaveBeenCalledTimes(1)
            // Yesterday is over: the numbers cannot have changed, so re-reading
            // them would only flash the card through zeroes.
            expect(Backend.getUserStatistics).toHaveBeenCalledTimes(readsBefore)
            expect(text(tree)).toContain('Tasks done:')
            expect(text(tree)).toContain('"4"')
        })

        it('never replaces a good summary with the offline card when the reconnect fails', async () => {
            reconnectNow.mockResolvedValue('offline')
            const tree = await renderCachedSummary(setConnectionState('offline'))

            await pressReconnect(tree)

            expect(text(tree)).toContain('Tasks done:')
            expect(text(tree)).toContain('"4"')
            expect(text(tree)).not.toContain('offline right now')
            expect(text(tree)).toContain('Still no connection')
            expect(has(tree, 'newDayReconnectButton')).toBe(true)
        })
    })

    it('shows the popup before sidebar counters and statistics finish', async () => {
        readsNothing()
        renderer.act(() => store.dispatch(setSidebarNumbers({ loading: true })))
        const tree = await render()
        expect(has(tree, 'startNewDayButton')).toBe(true)
        expect(text(tree)).toContain('Loading your daily summary')
        expect(Backend.getUserStatistics).toHaveBeenCalledWith(
            'p1',
            'user-1',
            expect.any(String),
            expect.any(Function),
            expect.any(Function),
            { preferDirect: true }
        )
        expect(text(tree)).not.toContain('offline')
    })

    it('does not describe a statistics failure as a phone connectivity failure', async () => {
        const tree = await render()
        expect(text(tree)).toContain('Your summary could not be loaded')
        expect(text(tree)).not.toContain('offline right now')
        expect(text(tree)).not.toContain('You are offline')
    })

    it('accepts a successful answer after an earlier failure', async () => {
        let answer
        Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback, onError) => {
            answer = () => callback(projectId, { doneTasks: 9 })
            onError({ code: 'unavailable', message: 'Temporary failure' })
        })
        const tree = await render()
        await renderer.act(async () => answer())
        expect(text(tree)).toContain('Tasks done:')
        expect(text(tree)).toContain('"9"')
        expect(text(tree)).not.toContain('Your summary could not be loaded')
    })

    it('ignores old statistics callbacks after the day was acknowledged', async () => {
        let answer
        Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback) => {
            answer = () => callback(projectId, { doneTasks: 9 })
        })
        const tree = await render()
        renderer.act(() => tree.root.findByProps({ testID: 'startNewDayButton' }).props.onPress())
        await renderer.act(async () => answer())
        expect(tree.toJSON()).toBeNull()
    })

    it('automatically retries the summary after browser connectivity recovers', async () => {
        renderer.act(() => store.dispatch(setConnectionState('offline')))
        const tree = await render()
        expect(text(tree)).toContain('You are offline')
        readsStatistics({ doneTasks: 6 })
        await renderer.act(async () => store.dispatch(setConnectionState('online')))
        await flush()
        expect(text(tree)).toContain('Tasks done:')
        expect(text(tree)).toContain('"6"')
        expect(reconnectNow).not.toHaveBeenCalled()
    })

    it('retains successful projects and retries only the failed project', async () => {
        renderer.act(() => {
            store.dispatch(storeLoggedUser({ ...store.getState().loggedUser, projectIds: ['p1', 'p2'] }))
            const second = { ...PROJECT, id: 'p2', name: 'Unavailable project', index: 1 }
            store.dispatch(setProjectsInitialData([PROJECT, second], { p1: PROJECT, p2: second }, {}, {}, {}, {}))
        })
        Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback, onError) => {
            projectId === 'p1' ? callback(projectId, { doneTasks: 4 }) : onError()
        })
        const tree = await render()
        expect(has(tree, 'newDayStatistics')).toBe(true)
        expect(text(tree)).toContain('Partial daily summary')
        expect(text(tree)).toContain('These totals include only the projects that have loaded.')
        expect(text(tree)).toContain('"4"')
        const failedProjects = tree.root.findByProps({ testID: 'newDayFailedProjects' })
        expect(failedProjects.findAll(node => node.children.includes('Unavailable project')).length).toBeGreaterThan(0)
        expect(failedProjects.findAll(node => node.children.includes(PROJECT.name))).toHaveLength(0)
        Backend.getUserStatistics.mockClear()
        readsNothing()
        await pressReconnect(tree)
        expect(has(tree, 'newDayStatistics')).toBe(true)
        expect(text(tree)).toContain('"4"')
        expect(text(tree)).toContain('Loading the remaining projects...')
        // Finish the pending retry using the callback supplied to the reader.
        await renderer.act(async () => Backend.getUserStatistics.mock.calls[0][3]('p2', { doneTasks: 3 }))
        expect(Backend.getUserStatistics).toHaveBeenCalledTimes(1)
        expect(Backend.getUserStatistics.mock.calls[0][0]).toBe('p2')
        expect(text(tree)).toContain('"7"')
        expect(text(tree)).not.toContain('Partial daily summary')
        expect(has(tree, 'newDayFailedProjects')).toBe(false)
    })

    it('reports the failed project and original error without exposing technical errors in the popup', async () => {
        const failure = Object.assign(new Error('Missing or insufficient permissions'), { code: 'PERMISSION_DENIED' })
        Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback, onError) => onError(failure))
        const tree = await render()
        expect(has(tree, 'newDayStatistics')).toBe(false)
        expect(text(tree)).toContain(PROJECT.name)
        expect(text(tree)).not.toContain('Missing or insufficient permissions')
        expect(reportNewDayStatisticsError).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({
                userId: 'user-1',
                projectId: 'p1',
                statisticsDate: moment(YESTERDAY).format('DDMMYYYY'),
                stage: 'statistics-read',
                attempt: 1,
                elapsedMs: expect.any(Number),
            })
        )
    })

    it('updates the project list when a second project fails later', async () => {
        const second = { ...PROJECT, id: 'p2', name: 'Second project', index: 1 }
        renderer.act(() => {
            store.dispatch(storeLoggedUser({ ...store.getState().loggedUser, projectIds: ['p1', 'p2'] }))
            store.dispatch(setProjectsInitialData([PROJECT, second], { p1: PROJECT, p2: second }, {}, {}, {}, {}))
        })
        let failSecond
        Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback, onError) => {
            if (projectId === 'p1') onError({ code: 'PERMISSION_DENIED' })
            else failSecond = onError
        })
        const tree = await render()
        expect(text(tree)).not.toContain(second.name)
        await renderer.act(async () => failSecond({ code: 'deadline-exceeded' }))
        expect(text(tree)).toContain(second.name)
        expect(text(tree)).toContain(PROJECT.name)
        expect(
            reportNewDayStatisticsError.mock.calls.filter(([, context]) => context.source !== 'new-day-lifecycle')
        ).toHaveLength(2)
    })

    it('reports a stalled read with its project, stage and elapsed time', async () => {
        jest.useFakeTimers()
        readsNothing()
        const tree = await render()
        await renderer.act(async () => jest.advanceTimersByTimeAsync(RECONNECT_STATISTICS_TIMEOUT_MS))
        expect(text(tree)).toContain(PROJECT.name)
        expect(reportNewDayStatisticsError).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'deadline-exceeded' }),
            expect.objectContaining({
                projectId: 'p1',
                stage: 'statistics-read',
                elapsedMs: RECONNECT_STATISTICS_TIMEOUT_MS,
                attempt: 1,
            })
        )
    })

    it('does not reload statistics just because the project order changes', async () => {
        const second = { ...PROJECT, id: 'p2', index: 1 }
        renderer.act(() => {
            store.dispatch(storeLoggedUser({ ...store.getState().loggedUser, projectIds: ['p1', 'p2'] }))
            store.dispatch(setProjectsInitialData([PROJECT, second], { p1: PROJECT, p2: second }, {}, {}, {}, {}))
        })
        readsStatistics({ doneTasks: 2 })
        const tree = await render()
        Backend.getUserStatistics.mockClear()
        await renderer.act(async () =>
            store.dispatch(setProjectsInitialData([second, PROJECT], { p1: PROJECT, p2: second }, {}, {}, {}, {}))
        )
        expect(Backend.getUserStatistics).not.toHaveBeenCalled()
        expect(text(tree)).toContain('"4"')
    })

    it('does not double count a project that answered before the retry', async () => {
        // First attempt: the project reports 4 done tasks and THEN the read is
        // reported offline, which is what a partly-cached load looks like.
        Backend.getUserStatistics.mockImplementation((projectId, userId, date, callback, callbackOffline) => {
            callback(projectId, { doneTasks: 4, donePoints: 0, xp: 0, gold: 0 })
            callbackOffline()
        })
        const tree = await render()
        readsStatistics({ doneTasks: 4, donePoints: 0, xp: 0, gold: 0 })

        await pressReconnect(tree)

        expect(text(tree)).toContain('"4"')
        expect(text(tree)).not.toContain('"8"')
    })
})
