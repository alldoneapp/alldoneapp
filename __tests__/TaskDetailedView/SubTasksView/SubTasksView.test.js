/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import SubtasksView from '../../../components/TaskDetailedView/SubtasksView/SubtasksView'
import Backend from '../../../utils/BackendBridge'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import URLsTasks, { URL_TASK_DETAILS_SUBTASKS } from '../../../URLSystem/Tasks/URLsTasks'
import { DV_TAB_TASK_SUBTASKS } from '../../../utils/TabNavigationConstants'

const mockDismissibleHandle = {
    toggleModal: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
}

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../../components/TaskDetailedView/SubtasksView/SubtasksHeader', () => 'SubtasksHeader')
// Render the default component so the rows stay findable in the tree instead of
// hiding inside a prop, and hand out one shared modal handle.
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
jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { watchSubtasksList: jest.fn(), unwatchSubtasksList: jest.fn() },
}))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { accessGranted: jest.fn(() => true) },
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false) },
}))
jest.mock('../../../URLSystem/Tasks/URLsTasks', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_TASK_DETAILS_SUBTASKS: 'URL_TASK_DETAILS_SUBTASKS',
}))

const projectId = 'project-1'
const userId = 'user-1'
const task = { id: 'task-1', userId, userIds: [userId], dueDate: 1579410000000 }

const subtasks = [
    { id: 'subtask-1', name: 'First subtask' },
    { id: 'subtask-2', name: 'Second subtask' },
]

const createState = ({ selectedNavItem = DV_TAB_TASK_SUBTASKS } = {}) => ({
    loggedUser: { uid: userId },
    selectedNavItem,
})

const renderSubtasks = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    let tree
    renderer.act(() => {
        tree = renderer.create(<SubtasksView task={task} projectId={projectId} {...props} />)
    })
    return tree
}

const emitSubtasks = (list = subtasks) => {
    const [, , setSubtasksList] = Backend.watchSubtasksList.mock.calls[0]
    renderer.act(() => {
        setSubtasksList(list)
    })
}

describe('SubtasksView', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        SharedHelper.accessGranted.mockReturnValue(true)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
    })

    it('watches the subtasks of its task and stops on unmount', () => {
        const tree = renderSubtasks()

        expect(Backend.watchSubtasksList).toHaveBeenCalledWith(projectId, task.id, expect.any(Function))

        renderer.act(() => {
            tree.unmount()
        })

        expect(Backend.unwatchSubtasksList).toHaveBeenCalledWith(task.id)
    })

    it('writes the browser URL while the subtasks tab is selected', () => {
        renderSubtasks()

        expect(URLsTasks.push).toHaveBeenCalledWith(
            URL_TASK_DETAILS_SUBTASKS,
            { projectId, task: task.id },
            projectId,
            task.id
        )
    })

    it('leaves the browser URL alone on another tab', () => {
        renderSubtasks(createState({ selectedNavItem: 'DV_TAB_TASK_CHAT' }))

        expect(URLsTasks.push).not.toHaveBeenCalled()
    })

    it('renders the add row and the running subtask count', () => {
        const tree = renderSubtasks()
        emitSubtasks()

        expect(tree.root.findAllByType('SubtasksHeader')[0].props.subtaskAmount).toBe(2)
        expect(tree.root.findAllByType('TaskPresentation')).toHaveLength(2)
        expect(tree.root.findAllByType('AddTask')).toHaveLength(1)
    })

    it('hides the add row without write access', () => {
        SharedHelper.accessGranted.mockReturnValue(false)

        const tree = renderSubtasks()
        emitSubtasks()

        expect(tree.root.findAllByType('AddTask')).toHaveLength(0)
    })

    it('hides the add row for a guide user who does not own the task', () => {
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(true)

        const tree = renderSubtasks(createState(), { task: { ...task, userId: 'someone-else' } })
        emitSubtasks()

        expect(tree.root.findAllByType('AddTask')).toHaveLength(0)
    })

    it('marks the subtasks of a task under review', () => {
        const tree = renderSubtasks(createState(), { task: { ...task, userIds: [userId, 'reviewer'] } })
        emitSubtasks()

        expect(tree.root.findAllByType('TaskPresentation')[0].props.isToReviewTask).toBe(true)
    })
})
