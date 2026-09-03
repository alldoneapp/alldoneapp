import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { AccessibilityInfo } from 'react-native'

import OpenTasksByProject from './OpenTasksByProject'
import { PROJECT_LINE_EXIT_HOLD_MS } from './projectCompletedSweepMotion'
import { PROJECT_SWEEP_PROBE_MS } from './useProjectCompletedSweep'
import {
    markProjectEmptyInboxDayReached,
    resetProjectEmptyInboxCelebrationSessionMarkers,
} from './projectEmptyInboxCelebrationMarker'

let mockState
let mockInSelectedProject

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
    shallowEqual: jest.fn(),
}))
jest.mock('uuid/v4', () => () => 'watcher-key')
jest.mock('../Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('./OpenTasksByDate', () => 'OpenTasksByDate')
jest.mock('./OpenTasksByProjectHandler', () => 'OpenTasksByProjectHandler')
jest.mock('./NeedShowMoreOpenTasksButton', () => 'NeedShowMoreOpenTasksButton')
jest.mock('./BottomShowMoreButtonContainer', () => 'BottomShowMoreButtonContainer')
jest.mock('../OKRs/OKRSection', () => 'OKRSection')
jest.mock('../Header/UpcomingMilestoneRow', () => 'UpcomingMilestoneRow')
jest.mock('../PriorityFilters/TaskFiltersLine', () => 'TaskFiltersLine')
jest.mock('../TaskListSkeleton', () => 'TaskListSkeleton')
jest.mock('../../MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('./OpenTaskViewForAssistants/AssistantScheduleTimeline', () => 'AssistantScheduleDateSection')
jest.mock('../../MyDayView/AssistantLine/useAssistantLineSwitch', () => ({
    useProjectAssistantLine: () => ({ hasAssistantLine: false, assistantLineProps: {} }),
}))
jest.mock('../../../utils/BackendBridge', () => ({ unwatch: jest.fn() }))
jest.mock('../../../utils/backends/OKRs/okrsFirestore', () => ({ watchProjectOKRs: jest.fn() }))
jest.mock('../../../utils/assistantSchedule', () => ({
    buildAssistantProfileTimelineDates: dates =>
        dates.map((dateKey, dateIndex) => ({ dateKey, dateIndex, occurrences: [] })),
}))
jest.mock('../OKRs/okrHelper', () => ({
    getOkrAllProjectsTodayKey: () => 'today',
    getOkrUserTimezone: () => 'UTC',
}))
jest.mock('../../../redux/actions', () => ({ setTasksArrowButtonIsExpanded: jest.fn() }))
jest.mock('../../../utils/backends/openTasks', () => ({
    AMOUNT_TASKS_INDEX: 1,
    ACTIVE_GOALS_INDEX: 2,
    DATE_TASK_INDEX: 0,
    TODAY_DATE: '0',
    watchAllGoals: jest.fn(),
    watchAllMilestones: jest.fn(),
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: () => mockInSelectedProject,
}))

/**
 * AT-2492 (second pass) — the board-level wiring, which is where this feature actually lives or
 * dies.
 *
 * The unit rules are covered in `useProjectCompletedSweep.test.js`. What can only be seen here is
 * the conflict the feature creates with the board itself: in All Projects a cleared project is
 * dropped from the board (`hideProjectData`) at the very moment we want to sweep its line. These
 * cases pin both halves of the resolution — the line stays for the sweep, AND it still leaves
 * afterwards, so the settled board is unchanged.
 */

const USER = 'user-1'
const PROJECT = 'project-a'
const PINNED_NOW = new Date('2026-09-02T10:00:00Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')

const countOf = (tree, type) => tree.root.findAllByType(type).length
const headerOf = tree => tree.root.findAllByType('ProjectHeader')[0]

const buildState = ({ todayIsEmpty, todayCount, filters = [] } = {}) => ({
    loggedUserProjectsMap: { [PROJECT]: { index: 0, id: PROJECT, color: '#2F80ED' } },
    loggedUserProjects: [{ id: PROJECT }],
    selectedProjectIndex: 0,
    currentUser: { uid: USER },
    loggedUser: { uid: USER, isAnonymous: false, okrsHiddenInAllProjectsTodayByProjectAndOkr: {} },
    tasksArrowButtonIsExpanded: false,
    okrsByProjectInTasks: {},
    // One "today" date section, with or without tasks in it.
    filteredOpenTasksStore: { [PROJECT + USER]: [['0', todayIsEmpty ? 0 : 3, []]] },
    taskPriorityFilters: filters,
    taskVmStateFilters: [],
    initialLoadingEndOpenTasks: { [PROJECT + USER]: true },
    initialLoadingEndObservedTasks: { [PROJECT + USER]: true },
    taskListSingleLoading: {},
    thereAreNotTasksInFirstDay: { [PROJECT + USER]: !!todayIsEmpty },
    sidebarNumbers: { [PROJECT]: { [USER]: todayCount } },
})

describe('the completed sweep on the open-tasks board (AT-2492)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
        localStorage.clear()
        resetProjectEmptyInboxCelebrationSessionMarkers()
        mockInSelectedProject = false
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const render = async state => {
        mockState = state
        let tree
        await act(async () => {
            tree = renderer.create(<OpenTasksByProject projectId={PROJECT} sortedLoggedUserProjectIds={[PROJECT]} />)
        })
        return tree
    }

    const update = async (tree, state) => {
        mockState = state
        await act(async () => {
            tree.update(<OpenTasksByProject projectId={PROJECT} sortedLoggedUserProjectIds={[PROJECT]} />)
        })
    }

    describe('in All Projects', () => {
        /**
         * The case the whole second pass exists for. Before it, clearing a project here removed the
         * block in the same commit and there was nothing left to celebrate on.
         */
        it('keeps the cleared project on the board for its sweep, then drops it', async () => {
            // Deliberately NOT pre-seeded: this is the headline user story — the last task of a
            // project is completed while looking at All Projects — so the hook has to observe the
            // clearing itself. Seeding the record would let this pass without that ever working.
            const tree = await render(buildState({ todayIsEmpty: false, todayCount: 1 }))
            expect(countOf(tree, 'ProjectHeader')).toBe(1)

            // The last task of the project is completed.
            await update(tree, buildState({ todayIsEmpty: true, todayCount: 0 }))

            // The line is still there, and it is sweeping.
            expect(countOf(tree, 'ProjectHeader')).toBe(1)
            expect(headerOf(tree).props.completedSweepRunId).toBe(1)
            /**
             * AT-2495 — and the header is told the line is on its way out, which is what turns the
             * sweep's last stage from a settle into the disintegration.
             *
             * The value passed is the board's OWN verdict, deliberately not the held
             * `hideProjectData`: that one is false for the whole hold — that is what the hold IS —
             * so it could never say "this line is leaving" and the row would settle in place and
             * then vanish.
             */
            expect(headerOf(tree).props.completedSweepLineWillLeave).toBe(true)

            // And once the sweep is over the board returns to exactly what it renders today.
            await act(async () => {
                jest.advanceTimersByTime(PROJECT_LINE_EXIT_HOLD_MS + 100)
            })
            expect(countOf(tree, 'ProjectHeader')).toBe(0)
        })

        /**
         * The other half of the same contract: a project whose today list empties for any reason
         * that is NOT a celebration must still disappear at once. 78 project blocks go through this
         * code path on every board load.
         */
        it('drops a project that empties with nothing to celebrate, without delay', async () => {
            // No task was completed today: the count never leaves 0, and the block goes away for
            // some other reason (its last empty-goal row disappearing, a task moved to another
            // project). Nothing was cleared, so nothing is celebrated.
            const tree = await render(buildState({ todayIsEmpty: false, todayCount: 0 }))

            await update(tree, buildState({ todayIsEmpty: true, todayCount: 0 }))

            // Held only for the probe window while we find out...
            await act(async () => {
                jest.advanceTimersByTime(PROJECT_SWEEP_PROBE_MS + 20)
            })
            expect(countOf(tree, 'ProjectHeader')).toBe(0)
        })

        it('never tells a staying line that it is leaving', async () => {
            // A project with tasks left in it is not going anywhere, so its header must never be
            // handed the exit — a masked, collapsed project line that stays on the board is a hole
            // the user cannot click.
            const tree = await render(buildState({ todayIsEmpty: false, todayCount: 1 }))

            expect(countOf(tree, 'ProjectHeader')).toBe(1)
            expect(headerOf(tree).props.completedSweepLineWillLeave).toBe(false)
        })

        it('never sweeps a project that was already off the board when it mounted', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

            const tree = await render(buildState({ todayIsEmpty: true, todayCount: 0 }))

            expect(countOf(tree, 'ProjectHeader')).toBe(0)
        })
    })

    describe('in the selected project', () => {
        beforeEach(() => {
            mockInSelectedProject = true
        })

        it('sweeps the project line and pops the picture as one event', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

            const tree = await render(buildState({ todayIsEmpty: true, todayCount: 0 }))

            const runId = headerOf(tree).props.completedSweepRunId
            expect(runId).toBe(1)
            // The same run id reaches the date section, which forwards it to the Anna picture — so
            // the sweep and the pop are visibly one celebration rather than two that overlap.
            expect(tree.root.findAllByType('OpenTasksByDate')[0].props.projectCelebrationRunId).toBe(runId)
        })

        it('keeps its header whatever happens, so nothing is ever held back', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            const tree = await render(buildState({ todayIsEmpty: true, todayCount: 0 }))

            await act(async () => {
                jest.advanceTimersByTime(PROJECT_LINE_EXIT_HOLD_MS + 100)
            })

            expect(countOf(tree, 'ProjectHeader')).toBe(1)
        })
    })

    describe('the gates', () => {
        beforeEach(() => {
            mockInSelectedProject = true
        })

        /**
         * `thereAreNotTasksInFirstDay` and the filtered store both describe a FILTERED list, so a
         * priority filter empties a project on screen without the project being done at all.
         */
        it('does not celebrate a list emptied by a filter', async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

            const tree = await render(buildState({ todayIsEmpty: true, todayCount: 0, filters: ['high'] }))

            expect(headerOf(tree).props.completedSweepRunId).toBe(0)
        })

        it("does not celebrate on somebody else's board", async () => {
            markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)
            const state = buildState({ todayIsEmpty: true, todayCount: 0 })
            state.currentUser = { uid: 'assistant-1' }

            const tree = await render(state)

            expect(headerOf(tree).props.completedSweepRunId).toBe(0)
        })
    })
})
