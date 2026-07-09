import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import TaskAssistantButton from './TaskAssistantButton'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
}))
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('react-tiny-popover', () => ({ children, content, isOpen }) => (
    <>
        {children}
        {isOpen ? content : null}
    </>
))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../UIComponents/FloatModals/ChangeAssistantModal/AssistantModal', () => 'AssistantModal')
jest.mock('../EmailLine/EmailLabelModal/DraftReplyPopup', () => 'DraftReplyPopup')
jest.mock('../../ModalsManager/modalsManager', () => ({
    TASK_ASSISTANT_MODAL_ID: 'task-assistant-modal',
    removeModal: jest.fn(),
    storeModal: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: jest.fn(() => ({ type: 'hide' })),
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant-enabled', value })),
    setSelectedNavItem: jest.fn(value => ({ type: 'selected-nav', value })),
    setTriggerChatDraft: jest.fn(value => ({ type: 'trigger-chat-draft', value })),
    showFloatPopup: jest.fn(() => ({ type: 'show' })),
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskAssistant: jest.fn(),
}))
jest.mock('../../../utils/assistantHelper', () => ({
    setObjectAssistantEnabled: jest.fn(),
}))
jest.mock('../../../utils/NavigationService', () => ({
    navigate: jest.fn(),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))

describe('TaskAssistantButton', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
    })

    test('opens draft reply popup for email tasks', () => {
        const task = {
            id: 'task-1',
            gmailData: {
                connectionId: 'connection-1',
                messageId: 'message-1',
            },
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        act(() => {
            tree.root.findByType(TouchableOpacity).props.onPress({
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            })
        })

        const popup = tree.root.findByType('DraftReplyPopup')
        expect(popup.props.projectId).toBe('connection-1')
        expect(popup.props.messageId).toBe('message-1')
        expect(popup.props.sourceProjectId).toBe('project-1')
        expect(popup.props.sourceTaskId).toBe('task-1')
    })

    test('opens draft reply popup for gmail follow-up tasks', () => {
        const task = {
            id: 'task-1',
            gmailData: {
                origin: 'gmail_label_follow_up',
                projectId: 'connection-project-1',
                messageId: 'message-1',
            },
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        act(() => {
            tree.root.findByType(TouchableOpacity).props.onPress({
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            })
        })

        const popup = tree.root.findByType('DraftReplyPopup')
        expect(popup.props.projectId).toBe('connection-project-1')
        expect(popup.props.messageId).toBe('message-1')
        expect(popup.props.sourceProjectId).toBe('project-1')
        expect(popup.props.sourceTaskId).toBe('task-1')
    })

    test('keeps assistant picker for non-email tasks', () => {
        const task = { id: 'task-1', assistantId: 'assistant-1' }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        act(() => {
            tree.root.findByType(TouchableOpacity).props.onPress({
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            })
        })

        const modal = tree.root.findByType('AssistantModal')
        expect(modal.props.projectId).toBe('project-1')
        expect(modal.props.currentAssistantId).toBe('assistant-1')
    })
})
