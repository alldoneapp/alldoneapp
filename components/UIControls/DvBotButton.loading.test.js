import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { TouchableOpacity } from 'react-native-web'

import DvBotButton from './DvBotButton'
import { resolveAssistantForProjectObject } from '../AdminPanel/Assistants/assistantsHelper'

let mockResolvedAssistant = null

jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children }) => <React.Fragment>{children}</React.Fragment>
})
jest.mock('react-hot-keys', () => ({ children }) => children)
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistantInProjectObject: jest.fn(),
    resolveAssistantForProjectObject: jest.fn(() => mockResolvedAssistant),
}))
jest.mock('../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../ChatsView/ChatDV/EditorView/BotOption/BotOptionsModal', () => 'BotOptionsModal')
jest.mock('../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal', () => 'RunOutOfGoldAssistantModal')
jest.mock('../ModalsManager/modalsManager', () => ({
    isModalOpen: jest.fn(() => false),
    MENTION_MODAL_ID: 'MENTION_MODAL_ID',
}))
jest.mock('../../utils/assistantHelper', () => ({
    executePreConfigPromptForTask: jest.fn(),
    setObjectAssistantEnabled: jest.fn(),
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskAssistant: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant-enabled', value })),
    setSelectedNavItem: jest.fn(value => ({ type: 'selected-nav-item', value })),
    setShowNotificationAboutTheBotBehavior: jest.fn(value => ({ type: 'show-bot-notice', value })),
    setTriggerChatSubmit: jest.fn(),
    setTriggerChatDraft: jest.fn(),
}))

const initialState = {
    loggedUser: { gold: 10, noticeAboutTheBotBehavior: true, defaultProjectId: 'default-project' },
    mainChatEditor: null,
    showNotificationAboutTheBotBehavior: false,
    smallScreenNavigation: false,
    projectAssistants: {},
    globalAssistants: [],
    defaultAssistant: null,
    loggedUserProjects: [],
    loggedUserProjectsMap: {},
}

const reducer = (state = initialState, action) => {
    if (action.type === 'assistant-data-loaded') {
        return {
            ...state,
            projectAssistants: {
                'project-1': [mockResolvedAssistant],
            },
        }
    }
    return state
}

describe('DvBotButton assistant loading', () => {
    beforeEach(() => {
        mockResolvedAssistant = null
        resolveAssistantForProjectObject.mockClear()
    })

    test('replaces the fallback as soon as independently loaded assistant data reaches Redux', () => {
        const store = createStore(reducer)
        const tree = renderer.create(
            <Provider store={store}>
                <DvBotButton
                    projectId="project-1"
                    assistantId=""
                    objectId="task-1"
                    objectType="tasks"
                    parentObject={{ id: 'task-1', name: 'Prepare launch' }}
                    resolveProjectAssistant={true}
                />
            </Provider>
        )

        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(true)
        expect(tree.root.findByType('AssistantAvatar').props.photoURL).toBeUndefined()

        mockResolvedAssistant = {
            uid: 'project-assistant',
            displayName: 'Project Anna',
            photoURL50: 'anna.jpg',
        }
        act(() => {
            store.dispatch({ type: 'assistant-data-loaded' })
        })

        expect(tree.root.findByType(TouchableOpacity).props.disabled).toBe(false)
        expect(tree.root.findByType('AssistantAvatar').props).toEqual(
            expect.objectContaining({
                assistantId: 'project-assistant',
                photoURL: 'anna.jpg',
                size: 24,
            })
        )
    })
})
