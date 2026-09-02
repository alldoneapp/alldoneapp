import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'

import OpenTasksByDate from './OpenTasksByDate'
import { AMOUNT_TASKS_INDEX, DATE_TASK_INDEX, EMPTY_SECTION_INDEX, TODAY_DATE } from '../../../utils/backends/openTasks'
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
jest.mock('../../../redux/actions', () => ({
    removeActiveDragTaskModeInDate: jest.fn(),
    setSelectedTasks: jest.fn(),
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    AMOUNT_TASKS_INDEX: 1,
    DATE_TASK_INDEX: 0,
    EMPTY_SECTION_INDEX: 12,
    TODAY_DATE: '0',
}))
jest.mock('../Header/OpenTasksDateHeader', () => 'OpenTasksDateHeader')
jest.mock('./TasksSections', () => 'TasksSections')
jest.mock('../TaskListSkeleton', () => 'TaskListSkeleton')
jest.mock('./TopShowMoreButton', () => 'TopShowMoreButton')
jest.mock('./MiddleShowMoreButton', () => 'MiddleShowMoreButton')
jest.mock('./SelectedProjectEmptyInbox', () => 'SelectedProjectEmptyInbox')
jest.mock('./AllProjectsShowMoreButtonContainer', () => 'AllProjectsShowMoreButtonContainer')
jest.mock('./OpenTaskViewForAssistants/AssistantScheduleTimeline', () => ({
    AssistantScheduleRows: 'AssistantScheduleRows',
}))
jest.mock('./OpenTaskViewForAssistants/WorkflowTaskCreator', () => 'WorkflowTaskCreator')
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: () => mockInSelectedProject,
}))

/**
 * AT-2492 — the gates that decide which surface may spend the once-per-day, per-project
 * celebration. They live here, in the section component, rather than in the block, because the block
 * is rendered once per empty DATE section and knows nothing about filters, boards or whose list it
 * is showing.
 *
 * Each case below is a way of celebrating something that did not happen. The one to keep in mind is
 * the filter case: `amountTasks` comes from the FILTERED store, so an active priority filter empties
 * the list on screen without the project being done at all.
 */

const PINNED_NOW = new Date('2026-09-02T10:00:00Z')
const todayKey = moment(PINNED_NOW).format('YYYY-MM-DD')
const USER = 'user-1'
const PROJECT = 'project-1'
const OTHER_DAY = '1'

const buildSection = (dateKey, amountTasks = 0) => {
    const section = []
    section[DATE_TASK_INDEX] = dateKey
    section[AMOUNT_TASKS_INDEX] = amountTasks
    section[EMPTY_SECTION_INDEX] = []
    return section
}

const renderSection = (dateIndex = 0) => {
    let tree
    act(() => {
        tree = renderer.create(
            <OpenTasksByDate projectId={PROJECT} projectIndex={0} dateIndex={dateIndex} instanceKey="instance" />
        )
    })
    return tree
}

const celebrationRunIdOf = tree =>
    tree.root.findAllByType('SelectedProjectEmptyInbox').map(node => node.props.celebrationRunId)

describe('OpenTasksByDate — who may celebrate a cleared project (AT-2492)', () => {
    beforeEach(() => {
        resetProjectEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
        jest.useFakeTimers()
        jest.setSystemTime(PINNED_NOW)
        mockInSelectedProject = true

        // The project WAS cleared today — every case below is about whether this surface is allowed
        // to say so, not about whether there is anything to say.
        markProjectEmptyInboxDayReached(USER, PROJECT, todayKey)

        mockState = {
            selectedProjectIndex: 0,
            activeDragTaskModeInDate: null,
            loggedUser: { projectIds: [PROJECT], uid: USER, isAnonymous: false },
            currentUser: { uid: USER },
            sidebarNumbers: { [PROJECT]: { [USER]: 0 } },
            taskPriorityFilters: [],
            taskVmStateFilters: [],
            filteredOpenTasksStore: { instance: [buildSection(TODAY_DATE), buildSection(OTHER_DAY)] },
            laterTasksExpanded: false,
            laterTasksExpandState: 0,
            somedayTasksExpanded: false,
            thereAreLaterOpenTasks: { [PROJECT]: false },
            thereAreLaterEmptyGoals: { [PROJECT]: false },
            thereAreSomedayOpenTasks: { [PROJECT]: false },
            thereAreSomedayEmptyGoals: { [PROJECT]: false },
            initialLoadingEndOpenTasks: { instance: true },
            initialLoadingEndObservedTasks: { instance: true },
            taskListSingleLoading: {},
            openTasksShowMoreData: {},
        }
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('celebrates on the selected project today section', () => {
        expect(celebrationRunIdOf(renderSection(0))).toEqual([1])
    })

    /**
     * With Later expanded, several date sections can be empty at once. Each renders the same block,
     * so without this gate one clearing would fire a burst per empty day.
     */
    it('stays quiet on a date section that is not today', () => {
        expect(celebrationRunIdOf(renderSection(1))).toEqual([0])
    })

    /**
     * All Projects hides an empty project's block entirely, but a project with visible OKRs still
     * renders it — and a board showing several cleared projects would celebrate all of them at once.
     */
    it('stays quiet on the All Projects board', () => {
        mockInSelectedProject = false

        expect(celebrationRunIdOf(renderSection(0))).toEqual([0])
    })

    it('stays quiet while a task priority filter is hiding the real tasks', () => {
        mockState.taskPriorityFilters = ['high']

        expect(celebrationRunIdOf(renderSection(0))).toEqual([0])
    })

    it('stays quiet while a VM state filter is hiding the real tasks', () => {
        mockState.taskVmStateFilters = ['running']

        expect(celebrationRunIdOf(renderSection(0))).toEqual([0])
    })

    /** An assistant's board is not your inbox. */
    it('stays quiet on an assistant board', () => {
        mockState.currentUser = { uid: 'assistant-1' }

        expect(celebrationRunIdOf(renderSection(0))).toEqual([0])
    })

    /**
     * The AT-2445 lesson, one level down: a marker spent by a frame nobody saw is a celebration that
     * silently never happens. The block is not on screen until the project's listeners have reported.
     */
    it('stays quiet — and spends nothing — while the task listeners are still loading', () => {
        mockState.initialLoadingEndOpenTasks = { instance: false }

        const loadingTree = renderSection(0)
        expect(loadingTree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(0)

        // ...and the day is still there to be spent once the block genuinely appears.
        act(() => loadingTree.unmount())
        mockState.initialLoadingEndOpenTasks = { instance: true }
        expect(celebrationRunIdOf(renderSection(0))).toEqual([1])
    })

    it('does not celebrate a section that still has tasks', () => {
        mockState.filteredOpenTasksStore = { instance: [buildSection(TODAY_DATE, 3), buildSection(OTHER_DAY)] }

        expect(renderSection(0).root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(0)
    })
})
