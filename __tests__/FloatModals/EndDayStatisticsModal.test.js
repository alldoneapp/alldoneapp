/**
 * AT-2367 — the "Start new day" popup must close on the tap, not on the ack.
 *
 * This drives the real component against the real redux store, with only the
 * network edges mocked, and the key mock is deliberate: BOTH Firestore writes
 * never settle. That is exactly what a stalled mobile connection (and every
 * offline session) looks like, and under the old handler — which awaited the
 * happiness writes, then the user-document write, then a full app reload —
 * the popup stayed on screen with its spinner forever.
 *
 * A zero-project user is used because it is the smallest state that renders
 * the popup: the data-loading effect short-circuits on `projectIdsAmount === 0`
 * and `checkIfDataIsLoaded()` is satisfied by the empty map it sets.
 */

import { newDayRecoveryStore, createNewDayRecoveryStore } from '../../utils/newDayRecoveryStore'
import { dayReloadCoordinator, createDayReloadCoordinator } from '../../utils/dayReloadCoordinator'

beforeEach(() => {
    localStorage.clear()
    Object.assign(newDayRecoveryStore, createNewDayRecoveryStore())
    Object.assign(dayReloadCoordinator, createDayReloadCoordinator())
    store.dispatch(setShowNewDayNotification(false))
    jest.clearAllMocks()
    readNewDayAcknowledgement.mockReset().mockResolvedValue(null)
    setUserStatisticsModalDate.mockReset().mockImplementation(() => new Promise(() => {}))
})

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'
import moment from 'moment'

jest.mock('lottie-react', () => () => null)
jest.mock('../../utils/backends/Users/newDayAcknowledgement', () => ({
    readNewDayAcknowledgement: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('../../utils/appResume', () => ({ subscribePageVisible: jest.fn(() => jest.fn()) }))

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
    setUserStatisticsModalDate: jest.fn(() => new Promise(() => {})),
}))

jest.mock('../../utils/UserDataCache', () => ({
    setCachedUserData: jest.fn(),
}))

import EndDayStatisticsModal from '../../components/UIComponents/FloatModals/EndDayStatisticsModal'
import store from '../../redux/store'
import { setShowNewDayNotification, storeLoggedUser } from '../../redux/actions'
import { deleteCacheAndRefresh } from '../../utils/Observers'
import { setUserStatisticsModalDate } from '../../utils/backends/Users/usersFirestore'
import { readNewDayAcknowledgement } from '../../utils/backends/Users/newDayAcknowledgement'
import { subscribePageVisible } from '../../utils/appResume'

const YESTERDAY = moment().subtract(1, 'day').startOf('day').add(9, 'hours').valueOf()

const signIn = () =>
    store.dispatch(
        storeLoggedUser({
            uid: 'user-1',
            isAnonymous: false,
            projectIds: [],
            templateProjectIds: [],
            archivedProjectIds: [],
            guideProjectIds: [],
            statisticsModalDate: YESTERDAY,
        })
    )

let currentTree = null

afterEach(() => {
    if (currentTree) renderer.act(() => currentTree.unmount())
    currentTree = null
    jest.useRealTimers()
})

const render = () => {
    let tree
    renderer.act(() => {
        tree = renderer.create(
            <Provider store={store}>
                <EndDayStatisticsModal />
            </Provider>
        )
    })
    currentTree = tree
    return tree
}

const pressStartNewDay = tree => {
    const button = tree.root.findByProps({ testID: 'startNewDayButton' })
    renderer.act(() => {
        button.props.onPress({ preventDefault: () => {}, stopPropagation: () => {} })
    })
}

describe('EndDayStatisticsModal — "Start new day" (AT-2367)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        setUserStatisticsModalDate.mockImplementation(() => new Promise(() => {}))
        renderer.act(() => {
            store.dispatch(setShowNewDayNotification(false))
            signIn()
        })
    })

    afterEach(() => {
        if (currentTree) renderer.act(() => currentTree.unmount())
        currentTree = null
    })

    it('shows the popup while the day still needs to be acknowledged', () => {
        const tree = render()

        expect(tree.root.findAllByProps({ testID: 'startNewDayButton' }).length).toBeGreaterThan(0)
    })

    it('closes the popup on the tap, before the Firestore write is acknowledged', () => {
        const tree = render()

        pressStartNewDay(tree)

        // The write is still in flight — it never resolves in this test.
        expect(setUserStatisticsModalDate).toHaveBeenCalledTimes(1)
        expect(tree.toJSON()).toBeNull()
    })

    it('acknowledges the day in local state so nothing re-opens it', () => {
        const tree = render()

        pressStartNewDay(tree)

        const { loggedUser, showNewDayNotification } = store.getState()
        expect(loggedUser.statisticsModalDate).toBeGreaterThan(YESTERDAY)
        expect(loggedUser.previousStatisticsModalDate).toBe(YESTERDAY)
        expect(showNewDayNotification).toBe(false)
        expect(tree.toJSON()).toBeNull()
    })

    it('does not reload the app when this device did not cross midnight while open', () => {
        const tree = render()

        pressStartNewDay(tree)

        expect(deleteCacheAndRefresh).not.toHaveBeenCalled()
    })

    it('reloads the device whose watchers are still on yesterday — after closing', async () => {
        // Acked normally here: the point of this test is the ORDER, and the
        // grace period before the reload is covered in StartNewDayFlow.test.js.
        setUserStatisticsModalDate.mockResolvedValue(undefined)
        renderer.act(() => store.dispatch(setShowNewDayNotification(true)))
        const tree = render()

        pressStartNewDay(tree)

        // Closed immediately; the reload is what happens next, not what the
        // popup waits for.
        expect(tree.toJSON()).toBeNull()
        await renderer.act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0))
        })
        expect(deleteCacheAndRefresh).toHaveBeenCalledTimes(1)
    })

    /**
     * The reported symptom, verbatim: "stays open forever", on an installed
     * iPhone PWA. There the reload path is taken (the PWA is resumed the next
     * morning, so the midnight timer has fired) and `deleteCacheAndRefresh`
     * could hang before ever calling `location.reload()` — its service worker
     * update check is a network fetch. The popup used to close only after that
     * call returned, so it never closed at all.
     */
    it('closes even when the app reload never happens', () => {
        setUserStatisticsModalDate.mockResolvedValue(undefined)
        deleteCacheAndRefresh.mockImplementation(() => new Promise(() => {}))
        renderer.act(() => store.dispatch(setShowNewDayNotification(true)))
        const tree = render()

        pressStartNewDay(tree)

        expect(tree.toJSON()).toBeNull()
    })

    it('ignores a second tap landing in the same frame', () => {
        const tree = render()
        const button = tree.root.findByProps({ testID: 'startNewDayButton' })

        renderer.act(() => {
            button.props.onPress({ preventDefault: () => {}, stopPropagation: () => {} })
            button.props.onPress({ preventDefault: () => {}, stopPropagation: () => {} })
        })

        expect(setUserStatisticsModalDate).toHaveBeenCalledTimes(1)
    })
})

it('dismisses a stale Mac popup using the phone confirmation from the independent server read', async () => {
    signIn()
    readNewDayAcknowledgement.mockResolvedValue({
        statisticsModalDate: Date.now(),
        previousStatisticsModalDate: YESTERDAY,
    })
    const tree = render()
    await renderer.act(async () => {})
    expect(tree.toJSON()).toBeNull()
    expect(setUserStatisticsModalDate).not.toHaveBeenCalled()
    // A late SDK/cache snapshot must not undo the authoritative confirmation.
    renderer.act(() => signIn())
    expect(tree.toJSON()).toBeNull()
})

it('checks another device confirmation again when the Mac resumes', async () => {
    readNewDayAcknowledgement.mockResolvedValue(null)
    signIn()
    const tree = render()
    await renderer.act(async () => {})
    const resume = subscribePageVisible.mock.calls.at(-1)[0]
    readNewDayAcknowledgement.mockResolvedValue({
        statisticsModalDate: Date.now(),
        previousStatisticsModalDate: YESTERDAY,
    })
    await renderer.act(async () => resume())
    expect(tree.toJSON()).toBeNull()
})

it('reloads the Mac whose watchers are still on yesterday when the phone confirmation arrives', async () => {
    signIn()
    store.dispatch(setShowNewDayNotification(true))
    readNewDayAcknowledgement.mockResolvedValue({
        statisticsModalDate: Date.now(),
        previousStatisticsModalDate: YESTERDAY,
    })
    const tree = render()
    await renderer.act(async () => {})
    expect(tree.toJSON()).toBeNull()
    expect(store.getState().showNewDayNotification).toBe(false)
    expect(deleteCacheAndRefresh).toHaveBeenCalledTimes(1)
    expect(deleteCacheAndRefresh).toHaveBeenCalledWith(undefined, 'new-day-confirmed-elsewhere')
    expect(setUserStatisticsModalDate).not.toHaveBeenCalled()
})

it('does not reload a device already running today when the phone confirmation arrives', async () => {
    signIn()
    readNewDayAcknowledgement.mockResolvedValue({
        statisticsModalDate: Date.now(),
        previousStatisticsModalDate: YESTERDAY,
    })
    const tree = render()
    await renderer.act(async () => {})
    expect(tree.toJSON()).toBeNull()
    expect(deleteCacheAndRefresh).not.toHaveBeenCalled()
})

it('keeps the queued daily reload and does not add a second reload on remote confirmation', async () => {
    signIn()
    store.dispatch(setShowNewDayNotification(true))
    let finishRead
    readNewDayAcknowledgement.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishRead = resolve
            })
    )
    const tree = render()
    const dailyReload = jest.fn()
    dayReloadCoordinator.request(dailyReload)
    expect(dailyReload).not.toHaveBeenCalled()
    await renderer.act(async () =>
        finishRead({ statisticsModalDate: Date.now(), previousStatisticsModalDate: YESTERDAY })
    )
    expect(tree.toJSON()).toBeNull()
    expect(dailyReload).toHaveBeenCalledTimes(1)
    expect(deleteCacheAndRefresh).not.toHaveBeenCalled()
})

it('retains a required remote-confirmation reload while a pending task write makes navigation unsafe', async () => {
    let safe = false
    Object.assign(dayReloadCoordinator, createDayReloadCoordinator({ isSafe: () => safe }))
    signIn()
    store.dispatch(setShowNewDayNotification(true))
    readNewDayAcknowledgement.mockResolvedValue({
        statisticsModalDate: Date.now(),
        previousStatisticsModalDate: YESTERDAY,
    })
    const tree = render()
    await renderer.act(async () => {})
    expect(tree.toJSON()).toBeNull()
    expect(deleteCacheAndRefresh).not.toHaveBeenCalled()
    safe = true
    dayReloadCoordinator.retry()
    expect(deleteCacheAndRefresh).toHaveBeenCalledTimes(1)
})

it('retries a failed phone confirmation automatically while keeping the popup closed', async () => {
    jest.useFakeTimers()
    readNewDayAcknowledgement.mockResolvedValue(null)
    setUserStatisticsModalDate
        .mockRejectedValueOnce(Object.assign(new Error('Timed out'), { code: 'deadline-exceeded' }))
        .mockResolvedValueOnce(undefined)
    signIn()
    const tree = render()
    pressStartNewDay(tree)
    await renderer.act(async () => {})
    expect(newDayRecoveryStore.getAcknowledgement('user-1').pending).toBe(true)
    expect(tree.toJSON()).toBeNull()
    await renderer.act(async () => {
        await jest.advanceTimersByTimeAsync(10000)
    })
    expect(setUserStatisticsModalDate).toHaveBeenCalledTimes(2)
    expect(newDayRecoveryStore.getAcknowledgement('user-1').pending).toBe(false)
    expect(tree.toJSON()).toBeNull()
})

it('keeps the day startable when the independent server check fails', async () => {
    signIn()
    readNewDayAcknowledgement.mockRejectedValueOnce(new Error('No connection'))
    const tree = render()
    await renderer.act(async () => {})
    expect(tree.root.findAllByProps({ testID: 'startNewDayButton' }).length).toBeGreaterThan(0)
    pressStartNewDay(tree)
    expect(tree.toJSON()).toBeNull()
})

it('ignores a server reconciliation result after switching accounts', async () => {
    signIn()
    let finishRead
    readNewDayAcknowledgement.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finishRead = resolve
            })
    )
    const tree = render()
    renderer.act(() => store.dispatch(storeLoggedUser({ ...store.getState().loggedUser, uid: 'user-2' })))
    await renderer.act(async () =>
        finishRead({ statisticsModalDate: Date.now(), previousStatisticsModalDate: YESTERDAY })
    )
    expect(store.getState().loggedUser.uid).toBe('user-2')
    expect(store.getState().loggedUser.statisticsModalDate).toBe(YESTERDAY)
    expect(tree.root.findAllByProps({ testID: 'startNewDayButton' }).length).toBeGreaterThan(0)
})

it('keeps a confirmed day closed after a stale user snapshot and a fresh popup mount', async () => {
    signIn()
    const first = render()
    pressStartNewDay(first)
    renderer.act(() => signIn()) // stale server/cache snapshot
    expect(first.toJSON()).toBeNull()
    renderer.act(() => first.unmount())
    Object.assign(newDayRecoveryStore, createNewDayRecoveryStore())
    const replacement = render()
    expect(replacement.toJSON()).toBeNull()
    await renderer.act(async () => {})
    expect(setUserStatisticsModalDate).toHaveBeenCalledWith(YESTERDAY, expect.any(Number), 'user-1')
})

it('holds a queued daily reload until the popup is closed and the write grace has elapsed', async () => {
    jest.useFakeTimers()
    setUserStatisticsModalDate.mockImplementation(() => new Promise(() => {}))
    signIn()
    const tree = render()
    const reload = jest.fn()
    dayReloadCoordinator.request(reload)
    expect(reload).not.toHaveBeenCalled()
    pressStartNewDay(tree)
    expect(tree.toJSON()).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    await renderer.act(async () => {
        await jest.advanceTimersByTimeAsync(1200)
    })
    expect(reload).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
})
