import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import TaskAssistantButton from './TaskAssistantButton'
import { resolveAssistantForProjectObject } from '../../AdminPanel/Assistants/assistantsHelper'

const mockDispatch = jest.fn()
let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) => (
        <React.Fragment>
            {children}
            {isOpen ? content : null}
        </React.Fragment>
    )
})
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => 'RichCommentModal')
jest.mock('../../UIComponents/ConfirmPopup', () => ({
    CONFIRM_POPUP_TRIGGER_INFO: 'CONFIRM_POPUP_TRIGGER_INFO',
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: jest.fn(() => ({ type: 'hide-float-popup' })),
    showConfirmPopup: jest.fn(value => ({ type: 'show-confirm-popup', value })),
    showFloatPopup: jest.fn(() => ({ type: 'show-float-popup' })),
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskAssistant: jest.fn(),
}))
jest.mock('../../../utils/assistantHelper', () => ({
    setObjectAssistantEnabled: jest.fn(),
}))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    resolveAssistantForProjectObject: jest.fn(),
}))
jest.mock('../../../utils/backends/Chats/chatsComments', () => ({
    createObjectMessage: jest.fn(),
}))
jest.mock('../../Feeds/Utils/HelperFunctions', () => ({
    STAYWARD_COMMENT: 'STAYWARD_COMMENT',
}))
jest.mock('../../../utils/HelperFunctions', () => ({
    popoverToTop: jest.fn(),
}))
jest.mock('../../ModalsManager/modalsManager', () => ({
    BOT_OPTION_MODAL_ID: 'BOT_OPTION_MODAL_ID',
    BOT_WARNING_MODAL_ID: 'BOT_WARNING_MODAL_ID',
    MENTION_MODAL_ID: 'MENTION_MODAL_ID',
    RUN_OUT_OF_GOLD_MODAL_ID: 'RUN_OUT_OF_GOLD_MODAL_ID',
}))
jest.mock('../../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'RECORD_SCREEN_MODAL_ID',
    RECORD_VIDEO_MODAL_ID: 'RECORD_VIDEO_MODAL_ID',
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))

const press = async tree => {
    await act(async () => {
        await tree.root.findByType(TouchableOpacity).props.onPress({
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        })
    })
}

describe('TaskAssistantButton', () => {
    beforeEach(() => {
        mockState = {
            defaultAssistant: { uid: 'global-default-assistant' },
            isQuillTagEditorOpen: false,
            openModals: {},
        }
        mockDispatch.mockClear()
        resolveAssistantForProjectObject.mockReset()
        require('../../../utils/backends/Tasks/tasksFirestore').setTaskAssistant.mockClear()
        require('../../../utils/assistantHelper').setObjectAssistantEnabled.mockClear()
        require('../../../utils/backends/Chats/chatsComments').createObjectMessage.mockClear()
        require('../../../redux/actions').showConfirmPopup.mockClear()
    })

    test('opens the comment popup for the already-assigned assistant', async () => {
        const task = { id: 'task-1', name: 'Prepare launch', userId: 'user-1', assistantId: 'assistant-1' }
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'assistant-1' })
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

        expect(resolveAssistantForProjectObject).toHaveBeenCalledWith('project-1', 'assistant-1')
        expect(require('../../../utils/assistantHelper').setObjectAssistantEnabled).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'tasks',
            true
        )
        expect(tree.root.findByType('RichCommentModal').props).toEqual(
            expect.objectContaining({
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                objectName: 'Prepare launch',
                externalAssistantId: 'assistant-1',
                currentComment: 'Start working on this task. Feel free to ask questions is anything is unclear',
                showBotButton: true,
                initialAssistantEnabled: true,
            })
        )
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'show-float-popup' })
    })

    test('submits the popup comment to the task with the assistant trigger preserved', async () => {
        const task = { id: 'task-1', name: 'Prepare launch', assistantId: 'assistant-1' }
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'assistant-1' })
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)
        await press(tree)

        await act(async () => {
            await tree.root.findByType('RichCommentModal').props.processDone('Please start', [], false, false, true)
        })

        expect(require('../../../utils/backends/Chats/chatsComments').createObjectMessage).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'Please start',
            'tasks',
            'STAYWARD_COMMENT',
            null,
            null,
            false,
            true
        )
    })

    test('uses and assigns the project default assistant when the task has none', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'project-default-assistant' })
        const task = { id: 'task-1', name: 'Prepare launch' }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

        expect(resolveAssistantForProjectObject).toHaveBeenCalledWith('project-1', undefined)
        expect(require('../../../utils/backends/Tasks/tasksFirestore').setTaskAssistant).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'project-default-assistant',
            false
        )
        expect(tree.root.findByType('RichCommentModal').props.externalAssistantId).toBe('project-default-assistant')
    })

    test('falls back to the global default assistant when the project has none', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'global-default-assistant' })
        const tree = renderer.create(
            <TaskAssistantButton projectId="project-1" task={{ id: 'task-1', name: 'Prepare launch' }} />
        )

        await press(tree)

        expect(tree.root.findByType('RichCommentModal').props.externalAssistantId).toBe('global-default-assistant')
    })

    test('shows an error and keeps the popup closed when no assistant can be resolved', async () => {
        mockState.defaultAssistant = {}
        resolveAssistantForProjectObject.mockReturnValue(null)
        const tree = renderer.create(
            <TaskAssistantButton projectId="project-1" task={{ id: 'task-1', name: 'Prepare launch' }} />
        )

        await press(tree)

        expect(require('../../../redux/actions').showConfirmPopup).toHaveBeenCalledWith(
            expect.objectContaining({ trigger: 'CONFIRM_POPUP_TRIGGER_INFO' })
        )
        expect(tree.root.findAllByType('RichCommentModal')).toHaveLength(0)
        expect(require('../../../utils/backends/Tasks/tasksFirestore').setTaskAssistant).not.toHaveBeenCalled()
    })

    test('uses the email reply draft in the same comment popup', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'project-default-assistant' })
        const task = {
            id: 'task-1',
            name: 'Reply to supplier',
            gmailData: { connectionId: 'connection-1', messageId: 'message-1' },
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

        expect(tree.root.findByType('RichCommentModal').props.currentComment).toBe(
            'Draft a reply to this email in the same language as the email with the following content: '
        )
    })
})
