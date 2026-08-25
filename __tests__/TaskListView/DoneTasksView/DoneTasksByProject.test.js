/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import DoneTasksByProject from '../../../components/TaskListView/DoneTasksView/DoneTasksByProject'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../../components/TaskListView/Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('../../../components/TaskListView/DoneTasksView/DoneTasksByDate', () => 'DoneTasksByDate')
jest.mock('../../../components/TaskListView/DoneTasksView/ShowMoreButtonsArea', () => 'ShowMoreButtonsArea')
jest.mock('../../../components/MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('../../../hooks/useProjectData', () => ({
    __esModule: true,
    default: () => {},
    useProjectsData: () => {},
}))
jest.mock('../../../utils/InitialLoad/projectDataLoader', () => ({ PROJECT_DATA_ASSISTANTS: 'assistants' }))
jest.mock('../../../components/HashtagFilters/FilterHelpers/FilterTasks', () => ({
    filterDoneTasks: jest.fn(tasksByDate => tasksByDate),
}))
jest.mock('../../../utils/backends/doneTasks', () => ({
    AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON: 10,
}))
jest.mock('../../../redux/actions', () => ({
    setAmountTasksExpanded: jest.fn(amount => ({ type: 'Set amount tasks expanded', amount })),
}))

const mockTodayTasks = jest.fn()
const mockEarlierTasks = jest.fn()
const mockEarlierSubtasks = jest.fn()

jest.mock('../../../components/TaskListView/DoneTasksView/useTodayTasks', () => ({
    __esModule: true,
    default: (...args) => mockTodayTasks(...args),
}))
jest.mock('../../../components/TaskListView/DoneTasksView/useEarlierTasks', () => ({
    __esModule: true,
    default: (...args) => mockEarlierTasks(...args),
}))
jest.mock('../../../components/TaskListView/DoneTasksView/useEarlierSubtasks', () => ({
    __esModule: true,
    default: (...args) => mockEarlierSubtasks(...args),
}))

const projectId = 'project-1'
const defaultProjectId = 'project-default'
const dispatch = jest.fn()

const project = { id: projectId, index: 0, name: 'My project', color: '#0055ff' }

const createState = ({
    doneTasksAmount = 1,
    amountDoneTasksExpanded = 0,
    isAnonymous = false,
    defaultAssistant = null,
    defaultProject = { id: defaultProjectId, index: 1 },
} = {}) => ({
    amountDoneTasksExpanded,
    defaultAssistant,
    doneTasksAmount,
    hashtagFilters: new Map(),
    loggedUser: { defaultProjectId, isAnonymous },
    loggedUserProjectsMap: defaultProject ? { [defaultProjectId]: defaultProject } : {},
})

// The visible sections are computed in an effect, so the render has to be
// flushed before the tree can be inspected.
const renderProject = (state, props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    let tree
    renderer.act(() => {
        tree = renderer.create(<DoneTasksByProject project={project} inSelectedProject={true} {...props} />)
    })
    return tree
}

describe('DoneTasksByProject component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        mockTodayTasks.mockReturnValue({
            todayTasksByDate: [['20260716', [{ id: 'task-1' }]]],
            todaySubtasksByTask: {},
            todayEstimationByDate: { 20260716: 30 },
        })
        mockEarlierTasks.mockReturnValue({
            earlierTasksByDate: [['20260701', [{ id: 'task-0' }]]],
            earlierEstimationByDate: { 20260701: 15 },
            earlierCompletedDateToCheck: 1751328000000,
        })
        mockEarlierSubtasks.mockReturnValue({})
    })

    it('renders the project header and a section per completed day', () => {
        const tree = renderProject(createState())

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)
        expect(tree.root.findAllByType('DoneTasksByDate')).toHaveLength(1)
        expect(tree.root.findAllByType('ShowMoreButtonsArea')).toHaveLength(1)
    })

    it('renders nothing outside the selected project when no task matches', () => {
        mockTodayTasks.mockReturnValue({
            todayTasksByDate: [],
            todaySubtasksByTask: {},
            todayEstimationByDate: {},
        })

        const tree = renderProject(createState(), { inSelectedProject: false })

        expect(tree.toJSON()).toBeNull()
    })

    it('switches to the earlier tasks once the section is expanded', () => {
        const tree = renderProject(createState({ amountDoneTasksExpanded: 10 }))

        const [section] = tree.root.findAllByType('DoneTasksByDate')
        expect(section.props.dateFormated).toBe('20260701')
        expect(section.props.estimation).toBe(15)
    })

    it('auto-expands earlier tasks in the selected project when today is empty', () => {
        renderProject(createState({ doneTasksAmount: 0 }))

        expect(dispatch).toHaveBeenCalledWith({ type: 'Set amount tasks expanded', amount: 10 })
    })

    it('does not render the assistant line for an anonymous user', () => {
        const tree = renderProject(createState({ isAnonymous: true }))

        expect(tree.root.findAllByType('AssistantLine')).toHaveLength(0)
    })

    it('renders the assistant line inherited from the default project', () => {
        const tree = renderProject(
            createState({ defaultProject: { id: defaultProjectId, index: 1, assistantId: 'assistant-1' } })
        )

        const [assistantLine] = tree.root.findAllByType('AssistantLine')
        expect(assistantLine.props.assistantIdOverride).toBe('assistant-1')
        expect(assistantLine.props.projectOverride).toBe(project)
    })
})
