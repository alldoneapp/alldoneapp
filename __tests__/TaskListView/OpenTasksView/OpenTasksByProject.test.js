/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import OpenTasksByProject from '../../../components/TaskListView/OpenTasksView/OpenTasksByProject'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('uuid/v4', () => jest.fn(() => 'watcher-key'))
jest.mock('../../../components/TaskListView/Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('../../../components/TaskListView/OpenTasksView/OpenTasksByDate', () => 'OpenTasksByDate')
jest.mock(
    '../../../components/TaskListView/OpenTasksView/NeedShowMoreOpenTasksButton',
    () => 'NeedShowMoreOpenTasksButton'
)
jest.mock(
    '../../../components/TaskListView/OpenTasksView/NeedShowMoreEmptyGoalsButton',
    () => 'NeedShowMoreEmptyGoalsButton'
)
jest.mock('../../../components/TaskListView/OpenTasksView/OpenTasksByProjectHandler', () => 'OpenTasksByProjectHandler')
jest.mock(
    '../../../components/TaskListView/OpenTasksView/BottomShowMoreButtonContainer',
    () => 'BottomShowMoreButtonContainer'
)
jest.mock('../../../components/MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('../../../components/TaskListView/OKRs/OKRSection', () => 'OKRSection')
jest.mock('../../../components/TaskListView/Header/UpcomingMilestoneRow', () => 'UpcomingMilestoneRow')
jest.mock('../../../components/TaskListView/PriorityFilters/TaskPriorityFiltersLine', () => 'TaskPriorityFiltersLine')
jest.mock('../../../components/TaskListView/PriorityFilters/TaskVmStateFiltersLine', () => 'TaskVmStateFiltersLine')
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: jest.fn(projectIndex => projectIndex > -1),
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    AMOUNT_TASKS_INDEX: 1,
    DATE_TASK_INDEX: 0,
    watchAllGoals: jest.fn(),
    watchAllMilestones: jest.fn(),
}))
jest.mock('../../../utils/backends/OKRs/okrsFirestore', () => ({
    watchProjectOKRs: jest.fn(),
}))
jest.mock('../../../utils/BackendBridge', () => ({
    unwatch: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({
    setDoneMilestonesInProjectInTasks: jest.fn(),
    setGoalsInProjectInTasks: jest.fn(),
    setOKRsInProjectInTasks: jest.fn(),
    setOpenMilestonesInProjectInTasks: jest.fn(),
    setTasksArrowButtonIsExpanded: jest.fn(),
}))
jest.mock('../../../components/TaskListView/OKRs/okrHelper', () => ({
    getOkrAllProjectsTodayKey: jest.fn(() => '2026-07-16'),
    getOkrUserTimezone: jest.fn(() => 'Europe/Berlin'),
}))

const projectId = 'project-1'
const userId = 'user-1'
const instanceKey = `${projectId}${userId}`
const dispatch = jest.fn()

const createState = ({
    selectedProjectIndex = -1,
    visibleTaskDate,
    filteredTaskAmount = visibleTaskDate ? 1 : 0,
    unfilteredHasTasks = !!visibleTaskDate,
    taskPriorityFilters = [],
    taskVmStateFilters = [],
    okrs = [],
    totalFollowed = 0,
    totalUnfollowed = 0,
} = {}) => ({
    currentUser: { uid: userId },
    defaultAssistant: null,
    filteredOpenTasksStore: visibleTaskDate ? { [instanceKey]: [[visibleTaskDate, filteredTaskAmount]] } : {},
    loggedUser: {
        defaultProjectId: projectId,
        isAnonymous: false,
        okrsHiddenInAllProjectsTodayByProjectAndOkr: {},
        uid: userId,
    },
    loggedUserProjectsMap: {
        [projectId]: { id: projectId, index: 0 },
    },
    okrsByProjectInTasks: { [projectId]: okrs },
    projectChatNotifications: {
        [projectId]: { totalFollowed, totalUnfollowed },
    },
    selectedProjectIndex,
    taskPriorityFilters,
    tasksArrowButtonIsExpanded: false,
    taskVmStateFilters,
    thereAreNotTasksInFirstDay: { [instanceKey]: !unfilteredHasTasks },
})

const renderProject = state => {
    useSelector.mockImplementation(selector => selector(state))
    return renderer.create(
        <OpenTasksByProject
            projectId={projectId}
            sortedLoggedUserProjectIds={[projectId]}
            setProjectsHaveTasksInFirstDay={jest.fn()}
        />
    )
}

describe('OpenTasksByProject visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
    })

    it.each([
        ['red', { totalFollowed: 1 }],
        ['grey', { totalUnfollowed: 1 }],
    ])('does not render an empty All Projects line solely for a %s new-comment badge', (badge, notification) => {
        const tree = renderProject(createState(notification))

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(0)
    })

    it.each([
        ['red', { totalFollowed: 1 }],
        ['grey', { totalUnfollowed: 1 }],
    ])('keeps an All Projects line with visible tasks when it also has a %s badge', (badge, notification) => {
        const tree = renderProject(createState({ ...notification, visibleTaskDate: '20260716' }))

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)
        expect(tree.root.findAllByType('OpenTasksByDate')).toHaveLength(1)
    })

    it('keeps the empty project line in an individual project view', () => {
        const tree = renderProject(createState({ selectedProjectIndex: 0, totalFollowed: 1, totalUnfollowed: 1 }))

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)
        expect(tree.root.findAllByType('TaskPriorityFiltersLine')).toHaveLength(1)
        expect(tree.root.findAllByType('TaskVmStateFiltersLine')).toHaveLength(1)
    })

    it.each([
        ['priority', { taskPriorityFilters: ['must_do'] }],
        ['VM state', { taskVmStateFilters: ['paused'] }],
        ['combined priority and VM state', { taskPriorityFilters: ['must_do'], taskVmStateFilters: ['paused'] }],
    ])('hides an All Projects section with zero %s filter matches', (filterName, filters) => {
        const tree = renderProject(
            createState({
                ...filters,
                visibleTaskDate: '20260716',
                filteredTaskAmount: 0,
                unfilteredHasTasks: true,
                okrs: [{ id: 'okr-1' }],
            })
        )

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(0)
        expect(tree.root.findAllByType('OKRSection')).toHaveLength(0)
    })

    it('keeps an All Projects section with at least one combined-filter match', () => {
        const tree = renderProject(
            createState({
                taskPriorityFilters: ['must_do'],
                taskVmStateFilters: ['paused'],
                visibleTaskDate: '20260716',
                filteredTaskAmount: 1,
            })
        )

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)
        expect(tree.root.findAllByType('OpenTasksByDate')).toHaveLength(1)
    })

    it('never hides the selected project when active filters have no matches', () => {
        const tree = renderProject(
            createState({
                selectedProjectIndex: 0,
                taskPriorityFilters: ['must_do'],
                taskVmStateFilters: ['paused'],
                visibleTaskDate: '20260716',
                filteredTaskAmount: 0,
            })
        )

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)
    })

    it('preserves normal unfiltered visibility for a project with non-task content', () => {
        const tree = renderProject(
            createState({
                visibleTaskDate: '20260716',
                filteredTaskAmount: 0,
                unfilteredHasTasks: true,
                okrs: [{ id: 'okr-1' }],
            })
        )

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)
        expect(tree.root.findAllByType('OKRSection')).toHaveLength(1)
    })
})
