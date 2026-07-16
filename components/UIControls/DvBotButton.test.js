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
jest.mock('../../utils/assistantHelper', () => ({ setObjectAssistantEnabled: jest.fn() }))
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
    })

    test('shows the resolved assistant identity and opens its predefined-task menu', () => {
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
                showAssistantName={true}
                resolveProjectAssistant={true}
            />
        )

        expect(tree.root.findByType(Text).props.children).toBe('Project Anna')
        expect(tree.root.findByType('AssistantAvatar').props).toEqual(
            expect.objectContaining({ assistantId: 'project-assistant', photoURL: 'anna.jpg' })
        )

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

    test('persists the resolved assistant before running a predefined task', async () => {
        resolveAssistantForProjectObject.mockReturnValue({ uid: 'project-assistant', displayName: 'Project Anna' })
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId="deleted-assistant"
                objectId="task-1"
                objectType="task"
                parentObject={{ id: 'task-1', assistantId: 'deleted-assistant' }}
                showAssistantName={true}
                resolveProjectAssistant={true}
            />
        )
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())

        await act(async () => {
            await tree.root.findByType('BotOptionsModal').props.onSelectBotOption('Run project task')
        })

        expect(require('../../utils/backends/Tasks/tasksFirestore').setTaskAssistant).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'project-assistant',
            true
        )
    })

    test('renders a disabled fallback instead of opening an invalid assistant menu', () => {
        resolveAssistantForProjectObject.mockReturnValue(null)
        const tree = renderer.create(
            <DvBotButton
                projectId="project-1"
                assistantId="deleted-assistant"
                objectId="task-1"
                objectType="tasks"
                showAssistantName={true}
                resolveProjectAssistant={true}
            />
        )

        const button = tree.root.findByType(TouchableOpacity)
        expect(tree.root.findByType(Text).props.children).toBe('No assistant')
        expect(button.props.disabled).toBe(true)
        act(() => button.props.onPress())
        expect(tree.root.findAllByType('BotOptionsModal')).toHaveLength(0)
    })
})
