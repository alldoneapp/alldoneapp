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
