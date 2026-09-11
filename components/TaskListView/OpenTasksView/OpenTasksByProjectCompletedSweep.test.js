import React from 'react'
import renderer, { act } from 'react-test-renderer'

import OpenTasksByProject from './OpenTasksByProject'
import ProjectSection from '../ProjectSection'

let mockState
let mockInSelectedProject

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
    shallowEqual: jest.fn(),
}))
jest.mock('uuid/v4', () => () => 'watcher-key')
jest.mock('../Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('./OpenTasksByDate', () => {
    const React = require('react')
    const { useTaskHierarchy } = require('../TaskHierarchy')
    return props => React.createElement('OpenTasksByDate', { ...props, taskHierarchy: useTaskHierarchy() })
})
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
jest.mock('../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => false,
}))

const USER = 'user-1'
const PROJECT = 'project-a'

const countOf = (tree, type) => tree.root.findAllByType(type).length

const buildState = ({ todayIsEmpty = false, todayCount = 1, loading = false } = {}) => ({
    loggedUserProjectsMap: { [PROJECT]: { index: 0, id: PROJECT, color: '#2F80ED' } },
    loggedUserProjects: [{ id: PROJECT }],
    selectedProjectIndex: 0,
    currentUser: { uid: USER },
    loggedUser: { uid: USER, isAnonymous: false, okrsHiddenInAllProjectsTodayByProjectAndOkr: {} },
    tasksArrowButtonIsExpanded: false,
    okrsByProjectInTasks: {},
    filteredOpenTasksStore: { [PROJECT + USER]: loading ? [] : [['0', todayIsEmpty ? 0 : 3, []]] },
    taskPriorityFilters: [],
    taskVmStateFilters: [],
    initialLoadingEndOpenTasks: { [PROJECT + USER]: !loading },
    initialLoadingEndObservedTasks: { [PROJECT + USER]: !loading },
    taskListSingleLoading: {},
    thereAreNotTasksInFirstDay: { [PROJECT + USER]: todayIsEmpty },
    sidebarNumbers: { [PROJECT]: { [USER]: todayCount } },
})

describe('open-tasks project rendering (AT-2551)', () => {
    beforeEach(() => {
        mockInSelectedProject = false
    })

    const render = state => {
        mockState = state
        let tree
        act(() => {
            tree = renderer.create(<OpenTasksByProject projectId={PROJECT} sortedLoggedUserProjectIds={[PROJECT]} />)
        })
        return tree
    }

    const update = (tree, state) => {
        mockState = state
        act(() => {
            tree.update(<OpenTasksByProject projectId={PROJECT} sortedLoggedUserProjectIds={[PROJECT]} />)
        })
    }

    it.each([
        [false, false, true],
        [true, false, true],
        [false, true, true],
    ])(
        'shares hierarchy across project and assistant boards (selected=%s, assistant=%s)',
        (selected, assistant, expected) => {
            mockInSelectedProject = selected
            mockState = buildState()
            let tree
            act(() => {
                tree = renderer.create(
                    <OpenTasksByProject
                        projectId={PROJECT}
                        sortedLoggedUserProjectIds={[PROJECT]}
                        assistantProfileMode={assistant}
                    />
                )
            })
            expect(tree.root.findByType('OpenTasksByDate').props.taskHierarchy).toBe(expected)
            expect(countOf(tree, 'OKRSection')).toBe(assistant ? 0 : 1)
            expect(countOf(tree, 'UpcomingMilestoneRow')).toBe(assistant ? 0 : 1)
            act(() => tree.unmount())
        }
    )

    it('removes a cleared project immediately instead of holding it for a page-wide sweep', () => {
        const tree = render(buildState())
        expect(countOf(tree, 'ProjectHeader')).toBe(1)

        update(tree, buildState({ todayIsEmpty: true, todayCount: 0 }))

        expect(countOf(tree, 'ProjectHeader')).toBe(0)
        expect(countOf(tree, ProjectSection)).toBe(0)
    })

    it('does not arm completion motion for a project that stays on the board', () => {
        const tree = render(buildState())
        const section = tree.root.findByType(ProjectSection)

        expect(section.props.completedSweepRunId).toBeUndefined()
        expect(section.props.completedSweepLineWillLeave).toBeUndefined()
    })

    it('keeps the selected-project empty state static and visible', () => {
        mockInSelectedProject = true
        const tree = render(buildState({ todayIsEmpty: true, todayCount: 0 }))

        expect(countOf(tree, 'ProjectHeader')).toBe(1)
        expect(tree.root.findByType(ProjectSection).props.completedSweepRunId).toBeUndefined()
        expect(tree.root.findByType('OpenTasksByDate').props.projectCelebrationRunId).toBeUndefined()
    })

    it('still shows the loading skeleton while selected-project task data is pending', () => {
        mockInSelectedProject = true
        const tree = render(buildState({ loading: true }))

        expect(countOf(tree, 'ProjectHeader')).toBe(1)
        expect(countOf(tree, 'TaskListSkeleton')).toBe(1)
    })
})
