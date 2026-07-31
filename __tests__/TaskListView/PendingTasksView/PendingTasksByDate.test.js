/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import moment from 'moment'
import { useSelector } from 'react-redux'

import PendingTasksByDate from '../../../components/TaskListView/PendingTasksView/PendingTasksByDate'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import { taskMatchHashtagFilters } from '../../../components/HashtagFilters/FilterHelpers/FilterTasks'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../../components/TaskListView/Header/DateHeader', () => 'DateHeader')
jest.mock('../../../components/TaskListView/PendingTasksView/SentToSection', () => 'SendToSection')
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getTaskOwner: jest.fn() },
}))
jest.mock('../../../components/HashtagFilters/FilterHelpers/FilterTasks', () => ({
    taskMatchHashtagFilters: jest.fn(() => true),
}))

const projectId = 'project-1'
const project = { id: projectId, index: 0 }
const assigneeId = 'user-1'
const today = moment().format('YYYYMMDD')

const assignee = {
    uid: assigneeId,
    workflow: { [projectId]: { 'step-1': { reviewerUid: 'user-2' }, 'step-2': null } },
}

const tasksByStep = [
    ['step-1', [{ id: 'task-1', userId: assigneeId }]],
    ['step-2', [{ id: 'task-2', userId: assigneeId }]],
]

const createState = ({ route = 'TasksView' } = {}) => ({
    hashtagFilters: new Map(),
    route,
})

const renderByDate = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    return renderer.create(
        <PendingTasksByDate
            project={project}
            tasksByStep={tasksByStep}
            subtaskByTask={{}}
            dateFormated={today}
            estimation={45}
            amountTasks={2}
            {...props}
        />
    )
}

describe('PendingTasksByDate component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        TasksHelper.getTaskOwner.mockReturnValue(assignee)
        taskMatchHashtagFilters.mockReturnValue(true)
    })

    it('renders a section only for the steps that still exist in the workflow', () => {
        const tree = renderByDate()

        const sections = tree.root.findAllByType('SendToSection')
        expect(sections).toHaveLength(1)
        expect(sections[0].props.currentStepId).toBe('step-1')
        expect(sections[0].props.currentStep).toBe(assignee.workflow[projectId]['step-1'])
        expect(sections[0].props.assignee).toBe(assignee)
        expect(sections[0].props.projectId).toBe(projectId)
    })

    it('passes the header the date totals of the section', () => {
        const tree = renderByDate(createState(), { firstDateSection: true })

        const [header] = tree.root.findAllByType('DateHeader')
        expect(header.props.isToday).toBe(true)
        expect(header.props.dateText).toBe('TODAY')
        expect(header.props.amountTasks).toBe(2)
        expect(header.props.estimation).toBe(45)
        expect(header.props.firstDateSection).toBe(true)
    })

    it('formats an earlier day as a plain date', () => {
        const tree = renderByDate(createState(), { dateFormated: '20190802' })

        const [header] = tree.root.findAllByType('DateHeader')
        expect(header.props.isToday).toBe(false)
        expect(header.props.dateText).toBe('2019/08/02')
    })

    it('keeps every task outside the goal detailed view', () => {
        const tree = renderByDate()

        expect(tree.root.findAllByType('SendToSection')[0].props.taskList).toBe(tasksByStep[0][1])
        expect(taskMatchHashtagFilters).not.toHaveBeenCalled()
    })

    it('applies the hashtag filters inside the goal detailed view', () => {
        taskMatchHashtagFilters.mockReturnValue(false)

        const tree = renderByDate(createState({ route: 'GoalDetailedView' }))

        expect(tree.root.findAllByType('SendToSection')[0].props.taskList).toEqual([])
        expect(taskMatchHashtagFilters).toHaveBeenCalledWith(tasksByStep[0][1][0])
    })
})
