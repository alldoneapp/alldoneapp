/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import ParentTaskContainer from '../../components/TaskListView/ParentTaskContainer'
import store from '../../redux/store'
import { setFocusedTaskItem, unsetUploadedNewSubtask } from '../../redux/actions'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../../components/Guides/guidesHelper'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../components/TaskListView/Utils/TasksHelper'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
const mockOpenModal = jest.fn()

// Stand in for the real TaskItem, which is what fills the dismissible ref the
// container reaches through when a task gets focused.
jest.mock('../../components/TaskListView/TaskItem', () => {
    const mockReact = require('react')
    return props => {
        if (props.dismissibleRef && !props.dismissibleRef.current) {
            props.dismissibleRef.current = { openModal: mockOpenModal }
        }
        return mockReact.createElement('TaskItem', props)
    }
})
jest.mock('../../components/TaskListView/TaskIndicator', () => 'TaskIndicator')
jest.mock('../../components/TaskListView/Subtask/SubTasksView', () => 'SubTasksView')
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))
jest.mock('../../redux/actions', () => ({
    setFocusedTaskItem: jest.fn((id, isObserved) => ({ type: 'Set focused task item', id, isObserved })),
    unsetUploadedNewSubtask: jest.fn(() => ({ type: 'Unset uploaded new subtask' })),
}))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false) },
}))
jest.mock('../../components/Guides/guidesHelper', () => ({
    objectIsLockedForUser: jest.fn(() => false),
}))
jest.mock('../../components/TaskListView/Utils/TasksHelper', () => ({
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))

const projectId = '-LcRVRo6mhbC0oXCcZ2F'
const userId = 'UUKU61Jc7ET8zE5ncN8F61HE19y1'
const task = {
    id: '-LyzhG-xGsc74qaNARtB',
    done: false,
    name: 'Hallo ',
    userId,
    userIds: [userId],
    hasStar: false,
    created: 1579410000000,
    creatorId: userId,
    dueDate: 1579410000000,
    completed: null,
    isPrivate: true,
    parentId: null,
    recurrence: { type: 'never' },
    subtaskIds: [],
}

const subtaskList = [{ id: 'subtask-1' }, { id: 'subtask-2' }]
const dispatch = jest.fn()

const createState = ({ isFocusedTaskItem = false, isMiddleScreen = false, draggingParentTaskId = '' } = {}) => ({
    draggingParentTaskId,
    focusedTaskItem: { id: isFocusedTaskItem ? task.id : '' },
    isMiddleScreen,
    loggedUser: { uid: userId },
})

const createStoreState = ({ activeEditMode = false, uploadedNewSubtask = false } = {}) => ({
    activeEditMode,
    loggedUser: { unlockedKeysByGuides: {} },
    uploadedNewSubtask,
})

// The container writes aria attributes on its host View through a ref, which
// the test renderer only provides via createNodeMock.
const renderContainer = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))

    let tree
    renderer.act(() => {
        tree = renderer.create(
            <ParentTaskContainer projectId={projectId} task={task} subtaskList={subtaskList} {...props} />,
            { createNodeMock: () => ({ setNativeProps: jest.fn() }) }
        )
    })
    return tree
}

describe('ParentTaskContainer component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        store.getState.mockReturnValue(createStoreState())
        objectIsLockedForUser.mockReturnValue(false)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
    })

    describe('rendering', () => {
        it('renders the task item with its subtasks', () => {
            const tree = renderContainer()

            const [taskItem] = tree.root.findAllByType('TaskItem')
            expect(taskItem.props.task).toBe(task)
            expect(taskItem.props.projectId).toBe(projectId)
            expect(taskItem.props.subtaskList).toBe(subtaskList)
        })

        it('renders the subtask indicator when the task has subtasks', () => {
            const tree = renderContainer()

            expect(tree.root.findAllByType('TaskIndicator')).toHaveLength(1)
        })

        it('hides the subtask indicator on a middle screen', () => {
            const tree = renderContainer(createState({ isMiddleScreen: true }))

            expect(tree.root.findAllByType('TaskIndicator')).toHaveLength(0)
        })

        it('hides the subtask indicator for a task assigned to an assistant', () => {
            const tree = renderContainer(createState(), {
                task: { ...task, assigneeType: TASK_ASSIGNEE_ASSISTANT_TYPE },
            })

            expect(tree.root.findAllByType('TaskIndicator')).toHaveLength(0)
        })

        it('keeps the subtask list collapsed until it is toggled', () => {
            const tree = renderContainer()

            expect(tree.root.findAllByType('SubTasksView')).toHaveLength(0)
        })
    })

    describe('toggleSubTaskList', () => {
        it('expands and collapses the subtask list', () => {
            const expandOrContractSubtasks = jest.fn()
            const tree = renderContainer(createState(), { expandOrContractSubtasks })

            const [taskItem] = tree.root.findAllByType('TaskItem')
            renderer.act(() => {
                taskItem.props.toggleSubTaskList()
            })

            expect(expandOrContractSubtasks).toHaveBeenCalledWith(task.id, true)
            expect(tree.root.findAllByType('SubTasksView')).toHaveLength(1)

            renderer.act(() => {
                tree.root.findAllByType('TaskItem')[0].props.toggleSubTaskList()
            })

            expect(expandOrContractSubtasks).toHaveBeenLastCalledWith(task.id, false)
            expect(tree.root.findAllByType('SubTasksView')).toHaveLength(0)
        })

        it('expands the list and requests a new subtask', () => {
            const tree = renderContainer()

            const [taskItem] = tree.root.findAllByType('TaskItem')
            renderer.act(() => {
                taskItem.props.createSubtask()
            })

            expect(tree.root.findAllByType('SubTasksView')).toHaveLength(1)
            expect(tree.root.findAllByType('SubTasksView')[0].props.createSubtaskRequest).toBe(1)
        })

        it('contracts the subtasks on unmount', () => {
            const expandOrContractSubtasks = jest.fn()
            const tree = renderContainer(createState(), { expandOrContractSubtasks })
            expandOrContractSubtasks.mockClear()

            renderer.act(() => {
                tree.unmount()
            })

            expect(expandOrContractSubtasks).toHaveBeenCalledWith(task.id, false)
        })
    })

    describe('uploaded new subtask', () => {
        it('expands the subtask list and clears the flag', () => {
            store.getState.mockReturnValue(createStoreState({ uploadedNewSubtask: true }))

            const tree = renderContainer()

            expect(tree.root.findAllByType('SubTasksView')).toHaveLength(1)
            expect(dispatch).toHaveBeenCalledWith(unsetUploadedNewSubtask())
        })
    })

    describe('focused task item', () => {
        it('opens the edit modal', () => {
            renderContainer(createState({ isFocusedTaskItem: true }))

            expect(mockOpenModal).toHaveBeenCalled()
        })

        it('leaves the modal closed while another edit is active', () => {
            store.getState.mockReturnValue(createStoreState({ activeEditMode: true }))

            renderContainer(createState({ isFocusedTaskItem: true }))

            expect(mockOpenModal).not.toHaveBeenCalled()
        })

        it('only clears the flag for a locked task', () => {
            objectIsLockedForUser.mockReturnValue(true)

            renderContainer(createState({ isFocusedTaskItem: true }))

            expect(mockOpenModal).not.toHaveBeenCalled()
            expect(dispatch).toHaveBeenCalledWith(setFocusedTaskItem('', false))
        })

        it('does nothing while the task is not focused', () => {
            renderContainer()

            expect(mockOpenModal).not.toHaveBeenCalled()
        })
    })
})
