import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import OpenTasksViewAllProjects from './OpenTasksViewAllProjects'
import MyDayOpenTasks from '../../MyDayView/MyDayTasks/MyDayOpenTasks/MyDayOpenTasks'
import { getProjectIdsForAllProjectsTasks } from './openTasksViewProjectScope'
import useNearViewportMount from '../../../hooks/useNearViewportMount'
import useRateLimitedProjectMountQueue from '../../../hooks/useRateLimitedProjectMountQueue'
import { resetEmptyInboxCelebrationSessionMarkers } from '../../SettingsView/Profile/Achievements/emptyInboxCelebrationMarker'
import { CELEBRATION_CLAIM_SETTLE_MS } from '../../SettingsView/Profile/Achievements/useTodayEmptyInboxCelebration'

/**
 * AT-2506 — "when empty inbox for today is reached (in both all projects and a single project
 * selected) we should always play the animation."
 *
 * This suite exists because of WHERE the defect lived. Every unit around it was correct: the
 * marker remembered the day, the motion played when handed a run id, the achievement day was
 * written. What was wrong was the mounting relationship — the decision was made inside
 * `AllProjectsEmptyInbox`, a component that exists only WHILE the inbox is empty, so it mounts
 * because the count reached zero and its first render is already the empty state. It could not
 * distinguish "the inbox just emptied in front of you" from "you arrived at an empty board", and
 * defaulted to the second, so the second and every later clearing of a day was silent.
 *
 * A test of the hook alone cannot see that: hand it a transition and it behaves. So these drive the
 * REAL boards through the real sequence a working day produces — clear it, refill it, clear it
 * again — and read the run id off the block the boards render. Move the decision back down into the
 * block and both cases fail.
 *
 * The block itself is stubbed on purpose. What is under test is which run id reaches it, not what
 * the confetti does with it; `EmptyInboxCongratsCelebration.test.js` owns that half.
 */

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('./AllProjectsEmptyInbox', () => 'AllProjectsEmptyInbox')
jest.mock('./OpenTasksByProject', () => 'OpenTasksByProject')
jest.mock('./AllProjectsShowMoreButtonContainer', () => 'AllProjectsShowMoreButtonContainer')
jest.mock('./AllProjectsShowMoreAvailability', () => 'AllProjectsShowMoreAvailability')
jest.mock('../Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../PriorityFilters/TaskFiltersLine', () => 'TaskFiltersLine')
jest.mock('../EmailLine/EmailLine', () => 'EmailLine')
jest.mock('../EmailLine/emailLineFeature', () => ({ EMAIL_LINE_ENABLED: true }))
jest.mock('../../MyDayView/AssistantLine/AllProjectsAssistantLine', () => 'AllProjectsAssistantLine')
jest.mock('../TaskListSkeleton', () => 'TaskListSkeleton')
jest.mock('../../../hooks/useNearViewportMount', () => jest.fn())
jest.mock('../../../hooks/useRateLimitedProjectMountQueue', () => jest.fn())
jest.mock('./openTasksViewProjectScope', () => ({
    getProjectIdsForAllProjectsTasks: jest.fn(() => ['project-1']),
}))
jest.mock('@hello-pangea/dnd', () => ({ DragDropContext: 'DragDropContext' }))
jest.mock('../../MyDayView/MyDayTasks/MyDayOpenTasks/MyDaySelectedTasks', () => 'MyDaySelectedTasks')
jest.mock('../../MyDayView/MyDayTasks/MyDayOpenTasks/MoreTasksLine', () => 'MoreTasksLine')
jest.mock('../../MyDayView/MyDayTasks/MyDayOpenTasks/MyDayOtherTasks', () => 'MyDayOtherTasks')
jest.mock('../../DragSystem/MyDayDragHelper', () => ({ onBeforeCapture: jest.fn(), onDragEnd: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    resetLoadingData: jest.fn(() => ({ type: 'Reset loading data' })),
    setLaterTasksExpandState: jest.fn(state => ({ type: 'Set later tasks expand state', state })),
    setActiveDragTaskModeInMyDay: jest.fn(active => ({ type: 'Set active drag task mode in my day', active })),
}))

const USER = 'user-1'
const todayKey = () => moment().format('YYYY-MM-DD')

// The block is rendered only while the inbox is empty, so "is it there" and "what run did it get"
// are the two things every case below reads.
const emptyInboxRunId = tree => {
    const blocks = tree.root.findAllByType('AllProjectsEmptyInbox')
    return blocks.length === 0 ? null : blocks[0].props.celebrationRunId
}

const loggedUser = () => ({
    uid: USER,
    emptyInboxDays: [todayKey()],
    lastDayEmptyInbox: null,
    projectIds: ['project-1'],
    guideProjectIds: [],
    archivedProjectIds: [],
    templateProjectIds: [],
    inFocusTaskProjectId: null,
})

const allProjectsState = openTasksAmount => ({
    smallScreenNavigation: false,
    isMiddleScreen: false,
    openTasksAmount,
    openTasksAmountLoaded: true,
    taskColdStartEmptyToday: null,
    todayEmptyGoalsTotalAmountInOpenTasksView: { total: 0 },
    loggedUserProjectsMap: {},
    currentUser: { uid: USER },
    openTasksStore: {},
    filteredOpenTasksStore: {},
    initialLoadingEndOpenTasks: {},
    initialLoadingEndObservedTasks: {},
    loggedUser: loggedUser(),
})

const myDayState = taskCount => ({
    loggedUser: loggedUser(),
    myDaySelectedTasks: Array.from({ length: taskCount }, (unused, index) => ({ id: `task-${index}` })),
    myDayOtherTasks: [],
    myDaySortingOtherTasks: [],
    myDayShowAllTasks: false,
    activeDragTaskModeInMyDay: false,
    myDayAllTodayTasks: { loaded: true },
})

describe('the empty-inbox celebration always plays when the inbox is reached (AT-2506)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers({ doNotFake: ['Date', 'performance'] })
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        useDispatch.mockReturnValue(jest.fn())
        getProjectIdsForAllProjectsTasks.mockReturnValue(['project-1'])
        useNearViewportMount.mockImplementation(() => ({
            placeholderRef: { current: null },
            isNearViewport: true,
            hasPassedViewport: false,
        }))
        useRateLimitedProjectMountQueue.mockReturnValue({
            mountedProjectCount: 1,
            mountedProjectIndexes: [0],
            preloadingProjectIndexes: [],
            markProjectNearViewport: jest.fn(),
            preloadingProjectSkipped: false,
            retainedProjectSnapshotStates: {},
        })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    // The run is watched to the end, i.e. the day is genuinely spent rather than refundable.
    const playOutCelebration = () => act(() => jest.advanceTimersByTime(CELEBRATION_CLAIM_SETTLE_MS))

    describe.each([
        ['All Projects', OpenTasksViewAllProjects, allProjectsState],
        ['My Day', MyDayOpenTasks, myDayState],
    ])('on the %s board', (boardName, Board, stateFor) => {
        const render = count => {
            useSelector.mockImplementation(selector => selector(stateFor(count)))
            let tree
            act(() => {
                tree = renderer.create(<Board />)
            })
            return tree
        }

        const setTaskCount = (tree, count) => {
            useSelector.mockImplementation(selector => selector(stateFor(count)))
            act(() => tree.update(<Board key="board" />))
        }

        it('celebrates every clearing of the day, not just the first', () => {
            const tree = render(3)
            expect(emptyInboxRunId(tree)).toBeNull()

            // The last task of the morning is ticked off.
            setTaskCount(tree, 0)
            expect(emptyInboxRunId(tree)).toBe(1)
            playOutCelebration()

            // The afternoon's work lands...
            setTaskCount(tree, 2)
            expect(emptyInboxRunId(tree)).toBeNull()

            // ...and is cleared too. Before AT-2506 this was silent: the block remounted, its own
            // hook saw the day already marked, and returned a run id of 0.
            setTaskCount(tree, 0)
            expect(emptyInboxRunId(tree)).toBe(2)
            playOutCelebration()

            setTaskCount(tree, 1)
            setTaskCount(tree, 0)
            expect(emptyInboxRunId(tree)).toBe(3)
        })

        // The other half of the rule, and the reason this cannot simply be "celebrate whenever the
        // board is empty": arriving at an inbox that was already clear is not an achievement, so a
        // reload or a hop between the two boards must stay silent.
        it('does not replay when the board is opened on an inbox that was already empty', () => {
            const first = render(2)
            setTaskCount(first, 0)
            expect(emptyInboxRunId(first)).toBe(1)
            playOutCelebration()
            act(() => first.unmount())

            const revisit = render(0)

            expect(emptyInboxRunId(revisit)).toBe(0)
        })
    })

    /**
     * The two boards share one marker, which is what makes them one celebration rather than two.
     * Clearing your inbox in My Day and then opening All Projects must not congratulate you twice
     * for the same moment — but the NEXT clearing, wherever you are, still counts.
     */
    it('does not repeat one clearing across the two boards, but still plays the next one', () => {
        useSelector.mockImplementation(selector => selector(myDayState(2)))
        let myDay
        act(() => {
            myDay = renderer.create(<MyDayOpenTasks />)
        })

        useSelector.mockImplementation(selector => selector(myDayState(0)))
        act(() => myDay.update(<MyDayOpenTasks key="myDay" />))
        expect(emptyInboxRunId(myDay)).toBe(1)
        playOutCelebration()
        act(() => myDay.unmount())

        // Switching to All Projects, still empty: the same moment, already celebrated.
        useSelector.mockImplementation(selector => selector(allProjectsState(0)))
        let allProjects
        act(() => {
            allProjects = renderer.create(<OpenTasksViewAllProjects />)
        })
        expect(emptyInboxRunId(allProjects)).toBe(0)

        // New tasks arrive and are cleared from this board. That is a new moment, and it plays.
        useSelector.mockImplementation(selector => selector(allProjectsState(4)))
        act(() => allProjects.update(<OpenTasksViewAllProjects key="allProjects" />))
        useSelector.mockImplementation(selector => selector(allProjectsState(0)))
        act(() => allProjects.update(<OpenTasksViewAllProjects key="allProjects" />))

        expect(emptyInboxRunId(allProjects)).toBe(1)
    })

    /**
     * `unwatchOpenTasksAmount` writes `null` and rebuilds the count listeners on every Later/Someday
     * toggle, so the amount routinely goes positive → null → 0 with no task completed. Reading that
     * as a clearing would congratulate the user for pressing a disclosure arrow.
     */
    it('does not read a watcher rebuild as a clearing', () => {
        const tree = render_allProjects(3)

        useSelector.mockImplementation(selector => selector(allProjectsState(0)))
        act(() => tree.update(<OpenTasksViewAllProjects key="board" />))
        expect(emptyInboxRunId(tree)).toBe(1)
        playOutCelebration()

        useSelector.mockImplementation(selector => selector(allProjectsState(null)))
        act(() => tree.update(<OpenTasksViewAllProjects key="board" />))
        useSelector.mockImplementation(selector => selector(allProjectsState(0)))
        act(() => tree.update(<OpenTasksViewAllProjects key="board" />))

        expect(emptyInboxRunId(tree)).toBe(1)
    })

    function render_allProjects(count) {
        useSelector.mockImplementation(selector => selector(allProjectsState(count)))
        let tree
        act(() => {
            tree = renderer.create(<OpenTasksViewAllProjects />)
        })
        return tree
    }
})
