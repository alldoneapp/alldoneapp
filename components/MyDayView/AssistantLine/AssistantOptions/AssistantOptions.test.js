/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantOptions, { DEFERRED_QUICK_ACTION_REFRESH_MS } from './AssistantOptions'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { writeAssistantTasksCache } from '../assistantLineCache'

const mockInputBlur = jest.fn()
const mockGetOptionsPresentationData = jest.fn((project, assistantId, tasks, amount, expanded) => ({
    optionsLikeButtons: expanded
        ? [
              { id: 'task-1', task: { name: 'Quick task' } },
              { id: 'task-2', task: { name: 'Overflow task' } },
          ]
        : [{ id: 'task-1', task: { name: 'Quick task' } }],
    optionsInModal: expanded ? [] : [{ id: 'task-2', task: { name: 'Overflow task' } }],
    showSubmenu: !expanded,
    hasAdditionalOptions: true,
}))

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
    getDeviceLanguage: () => 'en',
}))

// AttachmentDropZone (AT-2444) reaches PremiumHelper -> usersFirestore -> the whole backend graph,
// which this suite has no business loading. The real zone is exercised against a real Quill in
// AssistantOptionsAttachments.test.js; here it only has to render its children.
jest.mock('../../../Feeds/CommentsTextInput/AttachmentDropZone', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, ...props }) => (
        <View testID="assistant-line-attachment-drop-zone" {...props}>
            {children}
        </View>
    )
})

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
    insertFilesAsAttachments: jest.fn(() => ({ addedFiles: [], nextCursorIndex: 0 })),
}))

// Real module pulls the whole backend bridge in through HelperFunctions' import chain. The
// attachment upload step itself is covered by AssistantOptionsAttachments.test.js (AT-2444).
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    updateNewAttachmentsData: jest.fn(async (projectId, text) => text),
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
    getOptionsPresentationData: (...args) => mockGetOptionsPresentationData(...args),
}))

jest.mock('./Search/AssistantTaskSearchButtonWrapper', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>SearchButton</Text>
})

jest.mock('./OptionButtons/OptionButtons', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ options }) => <Text>{`OptionButtons: ${options.map(option => option.task.name).join(', ')}`}</Text>
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
        localStorage.clear()
    })

    it('shows Search and a fixed option ghost while the lower-priority listener is deferred', async () => {
        jest.useFakeTimers()
        let tree
        try {
            await act(async () => {
                tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} deferQuickActions />)
            })

            expect(watchAssistantTasks).not.toHaveBeenCalled()
            expect(tree.root.findByProps({ testID: 'assistant-quick-actions-loading-skeleton' })).toBeTruthy()
            expect(JSON.stringify(tree.toJSON())).toContain('SearchButton')

            await act(async () => {
                jest.advanceTimersByTime(DEFERRED_QUICK_ACTION_REFRESH_MS)
            })

            expect(watchAssistantTasks).toHaveBeenCalledTimes(1)
            expect(JSON.stringify(tree.toJSON())).toContain('OptionButtons')
        } finally {
            await act(async () => tree?.unmount())
            jest.useRealTimers()
        }
    })

    it('renders cached quick actions immediately and refreshes them later', async () => {
        writeAssistantTasksCache({ userId: 'user-1', projectId: 'default-project', assistantId: 'assistant-1' }, [
            { id: 'cached-task', name: 'Cached task' },
        ])
        jest.useFakeTimers()
        let tree
        try {
            await act(async () => {
                tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} deferQuickActions />)
            })

            expect(JSON.stringify(tree.toJSON())).toContain('SearchButton')
            expect(watchAssistantTasks).not.toHaveBeenCalled()

            await act(async () => {
                jest.advanceTimersByTime(DEFERRED_QUICK_ACTION_REFRESH_MS)
            })
            expect(watchAssistantTasks).toHaveBeenCalledTimes(1)
        } finally {
            await act(async () => tree?.unmount())
            jest.useRealTimers()
        }
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

    it('expands overflow tasks inline and collapses them again', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        expect(JSON.stringify(tree.toJSON())).not.toContain('Overflow task')

        await act(async () => {
            tree.root.findByProps({ accessibilityLabel: 'Show all' }).props.onPress()
        })

        expect(JSON.stringify(tree.toJSON())).toContain('Overflow task')
        expect(tree.root.findByProps({ accessibilityLabel: 'Show less' })).toBeTruthy()

        await act(async () => {
            tree.root.findByProps({ accessibilityLabel: 'Show less' }).props.onPress()
        })

        expect(JSON.stringify(tree.toJSON())).not.toContain('Overflow task')
        expect(tree.root.findByProps({ accessibilityLabel: 'Show all' })).toBeTruthy()
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

    it('lines the stacked controls up on one axis and lets the input reclaim the freed width', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        const getControls = () => tree.root.findByProps({ testID: 'assistant-message-controls' })
        const getInput = () => tree.root.findByType(TextInput)

        await act(async () => {
            getInput().props.onChangeText('A message long enough to wrap')
        })
        await act(async () => {
            getInput().props.onContentSizeChange(100, 80)
        })

        const expandedStyle = StyleSheet.flatten(getControls().props.style)
        expect(expandedStyle.flexDirection).toBe('column')
        // Both controls sit on the same centre axis — "directly below each other".
        expect(expandedStyle.alignItems).toBe('center')
        // No pinned width: the cluster shrinks to the send button and the flex:1
        // input expands into the ~48px the second button no longer needs.
        expect(expandedStyle.width).toBeUndefined()
        // The field grows to the stacked cluster height so nothing overhangs it.
        expect(getInput().props.fixedHeight).toBe(88)
    })

    it('keeps the same stacked alignment on small screens', async () => {
        mockState.smallScreenNavigation = true
        try {
            let tree
            await act(async () => {
                tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
            })

            const getInput = () => tree.root.findByType(TextInput)
            await act(async () => {
                getInput().props.onChangeText('Mobile message that wraps')
            })
            await act(async () => {
                getInput().props.onContentSizeChange(100, 62)
            })

            const controls = StyleSheet.flatten(
                tree.root.findByProps({ testID: 'assistant-message-controls' }).props.style
            )
            expect(controls.flexDirection).toBe('column')
            expect(controls.alignItems).toBe('center')
            expect(controls.width).toBeUndefined()
            expect(getInput().props.fixedHeight).toBe(88)
        } finally {
            mockState.smallScreenNavigation = false
        }
    })

    it('does not un-stack when the widened input re-wraps back to a single line', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        const getControls = () => tree.root.findByProps({ testID: 'assistant-message-controls' })
        const getInput = () => tree.root.findByType(TextInput)
        const getDirection = () => StyleSheet.flatten(getControls().props.style).flexDirection

        await act(async () => {
            getInput().props.onChangeText('A message long enough to wrap')
        })
        await act(async () => {
            getInput().props.onContentSizeChange(100, 80)
        })
        expect(getDirection()).toBe('column')

        // Stacking made the input wider, so the browser now reports a single
        // line again. Un-stacking here would re-narrow the input and oscillate.
        await act(async () => {
            getInput().props.onContentSizeChange(148, 40)
        })
        expect(getDirection()).toBe('column')

        // Clearing the field is the one release condition — and it cannot feed
        // back into the wrapping, because an empty field is one line at any width.
        await act(async () => {
            getInput().props.onChangeText('')
        })
        expect(getDirection()).toBe('row')
        expect(getInput().props.fixedHeight).toBe(40)
    })

    // AT-2355: the mic used to appear only on hover/focus, i.e. on touch only after the field had
    // already been tapped. It must be there from the first render, before any interaction.
    it('shows the dictation mic without focusing or hovering the input', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        expect(tree.root.findByType(TextInput).props.alwaysShowDictation).toBe(true)
    })

    it('keeps showing the mic on small screens, where there is no hover at all', async () => {
        mockState.smallScreenNavigation = true
        try {
            let tree
            await act(async () => {
                tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
            })

            expect(tree.root.findByType(TextInput).props.alwaysShowDictation).toBe(true)
        } finally {
            mockState.smallScreenNavigation = false
        }
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

    // AT-2422: a held-mic send must end the same way a button send does. The bug was NOT here —
    // this blur always ran — but the dictation's deferred caret timer fired afterwards and undid
    // it (see dictationSubmitFocus.test.js). Pinning the host half so the voice path can never
    // quietly stop blurring instead.
    it('removes input focus and dismisses the keyboard when a held-mic dictation sends itself', async () => {
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

        // The push-to-talk path hands the text over explicitly, because the `message` state behind
        // it is still a queued setState at that point.
        await act(async () => {
            tree.root.findByType(TextInput).props.onDictationSubmit('dictated and sent')
        })

        expect(createBotQuickTopic).toHaveBeenCalledWith(expect.anything(), 'dictated and sent', expect.anything())
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

// AT-2442: the greeting shares one centred `numberOfLines={1}` line with the assistant's
// display name, so it ellipsises on narrow phones as soon as it grows. These pin BOTH
// halves of a copy change — the rendered string and the localisation — because the header
// is the app's only consumer of the key, so dropping a locale would silently ship the raw
// English key to German and Spanish users instead of failing anywhere.
describe('AssistantOptions greeting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('renders the short greeting on a single line next to the assistant name', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions amountOfButtonOptions={1} />)
        })

        // translate() is mocked to the identity, so this is the en source string.
        const header = tree.root
            .findAllByType(Text)
            .find(node => typeof node.props.children === 'string' && node.props.children.startsWith('Assistant: '))

        expect(header).toBeTruthy()
        expect(header.props.children).toBe('Assistant: How can I help?')
        expect(header.props.numberOfLines).toBe(1)
        expect(JSON.stringify(tree.toJSON())).not.toContain('What can I do for you today?')
    })

    it('is translated in every supported locale', () => {
        const locales = {
            en: require('../../../../i18n/translations/en.json'),
            de: require('../../../../i18n/translations/de.json'),
            es: require('../../../../i18n/translations/es.json'),
        }

        Object.values(locales).forEach(translations => {
            expect(typeof translations['How can I help?']).toBe('string')
            expect(translations['How can I help?'].length).toBeGreaterThan(0)
            expect(translations['What can I do for you today?']).toBeUndefined()
        })
    })
})
