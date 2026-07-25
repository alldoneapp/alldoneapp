/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import SubTasksView from '../../../components/TaskListView/Subtask/SubTasksView'
import store from '../../../redux/store'
import { setCheckTaskItem } from '../../../redux/actions'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

const mockDismissibleHandle = {
    toggleModal: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
}
const mockOnCheckboxPress = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
// Every DismissibleItem shares one handle so the modal calls can be asserted
// without reaching into the real component. It renders its default component so
// the rows stay findable in the tree instead of hiding inside a prop.
jest.mock('../../../components/UIComponents/DismissibleItem', () => {
    const mockReact = require('react')
    return mockReact.forwardRef((props, ref) => {
        mockReact.useImperativeHandle(ref, () => mockDismissibleHandle)
        return mockReact.createElement('DismissibleItem', props, props.defaultComponent)
    })
})
jest.mock('../../../components/TaskListView/TaskItem/TaskPresentation/TaskPresentation', () => 'TaskPresentation')
jest.mock('../../../components/TaskListView/TaskItem/EditTask', () => 'EditTask')
jest.mock('../../../components/TaskListView/AddTask', () => 'AddTask')
jest.mock('../../../components/TaskListView/ParentTaskContainer', () => 'ParentTaskContainer')
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))
jest.mock('../../../redux/actions', () => ({
    setCheckTaskItem: jest.fn((id, isObserved) => ({ type: 'Set check task item', id, isObserved })),
}))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { checkIfUserHasAccessToProject: jest.fn(() => true) },
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false) },
}))
jest.mock('../../../utils/TaskPriority', () => ({
    sortTasksByPriority: jest.fn(subtaskList => subtaskList),
}))

const projectId = '-LcRVRo6mhbC0oXCcZ2F'
const userId = 'UUKU61Jc7ET8zE5ncN8F61HE19y1'
const parentTask = { id: '-LyzhG-xGsc74qaNARtB', name: 'Hallo ', userId, dueDate: 1579410000000 }

const subtaskList = [
    { id: 'subtask-1', name: 'First subtask' },
    { id: 'subtask-2', name: 'Second subtask' },
]

const dispatch = jest.fn()

const createState = ({ checkTaskItemId = '', focusedTaskItemId = '', isAnonymous = false } = {}) => ({
    checkTaskItem: { id: checkTaskItemId, isObserved: false },
    focusedTaskItem: { id: focusedTaskItemId, isObserved: false },
    loggedUser: { uid: userId, isAnonymous, inFocusTaskId: '', projectIds: [projectId] },
})

const renderSubTasks = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    let tree
    renderer.act(() => {
        tree = renderer.create(
            <SubTasksView
                projectId={projectId}
                parentTask={parentTask}
                subtaskList={subtaskList}
                hideSubtaskList={jest.fn()}
                showSubtaskList={jest.fn()}
                {...props}
            />,
            { createNodeMock: () => ({ setNativeProps: jest.fn(), onCheckboxPress: mockOnCheckboxPress }) }
        )
    })
    return tree
}

describe('SubTasksView component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        store.getState.mockReturnValue({ activeEditMode: false })
        SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(true)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
    })

    describe('rendering', () => {
        it('renders one row per subtask plus the add row', () => {
            const tree = renderSubTasks()

            const rows = tree.root.findAllByType('TaskPresentation')
            expect(rows).toHaveLength(2)
            expect(rows[0].props.task).toBe(subtaskList[0])
            expect(rows[0].props.parentTask).toBe(parentTask)
            expect(tree.root.findAllByType('AddTask')).toHaveLength(1)
        })

        it('renders draggable containers in organize mode and drops the add row', () => {
            const tree = renderSubTasks(createState(), { isActiveOrganizeMode: true })

            expect(tree.root.findAllByType('ParentTaskContainer')).toHaveLength(2)
            expect(tree.root.findAllByType('TaskPresentation')).toHaveLength(0)
            expect(tree.root.findAllByType('AddTask')).toHaveLength(0)
        })

        it('hides the add row without access to the project', () => {
            SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(false)

            const tree = renderSubTasks()

            expect(tree.root.findAllByType('AddTask')).toHaveLength(0)
        })

        it('hides the add row for a guide user who does not own the parent task', () => {
            ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(true)

            const tree = renderSubTasks(createState(), { parentTask: { ...parentTask, userId: 'someone-else' } })

            expect(tree.root.findAllByType('AddTask')).toHaveLength(0)
        })

        it('marks the rows of a pending parent task', () => {
            const tree = renderSubTasks(createState(), { isPending: true })

            expect(tree.root.findAllByType('TaskPresentation')[0].props.isPending).toBe(true)
        })
    })

    describe('the new subtask row', () => {
        it('opens straight away when the parent has no subtask yet', () => {
            renderSubTasks(createState(), { subtaskList: [] })

            expect(mockDismissibleHandle.toggleModal).toHaveBeenCalled()
        })

        it('stays closed when the parent already has subtasks', () => {
            renderSubTasks()

            expect(mockDismissibleHandle.toggleModal).not.toHaveBeenCalled()
        })

        it('opens on an explicit create request', () => {
            renderSubTasks(createState(), { createSubtaskRequest: 1 })

            expect(mockDismissibleHandle.openModal).toHaveBeenCalled()
        })
    })

    describe('focused subtask', () => {
        it('opens the edit modal of the focused subtask', () => {
            renderSubTasks(createState({ focusedTaskItemId: 'subtask-2' }))

            expect(mockDismissibleHandle.openModal).toHaveBeenCalled()
        })

        it('leaves the modal closed while another edit is active', () => {
            store.getState.mockReturnValue({ activeEditMode: true })

            renderSubTasks(createState({ focusedTaskItemId: 'subtask-2' }))

            expect(mockDismissibleHandle.openModal).not.toHaveBeenCalled()
        })
    })

    describe('checked subtask', () => {
        it('clears the flag once the subtask is checked off', () => {
            renderSubTasks(createState({ checkTaskItemId: 'subtask-1' }))

            expect(dispatch).toHaveBeenCalledWith(setCheckTaskItem('', false))
            expect(mockOnCheckboxPress).toHaveBeenCalled()
        })

        it('does nothing for a subtask that is not in the list', () => {
            renderSubTasks(createState({ checkTaskItemId: 'somewhere-else' }))

            expect(dispatch).not.toHaveBeenCalled()
        })
    })
})
