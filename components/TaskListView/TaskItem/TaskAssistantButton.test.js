import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import TaskAssistantButton from './TaskAssistantButton'
import { resolveDefaultAssistantForProject } from '../../AdminPanel/Assistants/assistantsHelper'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ defaultAssistant: { uid: 'global-default-assistant' } }),
}))
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../UIComponents/ConfirmPopup', () => ({
    CONFIRM_POPUP_TRIGGER_INFO: 'CONFIRM_POPUP_TRIGGER_INFO',
}))
jest.mock('../../../redux/actions', () => ({
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant-enabled', value })),
    setSelectedNavItem: jest.fn(value => ({ type: 'selected-nav', value })),
    setTriggerChatDraft: jest.fn(value => ({ type: 'trigger-chat-draft', value })),
    showConfirmPopup: jest.fn(value => ({ type: 'show-confirm-popup', value })),
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskAssistant: jest.fn(),
}))
jest.mock('../../../utils/assistantHelper', () => ({
    setObjectAssistantEnabled: jest.fn(),
}))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    resolveDefaultAssistantForProject: jest.fn(),
}))
jest.mock('../../../utils/NavigationService', () => ({
    navigate: jest.fn(),
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
        mockDispatch.mockClear()
        resolveDefaultAssistantForProject.mockReset()
        require('../../../utils/NavigationService').navigate.mockClear()
        require('../../../utils/backends/Tasks/tasksFirestore').setTaskAssistant.mockClear()
        require('../../../redux/actions').showConfirmPopup.mockClear()
    })

    test('starts the already-assigned assistant without opening a picker', async () => {
        const task = { id: 'task-1', assistantId: 'assistant-1' }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

        // The task already had this assistant, so we do not re-assign it, only enable + navigate.
        expect(resolveDefaultAssistantForProject).not.toHaveBeenCalled()
        expect(require('../../../utils/NavigationService').navigate).toHaveBeenCalledWith('TaskDetailedView', {
            task: expect.objectContaining({ assistantId: 'assistant-1', isAssistantEnabled: true }),
            projectId: 'project-1',
            assistantId: 'assistant-1',
        })
        expect(mockDispatch).toHaveBeenCalledWith([
            { type: 'selected-nav', value: 'TASK_CHAT' },
            { type: 'assistant-enabled', value: true },
            {
                type: 'trigger-chat-draft',
                value: {
                    text: 'Start working on this task. Feel free to ask questions is anything is unclear',
                    chatId: 'task-1',
                },
            },
        ])
    })

    test('uses the project default assistant when the task has none assigned', async () => {
        resolveDefaultAssistantForProject.mockReturnValue({ uid: 'project-default-assistant' })
        const task = { id: 'task-1' }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

        expect(resolveDefaultAssistantForProject).toHaveBeenCalledWith('project-1')
        expect(require('../../../utils/backends/Tasks/tasksFirestore').setTaskAssistant).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'project-default-assistant',
            false
        )
        expect(require('../../../utils/NavigationService').navigate).toHaveBeenCalledWith('TaskDetailedView', {
            task: expect.objectContaining({ assistantId: 'project-default-assistant', isAssistantEnabled: true }),
            projectId: 'project-1',
            assistantId: 'project-default-assistant',
        })
    })

    test('falls back to the global default assistant when the project has none', async () => {
        resolveDefaultAssistantForProject.mockReturnValue(null)
        const task = { id: 'task-1' }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

        expect(require('../../../utils/NavigationService').navigate).toHaveBeenCalledWith('TaskDetailedView', {
            task: expect.objectContaining({ assistantId: 'global-default-assistant', isAssistantEnabled: true }),
            projectId: 'project-1',
            assistantId: 'global-default-assistant',
        })
    })

    test('shows an error and does not start work when no assistant can be resolved', async () => {
        resolveDefaultAssistantForProject.mockReturnValue(null)
        const task = { id: 'task-1' }
        // No task assistant, no project default, and no global default in state.
        const useSelectorModule = require('react-redux')
        const originalUseSelector = useSelectorModule.useSelector
        useSelectorModule.useSelector = selector => selector({ defaultAssistant: {} })

        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)
        await press(tree)

        expect(require('../../../redux/actions').showConfirmPopup).toHaveBeenCalledWith(
            expect.objectContaining({ trigger: 'CONFIRM_POPUP_TRIGGER_INFO' })
        )
        expect(require('../../../utils/NavigationService').navigate).not.toHaveBeenCalled()
        expect(require('../../../utils/backends/Tasks/tasksFirestore').setTaskAssistant).not.toHaveBeenCalled()

        useSelectorModule.useSelector = originalUseSelector
    })

    test('uses the email reply prompt for email tasks without opening a picker', async () => {
        resolveDefaultAssistantForProject.mockReturnValue({ uid: 'project-default-assistant' })
        const task = {
            id: 'task-1',
            gmailData: { connectionId: 'connection-1', messageId: 'message-1' },
        }
        const tree = renderer.create(<TaskAssistantButton projectId="project-1" task={task} />)

        await press(tree)

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
})
