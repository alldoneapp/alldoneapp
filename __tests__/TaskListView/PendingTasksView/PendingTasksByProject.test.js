/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import PendingTasksByProject from '../../../components/TaskListView/PendingTasksView/PendingTasksByProject'
import { unwatchTasksInWorkflow, watchTasksInWorkflow } from '../../../utils/backends/workflowTasks'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../../components/TaskListView/Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('../../../components/TaskListView/PendingTasksView/PendingTasksByDate', () => 'PendingTasksByDate')
jest.mock('../../../components/MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('../../../components/HashtagFilters/FilterHelpers/FilterTasks', () => ({
    filterPendingTasks: jest.fn(tasksByDateAndStep => tasksByDateAndStep),
}))
jest.mock('../../../utils/backends/workflowTasks', () => ({
    watchTasksInWorkflow: jest.fn(),
    unwatchTasksInWorkflow: jest.fn(),
}))

const projectId = 'project-1'
const defaultProjectId = 'project-default'
const dispatch = jest.fn()

const project = { id: projectId, index: 0, name: 'My project', color: '#0055ff' }

const tasksByDateAndStep = [['20260716', { 'step-1': [{ id: 'task-1' }] }]]

const createState = ({
    isAnonymous = false,
    defaultAssistant = null,
    defaultProject = { id: defaultProjectId, index: 1 },
} = {}) => ({
    defaultAssistant,
    hashtagFilters: new Map(),
    loggedUser: { defaultProjectId, isAnonymous },
    loggedUserProjectsMap: defaultProject ? { [defaultProjectId]: defaultProject } : {},
})

// The pending sections arrive through the workflow watcher callback, so the
// render has to be flushed before the tree can be inspected.
const renderProject = (state, props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    let tree
    renderer.act(() => {
        tree = renderer.create(<PendingTasksByProject project={project} inSelectedProject={true} {...props} />)
    })
    return tree
}

const emitTasks = (tasks = tasksByDateAndStep, estimation = { 20260716: 45 }, amounts = { 20260716: 1 }) => {
    const [, updateTasks] = watchTasksInWorkflow.mock.calls[0]
    renderer.act(() => {
        updateTasks(tasks, estimation, amounts)
    })
}

describe('PendingTasksByProject component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
    })

    it('watches the workflow tasks of its project and stops on unmount', () => {
        const tree = renderProject(createState())

        expect(watchTasksInWorkflow).toHaveBeenCalledWith(projectId, expect.any(Function), expect.any(Function))

        renderer.act(() => {
            tree.unmount()
        })

        expect(unwatchTasksInWorkflow).toHaveBeenCalledWith(projectId)
    })

    it('renders the project header and a section per pending day', () => {
        const tree = renderProject(createState())
        emitTasks()

        expect(tree.root.findAllByType('ProjectHeader')).toHaveLength(1)

        const [section] = tree.root.findAllByType('PendingTasksByDate')
        expect(section.props.dateFormated).toBe('20260716')
        expect(section.props.estimation).toBe(45)
        expect(section.props.amountTasks).toBe(1)
    })

    it('renders nothing outside the selected project while there is no pending task', () => {
        const tree = renderProject(createState(), { inSelectedProject: false })

        expect(tree.toJSON()).toBeNull()
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
