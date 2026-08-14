/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

// AT-2183: the add task popup used to register three identical `document`
// keydown listeners (TaskEditForm, ButtonsArea and DoneButton), so one Return
// ran the creation up to three times.

jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/InputArea', () => 'InputArea')
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/DueDate', () => 'DueDate')
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/Privacy', () => 'Privacy')
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/ParentGoal', () => 'ParentGoal')
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/Recurring', () => 'Recurring')
jest.mock('../../../components/UIComponents/FloatModals/RichCreateTaskModal/MoreOptions', () => 'MoreOptions')
jest.mock('../../../components/UIControls/Button', () => 'Button')
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getTaskNameWithoutMeta: name => name },
}))
jest.mock('../../../utils/BackendBridge', () => ({ setLinkedParentObjects: jest.fn() }))
jest.mock('../../../redux/store', () => ({
    getState: () => ({ isQuillTagEditorOpen: false, openModals: {} }),
}))

import TaskEditForm from '../../../components/UIComponents/FloatModals/RichCreateTaskModal/TaskEditForm'

const task = { name: 'Buy milk', extendedName: 'Buy milk', isPrivate: false, parentGoalId: null }

const renderForm = onSuccess => {
    let tree
    act(() => {
        tree = renderer.create(
            <TaskEditForm
                projectId="project-1"
                isAssigneeVisible={false}
                task={task}
                setTask={jest.fn()}
                onSuccess={onSuccess}
                mentions={[]}
                setMentions={jest.fn()}
                showDueDate={jest.fn()}
                showPrivacy={jest.fn()}
                showRecurring={jest.fn()}
                showParentGoal={jest.fn()}
                showMoreOptions={jest.fn()}
            />
        )
    })
    return tree
}

const pressEnter = (init = {}) => {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }))
    })
}

describe('Add task popup Enter handling (AT-2183)', () => {
    test('one Return press runs the creation exactly once', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(onSuccess)

        pressEnter()

        expect(onSuccess).toHaveBeenCalledTimes(1)

        act(() => {
            tree.unmount()
        })
    })

    test('holding Return down does not submit repeatedly', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(onSuccess)

        pressEnter()
        // Browsers emit repeated keydown events while the key stays pressed.
        pressEnter({ repeat: true })
        pressEnter({ repeat: true })

        expect(onSuccess).toHaveBeenCalledTimes(1)

        act(() => {
            tree.unmount()
        })
    })

    test('an IME composition commit is not treated as a submission', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(onSuccess)

        pressEnter({ keyCode: 229 })

        expect(onSuccess).not.toHaveBeenCalled()

        act(() => {
            tree.unmount()
        })
    })

    test('stops listening once the popup is unmounted', () => {
        const onSuccess = jest.fn()
        const tree = renderForm(onSuccess)

        act(() => {
            tree.unmount()
        })
        pressEnter()

        expect(onSuccess).not.toHaveBeenCalled()
    })
})
