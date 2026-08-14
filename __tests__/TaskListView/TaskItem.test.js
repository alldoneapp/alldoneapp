/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import TaskItem from '../../components/TaskListView/TaskItem'
import store from '../../redux/store'
import { setCheckTaskItem } from '../../redux/actions'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../../components/Guides/guidesHelper'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
// Swallow the forwarded ref: the test supplies its own dismissibleRef handle
// and a host component would overwrite it with a null instance.
jest.mock('../../components/UIComponents/DismissibleItem', () => {
    const mockReact = require('react')
    return mockReact.forwardRef((props, ref) => mockReact.createElement('DismissibleItem', props))
})
jest.mock('../../components/TaskListView/TaskPresentationContainer', () => 'TaskPresentationContainer')
jest.mock('../../components/TaskListView/TaskItem/EditTask', () => 'EditTask')
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))
jest.mock('../../redux/actions', () => ({
    setCheckTaskItem: jest.fn((id, isObserved) => ({ type: 'Set check task item', id, isObserved })),
}))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false) },
}))
jest.mock('../../components/Guides/guidesHelper', () => ({
    objectIsLockedForUser: jest.fn(() => false),
}))

const projectId = 'project-1'
const userId = 'user-1'
const task = { id: 'task-1', name: 'Some random text', userId, userIds: [], recurrence: { type: 'never' } }

const dispatch = jest.fn()

const createState = ({ isCheckedTaskItem = false, swipeDueDatePopupVisible = false } = {}) => ({
    checkTaskItem: { id: isCheckedTaskItem ? task.id : '', isObserved: false },
    showSwipeDueDatePopup: { visible: swipeDueDatePopupVisible },
})

const createStoreState = ({ isAnonymous = false, activeEditMode = false } = {}) => ({
    activeEditMode,
    loggedUser: { isAnonymous, uid: userId, unlockedKeysByGuides: {} },
    showSwipeDueDatePopup: { visible: false },
})

const renderTaskItem = (state = createState(), props = {}) => {
    useSelector.mockImplementation(selector => selector(state))

    const dismissibleRef = { current: { toggleModal: jest.fn(), closeModal: jest.fn() } }
    const taskItemRef = { current: { onCheckboxPress: jest.fn() } }
    const setInEditMode = jest.fn()
    const setShowSubTaskIndicator = jest.fn()

    let tree
    renderer.act(() => {
        tree = renderer.create(
            <TaskItem
                projectId={projectId}
                task={task}
                dismissibleRef={dismissibleRef}
                taskItemRef={taskItemRef}
                setInEditMode={setInEditMode}
                setShowSubTaskIndicator={setShowSubTaskIndicator}
                subtaskList={[]}
                {...props}
            />
        )
    })

    return { tree, dismissibleRef, taskItemRef, setInEditMode, setShowSubTaskIndicator }
}

describe('TaskItem component', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        store.getState.mockReturnValue(createStoreState())
        objectIsLockedForUser.mockReturnValue(false)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
    })

    describe('rendering', () => {
        it('renders the presentation and the edit modal for its task', () => {
            const { tree } = renderTaskItem()

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            expect(dismissible.props.defaultComponent.type).toBe('TaskPresentationContainer')
            expect(dismissible.props.defaultComponent.props.task).toBe(task)
            expect(dismissible.props.defaultComponent.props.projectId).toBe(projectId)
            expect(dismissible.props.modalComponent.type).toBe('EditTask')
            expect(dismissible.props.modalComponent.props.task).toBe(task)
        })

        it('passes the pending and observed flags through to both components', () => {
            const { tree } = renderTaskItem(createState(), { isPending: true, isObservedTask: true })

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            expect(dismissible.props.defaultComponent.props.isPending).toBe(true)
            expect(dismissible.props.defaultComponent.props.isObservedTask).toBe(true)
            expect(dismissible.props.modalComponent.props.isPending).toBe(true)
        })
    })

    describe('toggleModal', () => {
        it('opens the edit modal', () => {
            const { tree, dismissibleRef } = renderTaskItem()

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            dismissible.props.defaultComponent.props.toggleModal()

            expect(dismissibleRef.current.toggleModal).toHaveBeenCalled()
        })

        it('does nothing while the swipe due date popup is visible', () => {
            const { tree, dismissibleRef } = renderTaskItem(createState({ swipeDueDatePopupVisible: true }))

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            dismissible.props.defaultComponent.props.toggleModal()

            expect(dismissibleRef.current.toggleModal).not.toHaveBeenCalled()
        })
    })

    describe('onToggleModal', () => {
        it('toggles the subtask indicator and the edit mode', () => {
            const { tree, setInEditMode, setShowSubTaskIndicator } = renderTaskItem()

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            dismissible.props.onToggleModal(true)

            expect(setShowSubTaskIndicator).toHaveBeenCalledWith(true)
            expect(setInEditMode).toHaveBeenCalled()
        })

        it('leaves the subtask indicator alone for an anonymous user', () => {
            store.getState.mockReturnValue(createStoreState({ isAnonymous: true }))
            const { tree, setInEditMode, setShowSubTaskIndicator } = renderTaskItem()

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            dismissible.props.onToggleModal(true)

            expect(setShowSubTaskIndicator).not.toHaveBeenCalled()
            expect(setInEditMode).toHaveBeenCalled()
        })

        it('keeps the indicator visible while the subtask list has entries', () => {
            const { tree, setShowSubTaskIndicator } = renderTaskItem(createState(), { subtaskList: [{ id: 'sub-1' }] })

            const [dismissible] = tree.root.findAllByType('DismissibleItem')
            dismissible.props.onToggleModal(false)

            expect(setShowSubTaskIndicator).toHaveBeenCalledWith(true)
        })
    })

    describe('checked task item', () => {
        it('checks the task off and clears the flag', () => {
            const { taskItemRef } = renderTaskItem(createState({ isCheckedTaskItem: true }))

            expect(taskItemRef.current.onCheckboxPress).toHaveBeenCalled()
            expect(dispatch).toHaveBeenCalledWith(setCheckTaskItem('', false))
        })

        it('only clears the flag for a locked task', () => {
            objectIsLockedForUser.mockReturnValue(true)
            const { taskItemRef } = renderTaskItem(createState({ isCheckedTaskItem: true }))

            expect(taskItemRef.current.onCheckboxPress).not.toHaveBeenCalled()
            expect(dispatch).toHaveBeenCalledWith(setCheckTaskItem('', false))
        })

        it('does not check the task off for a guide user who does not own it', () => {
            ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(true)
            const { taskItemRef } = renderTaskItem(createState({ isCheckedTaskItem: true }), {
                task: { ...task, userId: 'someone-else' },
            })

            expect(taskItemRef.current.onCheckboxPress).not.toHaveBeenCalled()
        })

        it('closes the edit mode before checking the task off', () => {
            jest.useFakeTimers()
            store.getState.mockReturnValue(createStoreState({ activeEditMode: true }))

            const { dismissibleRef, taskItemRef } = renderTaskItem(createState({ isCheckedTaskItem: true }))

            expect(dismissibleRef.current.toggleModal).toHaveBeenCalled()
            expect(taskItemRef.current.onCheckboxPress).not.toHaveBeenCalled()

            jest.runAllTimers()
            expect(taskItemRef.current.onCheckboxPress).toHaveBeenCalled()
            jest.useRealTimers()
        })

        it('does nothing while the task is not checked', () => {
            const { taskItemRef } = renderTaskItem()

            expect(taskItemRef.current.onCheckboxPress).not.toHaveBeenCalled()
            expect(dispatch).not.toHaveBeenCalled()
        })
    })
})
