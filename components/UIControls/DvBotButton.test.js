import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native-web'

import DvBotButton from './DvBotButton'
import { resolveAssistantForProjectObject } from '../AdminPanel/Assistants/assistantsHelper'

const mockDispatch = jest.fn()
const mockState = {
    loggedUser: { gold: 10, noticeAboutTheBotBehavior: true },
    mainChatEditor: null,
    showNotificationAboutTheBotBehavior: false,
    smallScreenNavigation: false,
}

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) => (
        <React.Fragment>
            {children}
            {isOpen ? content : null}
        </React.Fragment>
    )
})
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistantInProjectObject: jest.fn(),
    resolveAssistantForProjectObject: jest.fn(),
}))
jest.mock('../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../ChatsView/ChatDV/EditorView/BotOption/BotOptionsModal', () => 'BotOptionsModal')
jest.mock('../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal', () => 'RunOutOfGoldAssistantModal')
jest.mock('../ModalsManager/modalsManager', () => ({
    isModalOpen: jest.fn(() => false),
    MENTION_MODAL_ID: 'MENTION_MODAL_ID',
}))
jest.mock('../../utils/assistantHelper', () => ({
    executePreConfigPromptForTask: jest.fn(() => Promise.resolve(true)),
    setObjectAssistantEnabled: jest.fn(),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskAssistant: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant-enabled', value })),
    setSelectedNavItem: jest.fn(value => ({ type: 'selected-nav-item', value })),
    setShowNotificationAboutTheBotBehavior: jest.fn(),
    setTriggerChatSubmit: jest.fn(),
    setTriggerChatDraft: jest.fn(),
}))

describe('DvBotButton task assistant chip', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        resolveAssistantForProjectObject.mockReset()
        require('../../utils/backends/Tasks/tasksFirestore').setTaskAssistant.mockClear()
        require('../../utils/assistantHelper').executePreConfigPromptForTask.mockReset()
        require('../../utils/assistantHelper').executePreConfigPromptForTask.mockResolvedValue(true)
        require('../../redux/actions').setSelectedNavItem.mockClear()
        require('../../redux/actions').setTriggerChatSubmit.mockClear()
    })

    test('shows only the resolved assistant avatar in the compact chip and opens its predefined-task menu', () => {
        resolveAssistantForProjectObject.mockReturnValue({
            uid: 'project-assistant',
            displayName: 'Project Anna',
            photoURL50: 'anna.jpg',
        })
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId=""
                objectId="task-1"
                objectType="tasks"
                parentObject={{ id: 'task-1', assistantId: '' }}
                resolveProjectAssistant={true}
            />
        )

        expect(tree.root.findAllByType(Text)).toHaveLength(0)
        expect(tree.root.findByType('AssistantAvatar').props).toEqual(
            expect.objectContaining({ assistantId: 'project-assistant', photoURL: 'anna.jpg' })
        )
        expect(tree.root.findByType(TouchableOpacity).props.style).toHaveLength(2)

        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        expect(tree.root.findByType('BotOptionsModal').props).toEqual(
            expect.objectContaining({
                projectId: 'project-1',
                objectId: 'task-1',
                objectType: 'tasks',
                assistantId: 'project-assistant',
            })
        )
    })

    test('closes immediately and runs a predefined prompt in the background without navigation', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'project-assistant', displayName: 'Project Anna' })
        let finishExecution
        require('../../utils/assistantHelper').executePreConfigPromptForTask.mockReturnValueOnce(
            new Promise(resolve => {
                finishExecution = resolve
            })
        )
        const task = {
            id: 'task-1',
            name: 'Prepare launch',
            assistantId: 'deleted-assistant',
            isPublicFor: ['user-1'],
        }
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId="deleted-assistant"
                objectId="task-1"
                objectType="task"
                parentObject={task}
                resolveProjectAssistant={true}
            />
        )
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        const onSelectBotOption = tree.root.findByType('BotOptionsModal').props.onSelectBotOption
        act(() => {
            onSelectBotOption(
                'Run project task',
                'Launch helper',
                { model: 'MODEL_TEST', temperature: 'TEMPERATURE_NORMAL' },
                { taskMetadata: { source: 'predefined' } }
            )
        })

        expect(tree.root.findAllByType('BotOptionsModal')).toHaveLength(0)
        expect(require('../../utils/assistantHelper').executePreConfigPromptForTask).toHaveBeenCalledWith({
            projectId: 'project-1',
            taskId: 'task-1',
            task,
            assistantId: 'project-assistant',
            prompt: 'Run project task',
            name: 'Launch helper',
            aiSettings: { model: 'MODEL_TEST', temperature: 'TEMPERATURE_NORMAL' },
            taskMetadata: { source: 'predefined' },
        })
        expect(require('../../redux/actions').setSelectedNavItem).not.toHaveBeenCalled()
        expect(require('../../redux/actions').setTriggerChatSubmit).not.toHaveBeenCalled()

        await act(async () => finishExecution(true))
    })

    test('prevents duplicate background prompt execution while the first run is active', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'project-assistant', displayName: 'Project Anna' })
        let finishExecution
        require('../../utils/assistantHelper').executePreConfigPromptForTask.mockReturnValueOnce(
            new Promise(resolve => {
                finishExecution = resolve
            })
        )
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId=""
                objectId="task-1"
                objectType="tasks"
                parentObject={{ id: 'task-1', name: 'Prepare launch' }}
                resolveProjectAssistant={true}
            />
        )
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())
        const onSelectBotOption = tree.root.findByType('BotOptionsModal').props.onSelectBotOption

        act(() => {
            onSelectBotOption('Run project task', 'Launch helper')
            onSelectBotOption('Run project task', 'Launch helper')
        })

        expect(require('../../utils/assistantHelper').executePreConfigPromptForTask).toHaveBeenCalledTimes(1)
        expect(tree.root.findAllByType('BotOptionsModal')).toHaveLength(0)

        await act(async () => finishExecution(true))
    })

    test('keeps the popup closed when background prompt startup fails', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'project-assistant', displayName: 'Project Anna' })
        require('../../utils/assistantHelper').executePreConfigPromptForTask.mockRejectedValueOnce(
            new Error('background failure')
        )
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId=""
                objectId="task-1"
                objectType="tasks"
                parentObject={{ id: 'task-1', name: 'Prepare launch' }}
                resolveProjectAssistant={true}
            />
        )
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        await act(async () => {
            tree.root.findByType('BotOptionsModal').props.onSelectBotOption('Run project task', 'Launch helper')
            await Promise.resolve()
        })

        expect(tree.root.findAllByType('BotOptionsModal')).toHaveLength(0)
        expect(require('../../redux/actions').setSelectedNavItem).not.toHaveBeenCalled()
        expect(consoleError).toHaveBeenCalledWith('Failed to start pre-config prompt in background:', expect.any(Error))
        consoleError.mockRestore()
    })

    test('uses the generic avatar fallback and still opens the menu when the resolved assistant has no avatar', () => {
        resolveAssistantForProjectObject.mockReturnValue({
            uid: 'project-assistant',
            displayName: 'Project Anna',
        })
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId=""
                objectId="task-1"
                objectType="tasks"
                resolveProjectAssistant={true}
            />
        )

        expect(tree.root.findAllByType(Text)).toHaveLength(0)
        expect(tree.root.findByType('AssistantAvatar').props).toEqual(
            expect.objectContaining({ assistantId: 'project-assistant', photoURL: undefined, size: 24 })
        )

        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        expect(tree.root.findByType('BotOptionsModal').props.assistantId).toBe('project-assistant')
    })

    test('renders the generic avatar fallback without text when no assistant resolves', () => {
        resolveAssistantForProjectObject.mockReturnValue(null)
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId="deleted-assistant"
                objectId="task-1"
                objectType="tasks"
                resolveProjectAssistant={true}
            />
        )

        const button = tree.root.findByType(TouchableOpacity)
        expect(tree.root.findAllByType(Text)).toHaveLength(0)
        expect(tree.root.findByType('AssistantAvatar').props).toEqual(
            expect.objectContaining({ photoURL: undefined, size: 24 })
        )
        expect(button.props.disabled).toBe(true)
        act(() => button.props.onPress())
        expect(tree.root.findAllByType('BotOptionsModal')).toHaveLength(0)
    })
})
