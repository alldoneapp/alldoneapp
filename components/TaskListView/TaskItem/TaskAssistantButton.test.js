import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import TaskAssistantButton from './TaskAssistantButton'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ defaultAssistant: { uid: 'default-assistant' } }),
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

    test('opens the task chat with an unsent reply prompt for email tasks', async () => {
        const task = {
            id: 'task-1',
            assistantId: 'assistant-1',
            gmailData: {
                connectionId: 'connection-1',
                messageId: 'message-1',
            },
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await act(async () => {
            await tree.root.findByType(TouchableOpacity).props.onPress({
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            })
        })

        expect(mockDispatch).toHaveBeenCalledWith([
            { type: 'selected-nav', value: 'TASK_CHAT' },
            { type: 'assistant-enabled', value: true },
            {
                type: 'trigger-chat-draft',
                value: {
                    text: 'Draft a reply to this email in the same language as the email with the following content: ',
                    chatId: 'task-1',
                },
            },
        ])
    })

    test('uses the default assistant when an email task has no assistant', async () => {
        const task = {
            id: 'task-1',
            gmailData: {
                origin: 'gmail_label_follow_up',
                projectId: 'connection-project-1',
                messageId: 'message-1',
            },
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await act(async () => {
            await tree.root.findByType(TouchableOpacity).props.onPress({
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            })
        })

        expect(require('../../../utils/NavigationService').navigate).toHaveBeenCalledWith('TaskDetailedView', {
            task: expect.objectContaining({ assistantId: 'default-assistant', isAssistantEnabled: true }),
            projectId: 'project-1',
            assistantId: 'default-assistant',
        })
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
