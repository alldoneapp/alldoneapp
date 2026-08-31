import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import OpenTasksAmountContainer, { OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS } from './OpenTasksAmountContainer'
import {
    unwatchOpenTasksAmount,
    watchObservedOpenTasksAmount,
    watchOpenTasksAmount,
    watchUserWorkstreamsOpenTasksAmount,
} from '../../../utils/backends/Tasks/taskNumbers'

/**
 * AT-2445 — "have the open-task counts actually been counted yet?".
 *
 * `openTasksAmount` is a running total spread over one Firestore listener per project and reset to
 * 0 whenever those listeners are rebuilt, so on its own a 0 cannot tell an empty inbox apart from an
 * uncounted one. The all-projects board used to read it bare, render its empty-inbox congrats
 * through the whole loading window, and in doing so spend the once-per-day celebration marker on a
 * frame nobody saw. This container is what answers the question the board now asks.
 */

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))

// Pulls in TasksHelper → BackendBridge → the whole Firebase client otherwise.
jest.mock('../../Workstreams/WorkstreamHelper', () => ({
    isWorkstream: jest.fn(() => false),
}))

jest.mock('../../../utils/backends/Tasks/taskNumbers', () => ({
    watchOpenTasksAmount: jest.fn(),
    watchObservedOpenTasksAmount: jest.fn(),
    watchUserWorkstreamsOpenTasksAmount: jest.fn(),
    unwatchOpenTasksAmount: jest.fn(),
}))

jest.mock('../../../redux/actions', () => ({
    setOpenTasksAmountLoaded: jest.fn(loaded => ({ type: 'Set open tasks amount loaded', loaded })),
    setTaskColdStartEmptyToday: jest.fn(emptyToday => ({ type: 'Set task cold start empty today', emptyToday })),
}))

const mockScheduleTaskColdStartCachePersist = jest.fn()
jest.mock('../../../utils/InitialLoad/taskColdStartCache', () => ({
    scheduleTaskColdStartCachePersist: (...args) => mockScheduleTaskColdStartCachePersist(...args),
}))

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn(() => STATE) },
}))

const STATE = {
    laterTasksExpanded: false,
    somedayTasksExpanded: false,
    currentUser: { uid: 'user-1', temperature: null, recorderUserId: null, workstreams: null },
}

// Each watcher hands back the tokens it registered and keeps its settle callback, so a test can
// deliver first snapshots one listener at a time — which is exactly how a real board loads.
const settleCallbacks = []

const registerTokens =
    prefix =>
    (...args) => {
        const watcherKeys = args[5]
        const onQuerySettled = args[6]
        const tokens = watcherKeys.map((key, index) => `${prefix}-${index}`)
        settleCallbacks.push({ tokens, onQuerySettled })
        return tokens
    }

const loadedDispatches = dispatch =>
    dispatch.mock.calls.filter(([action]) => action.type === 'Set open tasks amount loaded')

describe('OpenTasksAmountContainer readiness (AT-2445)', () => {
    let dispatch

    beforeEach(() => {
        jest.clearAllMocks()
        settleCallbacks.length = 0
        jest.useFakeTimers()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector => selector(STATE))
        watchOpenTasksAmount.mockImplementation(registerTokens('normal'))
        watchObservedOpenTasksAmount.mockImplementation(registerTokens('observed'))
        watchUserWorkstreamsOpenTasksAmount.mockImplementation(registerTokens('workstream'))
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const render = (projectIds = ['project-1', 'project-2']) => {
        let tree
        act(() => {
            tree = renderer.create(<OpenTasksAmountContainer projectIds={projectIds} />)
        })
        return tree
    }

    const settleAll = () =>
        act(() => {
            settleCallbacks.forEach(({ tokens, onQuerySettled }) => tokens.forEach(onQuerySettled))
        })

    it('reports ready only once every registered listener has delivered a first snapshot', () => {
        render()

        expect(loadedDispatches(dispatch)).toHaveLength(0)

        // One project's normal listener arrives. Two projects × three watchers are outstanding, so
        // the board must keep treating a total of 0 as "not counted yet".
        act(() => settleCallbacks[0].onQuerySettled(settleCallbacks[0].tokens[0]))
        expect(loadedDispatches(dispatch)).toHaveLength(0)

        settleAll()

        expect(loadedDispatches(dispatch)).toEqual([[{ type: 'Set open tasks amount loaded', loaded: true }]])
        expect(dispatch).toHaveBeenCalledWith({ type: 'Set task cold start empty today', emptyToday: null })
        expect(mockScheduleTaskColdStartCachePersist).toHaveBeenCalledTimes(1)
    })

    it('announces readiness exactly once, however many snapshots follow', () => {
        render()
        settleAll()
        settleAll()

        expect(loadedDispatches(dispatch)).toHaveLength(1)
    })

    /**
     * `TasksAmountContainers` mounts with `useState([])` for one pass before the real project list
     * arrives. Treating that pass as "counted, and the answer is zero" would reopen the exact hole
     * this closes — the empty-inbox congrats (and its once-per-day celebration) would fire on every
     * board mount, before a single task had been counted.
     */
    it('does not report ready for the empty project list it is first mounted with', () => {
        render([])

        expect(loadedDispatches(dispatch)).toHaveLength(0)
    })

    /**
     * Failing OPEN is deliberate. Every listener also reports on its error branch, so this only
     * covers one that neither succeeds nor fails — and "the congrats never appears again" is a far
     * worse outcome than "it appears a few seconds late".
     */
    it('falls back to ready when a listener never answers at all', () => {
        render()
        expect(loadedDispatches(dispatch)).toHaveLength(0)

        act(() => jest.advanceTimersByTime(OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS))

        expect(loadedDispatches(dispatch)).toHaveLength(1)
    })

    it('stops trusting the counts when the watchers are torn down', () => {
        const tree = render()
        settleAll()

        act(() => tree.unmount())

        // `unwatchOpenTasksAmount` is what resets both the total and the flag, in one place.
        expect(unwatchOpenTasksAmount).toHaveBeenCalledTimes(1)
        // ...and a listener from the retired generation can no longer announce readiness.
        settleAll()
        act(() => jest.advanceTimersByTime(OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS))
        expect(loadedDispatches(dispatch)).toHaveLength(1)
    })
})
