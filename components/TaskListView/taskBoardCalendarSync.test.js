import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockCheckIfCalendarConnected = jest.fn()

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    shallowEqual: (left, right) => left === right,
}))

jest.mock('../../utils/backends/firestore', () => ({
    checkIfCalendarConnected: (...args) => mockCheckIfCalendarConnected(...args),
}))

import {
    TASK_BOARD_CALENDAR_SYNC_DELAY_MS,
    getCalendarConnectedProjectIdsFromApis,
    useTaskBoardCalendarSync,
} from './taskBoardCalendarSync'

function Probe() {
    useTaskBoardCalendarSync()
    return null
}

const buildState = ({
    apisConnected = {},
    uid = 'user-1',
    currentUserId = 'user-1',
    isAnonymous = false,
    selectedProjectIndex = -1,
} = {}) => ({
    selectedProjectIndex,
    currentUser: { uid: currentUserId },
    loggedUser: { uid, isAnonymous, apisConnected },
})

const CONNECTED_PRIVATE_AND_WORK = {
    // The reported account's shape: the calendar lives on the private (default) project, a second
    // one on the work project, and a third project has the integration switched off.
    'project-private': { calendar: true, calendarDefault: true, calendarEmail: 'me@gmail.com' },
    'project-work': { calendar: true, calendarDefault: false, calendarEmail: 'me@work.com' },
    'project-off': { calendar: false, gmail: false },
}

const renderProbe = () => {
    let tree
    act(() => {
        tree = renderer.create(<Probe />)
    })
    return tree
}

const flushSyncDelay = () => {
    act(() => {
        jest.advanceTimersByTime(TASK_BOARD_CALENDAR_SYNC_DELAY_MS)
    })
}

describe('getCalendarConnectedProjectIdsFromApis', () => {
    it('returns only the projects whose calendar integration is on', () => {
        expect(getCalendarConnectedProjectIdsFromApis(CONNECTED_PRIVATE_AND_WORK)).toEqual([
            'project-private',
            'project-work',
        ])
    })

    it('survives a missing or empty apisConnected map', () => {
        expect(getCalendarConnectedProjectIdsFromApis(undefined)).toEqual([])
        expect(getCalendarConnectedProjectIdsFromApis({})).toEqual([])
    })

    // The ids form the effect's dependency key, so an `apisConnected` rewrite that only changes
    // key order must not read as a new set of connections and re-trigger the sync.
    it('orders the ids so the same connections always produce the same key', () => {
        expect(getCalendarConnectedProjectIdsFromApis({ b: { calendar: true }, a: { calendar: true } })).toEqual([
            'a',
            'b',
        ])
    })
})

describe('useTaskBoardCalendarSync', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockCheckIfCalendarConnected.mockClear()
        mockState = buildState()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    // AT-2480 - the regression itself. `selectedProjectIndex === -1` is All Projects: before the
    // fix nothing on this board pulled the day's events, so meetings existed only after the user
    // selected the one project holding the connection.
    it('syncs every connected calendar while All Projects is selected', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK, selectedProjectIndex: -1 })

        renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected.mock.calls.map(([projectId]) => projectId)).toEqual([
            'project-private',
            'project-work',
        ])
    })

    // A project can hold meetings routed to it from another project's calendar
    // (`calendarProjectRouting`), so the pull must not be limited to the selected project's own
    // connection either.
    it('syncs every connected calendar while a single project is selected', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK, selectedProjectIndex: 3 })

        renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledTimes(2)
    })

    it('gives the first task snapshots the network before it syncs', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK })

        renderProbe()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()

        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).toHaveBeenCalled()
    })

    it('does not sync a project whose calendar integration is off', () => {
        mockState = buildState({ apisConnected: { 'project-off': { calendar: false } } })

        renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()
    })

    it('does nothing without any connected calendar', () => {
        renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()
    })

    it('does not sync for an anonymous user', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK, isAnonymous: true })

        renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()
    })

    // The assistant profile board renders the same task views for an assistant `currentUser`;
    // these connections belong to the signed-in human.
    it('does not sync while another user is being rendered', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK, currentUserId: 'assistant-1' })

        renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()
    })

    // Switching All Projects <-> a project re-renders this hook without unmounting it. Repeating
    // the callable there would put a multi-second Cloud Function call on every switch.
    it('syncs once per mount however often the board re-renders', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK })

        const tree = renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledTimes(2)

        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK, selectedProjectIndex: 2 })
        act(() => {
            tree.update(<Probe />)
        })
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledTimes(2)
    })

    // Connecting a calendar has to take effect on the board the user is already looking at.
    it('syncs a calendar connected after the board was mounted', () => {
        mockState = buildState({ apisConnected: {} })

        const tree = renderProbe()
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()

        mockState = buildState({ apisConnected: { 'project-private': { calendar: true } } })
        act(() => {
            tree.update(<Probe />)
        })
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledWith('project-private')
    })

    it('does not fire a sync scheduled by a board that unmounted first', () => {
        mockState = buildState({ apisConnected: CONNECTED_PRIVATE_AND_WORK })

        const tree = renderProbe()
        act(() => {
            tree.unmount()
        })
        flushSyncDelay()

        expect(mockCheckIfCalendarConnected).not.toHaveBeenCalled()
    })
})
