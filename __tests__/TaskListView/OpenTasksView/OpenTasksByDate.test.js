/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import OpenTasksByDate from '../../../components/TaskListView/OpenTasksView/OpenTasksByDate'
import { removeActiveDragTaskModeInDate, setSelectedTasks } from '../../../redux/actions'
import { checkIfSelectedProject } from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../../components/TaskListView/Header/OpenTasksDateHeader', () => 'OpenTasksDateHeader')
jest.mock('../../../components/TaskListView/OpenTasksView/TasksSections', () => 'TasksSections')
jest.mock('../../../components/TaskListView/OpenTasksView/TopShowMoreButton', () => 'TopShowMoreButton')
jest.mock('../../../components/TaskListView/OpenTasksView/MiddleShowMoreButton', () => 'MiddleShowMoreButton')
jest.mock('../../../components/TaskListView/OpenTasksView/SelectedProjectEmptyInbox', () => 'SelectedProjectEmptyInbox')
jest.mock(
    '../../../components/TaskListView/OpenTasksView/AllProjectsShowMoreButtonContainer',
    () => 'AllProjectsShowMoreButtonContainer'
)
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: jest.fn(projectIndex => projectIndex > -1),
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    AMOUNT_TASKS_INDEX: 1,
    DATE_TASK_INDEX: 0,
    EMPTY_SECTION_INDEX: 2,
    TODAY_DATE: '20260716',
}))
jest.mock('../../../redux/actions', () => ({
    removeActiveDragTaskModeInDate: jest.fn(() => ({ type: 'Remove active drag task mode in date' })),
    setSelectedTasks: jest.fn((tasks, clear) => ({ type: 'Set selected tasks', tasks, clear })),
}))

const projectId = 'project-1'
const instanceKey = 'project-1user-1'
const dispatch = jest.fn()

const TODAY = '20260716'
const LATER = '20260720'

const createState = ({
    selectedProjectIndex = -1,
    dates = [[TODAY, 2]],
    amountTasks,
    emptyGoals = [],
    laterTasksExpanded = false,
    laterTasksExpandState = 0,
    somedayTasksExpanded = false,
    thereAreLaterOpenTasks = false,
    thereAreSomedayOpenTasks = false,
    initialLoadingEnd = true,
    activeDragTaskModeInDate = null,
    isAnonymous = false,
} = {}) => {
    const store = dates.map(([date, amount, empty]) => [
        date,
        amountTasks === undefined ? amount : amountTasks,
        empty || emptyGoals,
    ])

    return {
        activeDragTaskModeInDate,
        filteredOpenTasksStore: { [instanceKey]: store },
        initialLoadingEndObservedTasks: { [instanceKey]: initialLoadingEnd },
        initialLoadingEndOpenTasks: { [instanceKey]: initialLoadingEnd },
        laterTasksExpandState,
        laterTasksExpanded,
        loggedUser: { isAnonymous, projectIds: [projectId] },
        openTasksShowMoreData: { [projectId]: { hasFutureTasks: false } },
        selectedProjectIndex,
        somedayTasksExpanded,
        thereAreLaterEmptyGoals: { [projectId]: false },
        thereAreLaterOpenTasks: { [projectId]: thereAreLaterOpenTasks },
        thereAreSomedayEmptyGoals: { [projectId]: false },
        thereAreSomedayOpenTasks: { [projectId]: thereAreSomedayOpenTasks },
    }
}

const renderByDate = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    let tree
    renderer.act(() => {
        tree = renderer.create(
            <OpenTasksByDate
                projectId={projectId}
                dateIndex={0}
                projectIndex={0}
                instanceKey={instanceKey}
                setProjectsHaveTasksInFirstDay={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

describe('OpenTasksByDate component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        checkIfSelectedProject.mockImplementation(projectIndex => projectIndex > -1)
    })

    describe('rendering', () => {
        it('renders the date header and its task sections', () => {
            const tree = renderByDate()

            const [header] = tree.root.findAllByType('OpenTasksDateHeader')
            expect(header.props.projectId).toBe(projectId)
            expect(header.props.instanceKey).toBe(instanceKey)
            expect(header.props.accessGranted).toBe(true)
            expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
        })

        it('denies access to an anonymous user', () => {
            const tree = renderByDate(createState({ isAnonymous: true }))

            expect(tree.root.findAllByType('OpenTasksDateHeader')[0].props.accessGranted).toBe(false)
        })

        it('shows the empty inbox once both initial loads have finished', () => {
            const tree = renderByDate(createState({ amountTasks: 0 }))

            expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(1)
        })

        it('holds the empty inbox back while the tasks are still loading', () => {
            const tree = renderByDate(createState({ amountTasks: 0, initialLoadingEnd: false }))

            expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(0)
        })

        it('keeps the empty inbox away while a goal without tasks is listed', () => {
            const tree = renderByDate(createState({ amountTasks: 0, emptyGoals: [{ id: 'goal-1' }] }))

            expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(0)
        })
    })

    describe('the show more buttons', () => {
        it('offers to show more when the project has later tasks', () => {
            const tree = renderByDate(createState({ selectedProjectIndex: 0, thereAreLaterOpenTasks: true }))

            expect(tree.root.findAllByType('TopShowMoreButton')).toHaveLength(1)
        })

        it('stays away when there is nothing more to show', () => {
            const tree = renderByDate(createState({ selectedProjectIndex: 0 }))

            expect(tree.root.findAllByType('TopShowMoreButton')).toHaveLength(0)
        })

        it('only offers the button on the last visible date of the All Projects list', () => {
            const state = createState({
                dates: [
                    [TODAY, 2],
                    [LATER, 1],
                ],
                thereAreLaterOpenTasks: true,
            })

            expect(
                renderByDate(state, { sortedLoggedUserProjectIds: [projectId] }).root.findAllByType('TopShowMoreButton')
            ).toHaveLength(1)

            expect(
                renderByDate(
                    { ...state, laterTasksExpandState: 1 },
                    { sortedLoggedUserProjectIds: [projectId] }
                ).root.findAllByType('TopShowMoreButton')
            ).toHaveLength(0)
        })

        it('offers to contract the expanded list inside a selected project', () => {
            const tree = renderByDate(createState({ selectedProjectIndex: 0, laterTasksExpanded: true }))

            const buttons = tree.root.findAllByType('MiddleShowMoreButton')
            expect(buttons).toHaveLength(1)
            expect(buttons[0].props.expanded).toBe(true)
        })

        it('offers to expand further once someday tasks exist', () => {
            const tree = renderByDate(
                createState({ selectedProjectIndex: 0, laterTasksExpanded: true, thereAreSomedayOpenTasks: true })
            )

            const expandStates = tree.root.findAllByType('MiddleShowMoreButton').map(button => button.props.expanded)
            expect(expandStates).toEqual([false, true])
        })

        it('keeps the middle buttons out of the All Projects list', () => {
            const tree = renderByDate(createState({ laterTasksExpanded: true }))

            expect(tree.root.findAllByType('MiddleShowMoreButton')).toHaveLength(0)
        })
    })

    describe('organize mode', () => {
        it('activates only for its own project and date', () => {
            const tree = renderByDate(createState({ activeDragTaskModeInDate: { projectId, dateIndex: 0 } }))

            expect(tree.root.findAllByType('TasksSections')[0].props.isActiveOrganizeMode).toBe(true)
        })

        it('stays inactive for another date', () => {
            const tree = renderByDate(createState({ activeDragTaskModeInDate: { projectId, dateIndex: 1 } }))

            expect(tree.root.findAllByType('TasksSections')[0].props.isActiveOrganizeMode).toBe(false)
        })

        it('clears the drag state on unmount', () => {
            const tree = renderByDate()

            renderer.act(() => {
                tree.unmount()
            })

            expect(dispatch).toHaveBeenCalledWith(removeActiveDragTaskModeInDate())
            expect(dispatch).toHaveBeenCalledWith(setSelectedTasks(null, true))
        })
    })
})
