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
}

const renderWrapper = task =>
    renderer.create(
        <CheckBoxWrapper task={task} projectId={'project-1'} accessGranted={true} loggedUserCanUpdateObject={true} />
    )

describe('CheckBoxWrapper email task completion', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        moveTasksFromOpen.mockClear()
    })

    afterEach(() => {
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
})
