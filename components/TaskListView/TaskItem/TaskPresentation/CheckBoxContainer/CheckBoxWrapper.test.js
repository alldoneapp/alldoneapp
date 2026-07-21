import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) =>
        React.createElement(React.Fragment, null, children, isOpen ? content : null)
})
jest.mock('uuid/v4', () => () => 'checkbox-1')
jest.mock('../../../../../redux/store', () => ({
    getState: () => ({ loggedUser: { uid: 'logged-user' }, openModals: {}, isQuillTagEditorOpen: false }),
}))
jest.mock('../../../../../utils/BackendBridge', () => ({ getTaskData: jest.fn() }))
jest.mock('../../../../../redux/actions', () => ({ setAssignee: jest.fn() }))
jest.mock('../../../Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getTaskOwner: jest.fn() },
    DONE_STEP: 'done',
    OPEN_STEP: 'open',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../../../../utils/HelperFunctions', () => ({
    chronoKeysOrder: jest.fn(),
    popoverToSafePosition: jest.fn(),
}))
jest.mock('../../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'record-screen',
    RECORD_VIDEO_MODAL_ID: 'record-video',
}))
jest.mock('../../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention' }))
jest.mock('../../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws_' }))
jest.mock('../../../../ContactsView/Utils/ContactsHelper', () => ({ getUserWorkflow: jest.fn() }))
jest.mock('../../../../Premium/PremiumHelper', () => ({ checkIsLimitedByXp: () => false }))
jest.mock('./TaskFlowModal', () => 'TaskFlowModal')
jest.mock('./CheckBoxContainer', () => 'CheckBoxContainer')
jest.mock('../../TaskCompletionAnimation', () => ({
    __esModule: true,
    default: () => null,
    ANIMATION_DURATION: 1,
}))
jest.mock('../../../../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromDone: jest.fn(),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
    setTaskStatus: jest.fn(),
}))
jest.mock('../../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    performEmailLineAction: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../../UIComponents/FloatModals/RecurringTaskDateBasisModal/RecurringTaskDateBasisModal', () => ({
    __esModule: true,
    default: () => null,
    shouldShowRecurringTaskDateBasisModal: () => false,
}))
jest.mock('./EmailTaskCompletionModal', () => 'EmailTaskCompletionModal')
jest.mock('../../../../../i18n/TranslationService', () => ({ translate: text => text }))

import { moveTasksFromOpen } from '../../../../../utils/backends/Tasks/tasksFirestore'
import { performEmailLineAction } from '../../../../../utils/backends/EmailLine/emailLineBackend'
import CheckBoxWrapper from './CheckBoxWrapper'

const baseTask = {
    id: 'task-1',
    userId: 'user-1',
    userIds: ['user-1'],
    isSubtask: false,
    done: false,
    estimations: { open: 15 },
    genericData: true,
    isPrivate: false,
    calendarData: null,
    gmailData: null,
}

const renderWrapper = task =>
    renderer.create(
        <CheckBoxWrapper task={task} projectId={'project-1'} accessGranted={true} loggedUserCanUpdateObject={true} />
    )

describe('CheckBoxWrapper task completion', () => {
    let consoleErrorSpy

    beforeEach(() => {
        jest.useFakeTimers()
        moveTasksFromOpen.mockClear()
        performEmailLineAction.mockClear()
        performEmailLineAction.mockResolvedValue(undefined)
        global.alert = jest.fn()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
        jest.useRealTimers()
    })

    test('regular tasks keep their direct completion behavior', async () => {
        const tree = renderWrapper(baseTask)

        act(() => {
            tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false)
            tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false)
        })
        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    test('clears the checkbox when a workflow moves between steps assigned to the same user', () => {
        const task = {
            ...baseTask,
            genericData: false,
            userIds: ['user-1', 'user-1'],
            stepHistory: ['open', 'step-1'],
        }
        let tree
        act(() => {
            tree = renderWrapper(task)
        })

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(true))
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)

        const flowModal = tree.root.find(node => typeof node.props.setVisiblePopover === 'function')
        act(() => flowModal.props.setVisiblePopover(false))

        expect(tree.root.findAll(node => typeof node.props.setVisiblePopover === 'function')).toHaveLength(0)
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(false)
    })

    test('email-linked tasks open the choice popup before completion', async () => {
        const task = {
            ...baseTask,
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-1' },
        }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(true))

        expect(moveTasksFromOpen).not.toHaveBeenCalled()
        const modal = tree.root.findByType('EmailTaskCompletionModal')
        await act(async () => {
            modal.props.onComplete(false)
            await Promise.resolve()
            jest.runAllTimers()
            await Promise.resolve()
        })

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
    })

    test('closes the popup and starts task completion before background archiving finishes', async () => {
        let finishArchive
        performEmailLineAction.mockImplementation(
            () =>
                new Promise(resolve => {
                    finishArchive = resolve
                })
        )
        const task = {
            ...baseTask,
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-1' },
        }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        const modal = tree.root.findByType('EmailTaskCompletionModal')
        act(() => modal.props.onComplete(true))

        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)
        expect(performEmailLineAction).toHaveBeenCalledWith('email_google_12345678', {
            action: 'archive',
            messageIds: ['message-1'],
        })

        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)

        await act(async () => {
            finishArchive()
            await Promise.resolve()
        })
    })

    test('keeps the task completed and reports a background archive failure', async () => {
        const archiveError = Object.assign(new Error('authentication expired'), {
            code: 'functions/permission-denied',
        })
        performEmailLineAction.mockRejectedValue(archiveError)
        const task = {
            ...baseTask,
            gmailData: { connectionId: 'email_google_12345678', messageId: 'message-2' },
        }
        const tree = renderWrapper(task)

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        await act(async () => {
            tree.root.findByType('EmailTaskCompletionModal').props.onComplete(true)
            await Promise.resolve()
            jest.runAllTimers()
            await Promise.resolve()
        })

        expect(tree.root.findAllByType('EmailTaskCompletionModal')).toHaveLength(0)
        expect(tree.root.findByType('CheckBoxContainer').props.checked).toBe(true)
        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        expect(global.alert).toHaveBeenCalledWith("Email couldn't be archived: authentication expired")
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[email task completion] Could not archive linked email in background',
            archiveError
        )
    })
})
