/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import SendToSection from '../../../components/TaskListView/PendingTasksView/SentToSection'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../../components/TaskListView/Header/WorkflowHeader', () => 'WorkflowHeader')
jest.mock('../../../components/TaskListView/ParentTaskContainer', () => 'ParentTaskContainer')
jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(key => key),
}))

const projectId = 'project-1'
const assignee = { uid: 'user-1', displayName: 'Assignee' }
const reviewer = { uid: 'user-2', displayName: 'Reviewer' }
const currentStep = { reviewerUid: reviewer.uid }

const taskList = [
    { id: 'task-1', userId: assignee.uid },
    { id: 'task-2', userId: assignee.uid },
]

const state = { projectUsers: { [projectId]: [assignee, reviewer] } }

const renderSection = (props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    return renderer.create(
        <SendToSection
            taskList={taskList}
            subtaskByTask={{}}
            projectId={projectId}
            currentStepId="step-1"
            currentStep={currentStep}
            assignee={assignee}
            {...props}
        />
    )
}

describe('SentToSection component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('renders one task container per pending task', () => {
        const tree = renderSection()

        const containers = tree.root.findAllByType('ParentTaskContainer')
        expect(containers).toHaveLength(2)
        expect(containers[0].props.task).toBe(taskList[0])
        expect(containers[0].props.isPending).toBe(true)
    })

    it('resolves the reviewer of the current step from the project users', () => {
        const tree = renderSection()

        const [header] = tree.root.findAllByType('WorkflowHeader')
        expect(header.props.reviewer).toBe(reviewer)
        expect(header.props.assignee).toBe(assignee)
        expect(header.props.currentStepId).toBe('step-1')
        expect(header.props.workflowDirectionText).toBe('sent to')
    })

    it('leaves the reviewer empty when the step points at somebody outside the project', () => {
        const tree = renderSection({ currentStep: { reviewerUid: 'nobody' } })

        expect(tree.root.findAllByType('WorkflowHeader')[0].props.reviewer).toBeUndefined()
    })

    it('hands each task its own subtasks', () => {
        const subtasks = [{ id: 'subtask-1' }]
        const tree = renderSection({ subtaskByTask: { 'task-1': subtasks } })

        const containers = tree.root.findAllByType('ParentTaskContainer')
        expect(containers[0].props.subtaskList).toBe(subtasks)
        expect(containers[1].props.subtaskList).toEqual([])
    })
})
