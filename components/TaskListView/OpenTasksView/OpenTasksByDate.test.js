import React from 'react'
import { View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import OpenTasksByDate from './OpenTasksByDate'
import { AMOUNT_TASKS_INDEX, DATE_TASK_INDEX, EMPTY_SECTION_INDEX, TODAY_DATE } from '../../../utils/backends/openTasks'

let mockState

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
    checkIfSelectedProject: () => true,
}))

describe('OpenTasksByDate assistant task creation layout', () => {
    beforeEach(() => {
        const today = []
        today[DATE_TASK_INDEX] = TODAY_DATE
        today[AMOUNT_TASKS_INDEX] = 0
        today[EMPTY_SECTION_INDEX] = []

        mockState = {
            selectedProjectIndex: 0,
            activeDragTaskModeInDate: null,
            loggedUser: { projectIds: ['project-1'] },
            filteredOpenTasksStore: { instance: [today] },
            laterTasksExpanded: false,
            laterTasksExpandState: 0,
            somedayTasksExpanded: false,
            thereAreLaterOpenTasks: { 'project-1': false },
            thereAreLaterEmptyGoals: { 'project-1': false },
            thereAreSomedayOpenTasks: { 'project-1': false },
            thereAreSomedayEmptyGoals: { 'project-1': false },
            initialLoadingEndOpenTasks: { instance: true },
            initialLoadingEndObservedTasks: { instance: true },
            taskListSingleLoading: {},
            openTasksShowMoreData: {},
        }
    })

    it('renders Today before the assistant add-task row', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksByDate
                    projectId="project-1"
                    projectIndex={0}
                    dateIndex={0}
                    instanceKey="instance"
                    assistantProfileMode
                    assistantTaskCreatorContext={{
                        projectId: 'project-1',
                        assistant: { uid: 'assistant-1' },
                        disabled: false,
                        showConfigurationLink: false,
                    }}
                />
            )
        })

        const children = tree.root.findAllByType(View)[0].props.children.filter(Boolean)

        expect(children[0].type).toBe('OpenTasksDateHeader')
        expect(children[1].type).toBe('WorkflowTaskCreator')
        expect(children[1].props.showConfigurationLink).toBe(false)
        expect(children[2].type).toBe('TasksSections')
    })

    it('does not show the empty-inbox illustration on an assistant timeline', () => {
        mockState.initialLoadingEndOpenTasks.instance = true
        mockState.initialLoadingEndObservedTasks.instance = true

        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksByDate
                    projectId="project-1"
                    projectIndex={0}
                    dateIndex={0}
                    instanceKey="instance"
                    assistantProfileMode
                />
            )
        })

        expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(0)
    })

    it('keeps the empty-inbox illustration for a normal user task list', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksByDate projectId="project-1" projectIndex={0} dateIndex={0} instanceKey="instance" />
            )
        })

        expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(1)
    })

    it('shows ghost tasks until both initial task streams have loaded', () => {
        mockState.initialLoadingEndObservedTasks.instance = false

        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksByDate projectId="project-1" projectIndex={0} dateIndex={0} instanceKey="instance" />
            )
        })

        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(1)
        expect(tree.root.findAllByType('TasksSections')).toHaveLength(0)
        expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(0)
    })

    it('replaces the fallback ghosts with the real empty state only after loading', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksByDate projectId="project-1" projectIndex={0} dateIndex={0} instanceKey="instance" />
            )
        })

        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(0)
        expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
        expect(tree.root.findAllByType('SelectedProjectEmptyInbox')).toHaveLength(1)
    })

    it('adds one ghost row while a later task is resolving', () => {
        mockState.taskListSingleLoading.instance = true

        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksByDate projectId="project-1" projectIndex={0} dateIndex={0} instanceKey="instance" />
            )
        })

        expect(tree.root.findByType('TaskListSkeleton').props.rowCount).toBe(1)
        expect(tree.root.findAllByType('TasksSections')).toHaveLength(1)
    })
})
