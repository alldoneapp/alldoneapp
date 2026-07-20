/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Keyboard, StyleSheet, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantOptions from './AssistantOptions'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'

const mockInputBlur = jest.fn()

const mockState = {
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: 'selected-project', index: 0, name: 'Selected project' }],
    defaultAssistant: { uid: 'assistant-1' },
    loggedUser: { uid: 'user-1', defaultProjectId: 'default-project', gold: 100 },
    smallScreenNavigation: false,
}

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))

jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children }) => <>{children}</>
})

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
}))

jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    watchAssistantTasks: jest.fn((projectId, assistantId, watcherKey, callback) => {
        callback([{ id: 'task-1', name: 'Quick task' }])
    }),
}))

jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
    runHttpsCallableFunction: jest.fn(),
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    createBotQuickTopic: jest.fn(),
    generateUserIdsToNotifyForNewComments: jest.fn(),
}))

jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    isGlobalAssistant: jest.fn(() => false),
}))

jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    TASK_THEME: 'TASK_THEME',
}))

jest.mock('../../../../redux/actions', () => ({
    stopLoadingData: () => ({ type: 'stop' }),
}))

jest.mock('./helper', () => ({
    getAssistantLineData: () => ({
        assistant: { uid: 'assistant-1', displayName: 'Assistant' },
        assistantProject: { id: 'default-project', index: 1, name: 'Default project' },
        assistantProjectId: 'default-project',
    }),
    getOptionsPresentationData: () => ({
        optionsLikeButtons: [{ id: 'task-1', task: { name: 'Quick task' } }],
        optionsInModal: [],
        showSubmenu: false,
    }),
}))

jest.mock('./Search/AssistantTaskSearchButtonWrapper', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>SearchButton</Text>
})

jest.mock('./OptionButtons/OptionButtons', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>OptionButtons</Text>
})

jest.mock('./MoreOptions/MoreOptionsWrapper', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>MoreOptions</Text>
})

jest.mock('./AssistantAvatarButton', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>Avatar</Text>
})

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    const { TextInput } = require('react-native')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({
            clear: jest.fn(),
            blur: mockInputBlur,
            isFocused: () => false,
        }))
        return <TextInput {...props} />
    })
})

jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return ({ title, onPress, accessibilityLabel }) => (
        <TouchableOpacity onPress={onPress} accessibilityLabel={accessibilityLabel}>
            <Text>{title || 'Button'}</Text>
        </TouchableOpacity>
    )
})

jest.mock('../../../UIComponents/AssistantVoiceCallButton', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ projectId }) => <Text testID="voice-call-project">{projectId}</Text>
})

jest.mock('../../../UIComponents/Spinner', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>Spinner</Text>
})

jest.mock('../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>RunOutOfGold</Text>
})

describe('AssistantOptions search button', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('renders the pinned Search button before assistant task quick actions', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        const output = JSON.stringify(tree.toJSON())
        expect(output.indexOf('SearchButton')).toBeGreaterThan(-1)
        expect(output.indexOf('OptionButtons')).toBeGreaterThan(-1)
        expect(output.indexOf('SearchButton')).toBeLessThan(output.indexOf('OptionButtons'))
    })

    it('stacks the voice and send controls when the assistant input expands', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        const getControlsStyle = () =>
            StyleSheet.flatten(tree.root.findByProps({ testID: 'assistant-message-controls' }).props.style)

        expect(getControlsStyle().flexDirection).toBe('row')

        await act(async () => {
            tree.root.findByType(TextInput).props.onContentSizeChange(100, 80)
        })

        expect(getControlsStyle().flexDirection).toBe('column')
    })

    it('keeps the input stable when content measurements oscillate at the scroll boundary', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        const getInput = () => tree.root.findByType(TextInput)
        expect(getInput().props.autoExpand).toBe(true)

        await act(async () => {
            getInput().props.onContentSizeChange(100, 121)
        })
        expect(getInput().props.fixedHeight).toBe(120)
        expect(getInput().props.scrollEnabled).toBe(true)

        await act(async () => {
            getInput().props.onContentSizeChange(100, 119)
        })
        expect(getInput().props.fixedHeight).toBe(120)
        expect(getInput().props.scrollEnabled).toBe(true)
    })

    it('removes input focus and dismisses the keyboard when sending a message', async () => {
        createBotQuickTopic.mockResolvedValue({
            projectId: 'selected-project',
            chatId: 'chat-1',
            isPublicFor: ['all'],
        })
        const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss')
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        await act(async () => {
            tree.root.findByType(TextInput).props.onChangeText('Send and close the keyboard')
        })

        const sendButton = tree.root
            .findAllByType(TouchableOpacity)
            .find(node => node.props.accessibilityLabel === 'Send')
        await act(async () => {
            await sendButton.props.onPress()
        })

        expect(mockInputBlur).toHaveBeenCalledTimes(1)
        expect(dismissKeyboard).toHaveBeenCalledTimes(1)
        dismissKeyboard.mockRestore()
    })

    it('creates fallback-assistant chats in the selected project while loading tasks from the assistant project', async () => {
        createBotQuickTopic.mockResolvedValue({
            projectId: 'selected-project',
            chatId: 'chat-1',
            isPublicFor: ['all'],
        })

        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        expect(watchAssistantTasks).toHaveBeenCalledWith(
            'default-project',
            'assistant-1',
            expect.any(String),
            expect.any(Function)
        )

        const input = tree.root.findByType(TextInput)
        expect(input.props.projectId).toBe('selected-project')
        expect(tree.root.findByProps({ testID: 'voice-call-project' }).props.children).toBe('selected-project')

        await act(async () => {
            input.props.onChangeText('Use this project context')
        })

        const sendButton = tree.root
            .findAllByType(TouchableOpacity)
            .find(node => node.props.accessibilityLabel === 'Send')
        await act(async () => {
            await sendButton.props.onPress()
        })

        expect(createBotQuickTopic).toHaveBeenCalledWith(
            { uid: 'assistant-1', displayName: 'Assistant' },
            'Use this project context',
            {
                skipNavigation: true,
                enableAssistant: true,
                projectId: 'selected-project',
            }
        )
    })
})
