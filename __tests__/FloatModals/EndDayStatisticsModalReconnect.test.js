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

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'
import moment from 'moment'

jest.mock('lottie-react', () => () => null)

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
    normalizeDayRateTimeLogConfig: () => ({ enabled: false }),
    reconcileProjectDayRateTimeLogsBackfill: jest.fn(() => Promise.resolve()),
}))

jest.mock('../../utils/connectionHealth', () => ({
    CONNECTION_HEALTH_LIVE: 'live',
    reconnectNow: jest.fn(),
}))

import EndDayStatisticsModal, {
    RECONNECT_STATISTICS_TIMEOUT_MS,
} from '../../components/UIComponents/FloatModals/EndDayStatisticsModal'
import store from '../../redux/store'
import {
    setProjectsInitialData,
    setShowNewDayNotification,
    setSidebarNumbers,
    storeLoggedUser,
} from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import { reconnectNow } from '../../utils/connectionHealth'
import { setUserStatisticsModalDate } from '../../utils/backends/Users/usersFirestore'

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
        setUserStatisticsModalDate.mockResolvedValue(undefined)
        reconnectNow.mockResolvedValue('live')
        readsOffline()
        renderer.act(() => {
            store.dispatch(setShowNewDayNotification(false))
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
        expect(text(tree)).toContain('Reconnect now')
    })

    it('does not offer it when the statistics loaded normally', async () => {
        readsStatistics({ doneTasks: 4, donePoints: 7, xp: 30, gold: 2 })

        const tree = await render()

        expect(has(tree, 'newDayReconnectButton')).toBe(false)
        expect(has(tree, 'startNewDayButton')).toBe(true)
    })

    it('shows the real summary in place once the connection is back', async () => {
        const tree = await render()
        readsStatistics({ doneTasks: 4, donePoints: 7, xp: 30, gold: 2 })

        await pressReconnect(tree)

        expect(reconnectNow).toHaveBeenCalledTimes(1)
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
        reconnectNow.mockResolvedValue('offline')
        const tree = await render()

        await pressReconnect(tree)

        expect(Backend.getUserStatistics).toHaveBeenCalledTimes(1) // no pointless re-read
        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        expect(has(tree, 'startNewDayButton')).toBe(true)
        expect(text(tree)).toContain('Still no connection')
    })

    it('can be pressed again after a failed attempt', async () => {
        reconnectNow.mockResolvedValue('offline')
        const tree = await render()

        await pressReconnect(tree)
        reconnectNow.mockResolvedValue('live')
        readsStatistics({ doneTasks: 2, donePoints: 3, xp: 10, gold: 1 })
        await pressReconnect(tree)

        expect(reconnectNow).toHaveBeenCalledTimes(2)
        expect(has(tree, 'newDayReconnectButton')).toBe(false)
        expect(text(tree)).toContain('"2"')
    })

    it('survives a reconnect that throws, rather than leaving a spinner', async () => {
        reconnectNow.mockRejectedValue(new Error('boom'))
        const tree = await render()

        await pressReconnect(tree)

        expect(has(tree, 'newDayReconnectButton')).toBe(true)
        expect(text(tree)).toContain('Still no connection')
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
