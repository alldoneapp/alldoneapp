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

// Each section mounts the whole task-list stack; this suite is only about the board-level
// calendar refresh that sits above them.
jest.mock('./OpenTasksSection', () => () => null)
jest.mock('./PendingTasksSection', () => () => null)
jest.mock('./DoneTasksSection', () => () => null)
jest.mock('./InProgressTasksSection', () => () => null)

import TasksByProjectSections from './TasksByProjectSections'
import { TASK_BOARD_CALENDAR_SYNC_DELAY_MS } from './taskBoardCalendarSync'

const ALL_PROJECTS_INDEX = -1

const buildState = ({ selectedProjectIndex, taskViewToggleSection = 'Open' }) => ({
    taskViewToggleSection,
    selectedProjectIndex,
    currentUser: { uid: 'user-1' },
    loggedUser: {
        uid: 'user-1',
        isAnonymous: false,
        apisConnected: {
            'project-private': { calendar: true, calendarDefault: true },
            'project-other': { calendar: false },
        },
    },
})

/**
 * AT-2480 - the board-level wiring, which is where the reported bug lived.
 *
 * A meeting exists in Alldone only after `syncCalendarEventsSecondGen` has run for the user's
 * local day, and on this board that callable had exactly one trigger: a per-project effect in
 * `OpenTasksByProjectHandler` gated on `inSelectedProject`. So All Projects never pulled the day's
 * events and meetings showed up only once the user selected the project holding the calendar
 * connection. Against that code the first case here sees zero calls.
 */
describe('TasksByProjectSections calendar refresh', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockCheckIfCalendarConnected.mockClear()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const renderBoard = options => {
        mockState = buildState(options)
        act(() => {
            renderer.create(<TasksByProjectSections />)
        })
        act(() => {
            jest.advanceTimersByTime(TASK_BOARD_CALENDAR_SYNC_DELAY_MS)
        })
    }

    it('pulls the connected calendar while All Projects is selected', () => {
        renderBoard({ selectedProjectIndex: ALL_PROJECTS_INDEX })

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledWith('project-private')
    })

    it('still pulls it while a single project is selected', () => {
        renderBoard({ selectedProjectIndex: 4 })

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledWith('project-private')
    })

    // The In progress tab also renders `OpenTasksByProjectHandler`, so it used to trigger the
    // sync as well. Hosting the refresh here keeps every toggle covered.
    it('still pulls it from the In progress tab', () => {
        renderBoard({ selectedProjectIndex: 4, taskViewToggleSection: 'In progress' })

        expect(mockCheckIfCalendarConnected).toHaveBeenCalledWith('project-private')
    })
})
