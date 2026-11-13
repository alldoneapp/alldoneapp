/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantOptions from './AssistantOptions'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import {
    PENDING_SEND_AWAITING_REPLY,
    PENDING_SEND_FAILED,
    PENDING_SEND_SENDING,
    getPendingAssistantLineSend,
    resetAssistantLinePendingSends,
} from '../assistantLinePendingSend'

const mockInputBlur = jest.fn()
const mockInputClear = jest.fn()
const mockInputClearAndSetContent = jest.fn()

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

jest.mock('../../../../utils/assistantHelper', () => ({
    createBotQuickTopic: jest.fn(),
    generateUserIdsToNotifyForNewComments: jest.fn(),
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
}))

jest.mock('./Search/AssistantTaskSearchButtonWrapper', () => 'AssistantTaskSearchButtonWrapper')
// The switcher reaches the popover/modal stack; its own behaviour is AssistantSwitchControl.test.js.
jest.mock('../AssistantSwitchControl', () => 'AssistantSwitchControl')
jest.mock('../../../RageMode/RageModeButton', () => 'RageModeButton')
jest.mock('../../../Anna/AssistantModeButton', () => 'AssistantModeButton')

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
            clear: mockInputClear,
            clearAndSetContent: mockInputClearAndSetContent,
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

const renderOptions = async (props = {}) => {
    let tree
    await act(async () => {
        tree = renderer.create(<AssistantOptions {...props} />)
    })
    return tree
}

// The style of the nearest View around a node (react-test-renderer adds host wrappers between).
const styleAround = node => {
    let current = node.parent
    while (current && !current.props.style) current = current.parent
    return StyleSheet.flatten(current?.props.style)
}

describe('AssistantOptions layout', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('shows one Templates entry, told to list the line assistant first', async () => {
        const tree = await renderOptions()

        const templates = tree.root.findAllByType('AssistantTaskSearchButtonWrapper')
        expect(templates).toHaveLength(1)
        expect(templates[0].props.preferredAssistantId).toBe('assistant-1')
        expect(templates[0].props.preferredProjectId).toBe('selected-project')
    })

    // AT-3034: rage mode is back at the top right of the header (and stays on the Empty inbox card).
    it('puts the rage mode crosshair at the right of the header, beside the avatar it launches from', async () => {
        const tree = await renderOptions()

        const header = tree.root.findByProps({ testID: 'assistant-line-header' })
        const rage = header.findAllByType('RageModeButton')
        expect(rage).toHaveLength(1)
        expect(styleAround(rage[0])).toMatchObject({ position: 'absolute', right: 0 })
        expect(header.findByProps({ nativeID: 'rage-mode-launch-anchor' })).toBeTruthy()
    })

    // AT-3034: assistant mode starts from the top left of the line, with the line's assistant.
    it('starts assistant mode from the top left of the header with the line project and assistant', async () => {
        const tree = await renderOptions({ assistantModeProjectId: 'selected-project' })

        const header = tree.root.findByProps({ testID: 'assistant-line-header' })
        const button = header.findByType('AssistantModeButton')
        expect(button.props).toMatchObject({
            inline: true,
            testID: 'assistant-line-assistant-mode',
            projectId: 'selected-project',
            assistantName: 'Assistant',
        })
        expect(styleAround(button)).toMatchObject({ position: 'absolute', left: 0 })
    })

    it('opens the default chat ("Automatic") when the line names no project', async () => {
        const tree = await renderOptions()

        expect(tree.root.findByType('AssistantModeButton').props.projectId).toBeNull()
    })

    it('puts the + and the mic into the toolbar instead of floating them in the field', async () => {
        const tree = await renderOptions()

        const input = tree.root.findByType(TextInput)
        expect(input.props.showAttachmentButton).toBe(true)
        expect(input.props.inlineControlTargets).toEqual({ attachment: null, dictation: null })
        expect(input.props.stackInlineControls).toBeUndefined()
        expect(tree.root.findByProps({ testID: 'assistant-composer-toolbar' })).toBeTruthy()
    })

    it('rests at two lines', async () => {
        const tree = await renderOptions()

        expect(tree.root.findByType(TextInput).props.fixedHeight).toBe(56)
    })

    it('shows the plain name without a switch scope, and the switcher with the name as its label with one', async () => {
        const plain = await renderOptions()
        expect(plain.root.findAllByType('AssistantSwitchControl')).toHaveLength(0)
        expect(plain.root.findAllByType(Text).some(node => node.props.children === 'Assistant')).toBe(true)

        const assistantSwitch = { groups: [], activeAssistantId: 'assistant-1', onSelect: jest.fn() }
        const switched = await renderOptions({ assistantSwitch })
        const control = switched.root.findByType('AssistantSwitchControl')
        expect(control.props.label).toBe('Assistant')
        expect(control.props.onSelect).toBe(assistantSwitch.onSelect)
    })

    it('renders the edit control it is handed in the header', async () => {
        const tree = await renderOptions({ headerControls: <Text testID="edit-control">Edit</Text> })

        expect(tree.root.findByProps({ testID: 'edit-control' })).toBeTruthy()
        // The assistant-mode button leads, the edit pencil follows it.
        const side = tree.root.findByType('AssistantModeButton').parent
        expect(side.findByProps({ testID: 'edit-control' })).toBeTruthy()
    })

    // AT-2355: the mic used to appear only on hover/focus, i.e. on touch only after the field had
    // already been tapped. It must be there from the first render, before any interaction.
    it('shows the dictation mic without focusing or hovering the input', async () => {
        const tree = await renderOptions()

        expect(tree.root.findByType(TextInput).props.alwaysShowDictation).toBe(true)
    })

    it('keeps showing the mic on small screens, where there is no hover at all', async () => {
        mockState.smallScreenNavigation = true
        try {
            const tree = await renderOptions()

            expect(tree.root.findByType(TextInput).props.alwaysShowDictation).toBe(true)
        } finally {
            mockState.smallScreenNavigation = false
        }
    })

    it('keeps the input stable when content measurements oscillate at the scroll boundary', async () => {
        const tree = await renderOptions()

        const getInput = () => tree.root.findByType(TextInput)
        expect(getInput().props.autoExpand).toBe(true)

        // The field adds its own 8px of vertical padding to the reported content height.
        await act(async () => {
            getInput().props.onContentSizeChange(100, 145)
        })
        expect(getInput().props.fixedHeight).toBe(152)
        expect(getInput().props.scrollEnabled).toBe(true)

        await act(async () => {
            getInput().props.onContentSizeChange(100, 143)
        })
        expect(getInput().props.fixedHeight).toBe(152)
        expect(getInput().props.scrollEnabled).toBe(true)
    })

    it('removes input focus and dismisses the keyboard when sending a message', async () => {
        createBotQuickTopic.mockResolvedValue({
            projectId: 'selected-project',
            chatId: 'chat-1',
            isPublicFor: ['all'],
        })
        const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss')
        const tree = await renderOptions()

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
        const tree = await renderOptions()

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

    it('creates fallback-assistant chats in the selected project', async () => {
        createBotQuickTopic.mockResolvedValue({
            projectId: 'selected-project',
            chatId: 'chat-1',
            isPublicFor: ['all'],
        })

        const tree = await renderOptions()

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
                onAssistantRunSettled: expect.any(Function),
            }
        )
    })
})

describe('AssistantOptions empty composer mic (AT-3025)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    const findSend = tree =>
        tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Send')

    it('hands the field the send slot and says whether the composer is empty', async () => {
        const tree = await renderOptions()
        const input = () => tree.root.findByType(TextInput)

        expect(input().props.sendSlotDictation).toEqual(
            expect.objectContaining({ empty: true, style: expect.anything() })
        )
        await act(async () => {
            input().props.onChangeText('Hello')
        })
        expect(input().props.sendSlotDictation.empty).toBe(false)
        await act(async () => {
            input().props.onChangeText('   ')
        })
        expect(input().props.sendSlotDictation.empty).toBe(true)
    })

    it('replaces the send button while the mic sits in its slot, and brings it back after', async () => {
        const tree = await renderOptions()
        const input = () => tree.root.findByType(TextInput)
        expect(findSend(tree)).toBeTruthy()

        await act(async () => {
            input().props.onSendSlotDictationChange(true)
        })
        expect(findSend(tree)).toBeUndefined()

        await act(async () => {
            input().props.onChangeText('Hello')
            input().props.onSendSlotDictationChange(false)
        })
        expect(findSend(tree)).toBeTruthy()
    })
})

describe('AssistantOptions mentions (AT-2592)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('asks the shared composer to preserve selected assistants as real mentions', async () => {
        const tree = await renderOptions()

        const input = tree.root.findByType(TextInput)
        expect(input.props.insertAssistantAsMention).toBe(true)
    })
})

// AT-2442: the greeting shares one centred `numberOfLines={1}` line with the assistant's
// avatar and name, so it ellipsises on narrow phones as soon as it grows. These pin BOTH
// halves of a copy change — the rendered string and the localisation — because the header
// is the app's only consumer of the key, so dropping a locale would silently ship the raw
// English key to German and Spanish users instead of failing anywhere.
describe('AssistantOptions greeting', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('renders the short greeting on a single line next to the assistant name', async () => {
        const tree = await renderOptions()

        // translate() is mocked to the identity, so this is the en source string.
        const greeting = tree.root.findAllByType(Text).find(node => node.props.children === 'How can I help?')

        expect(greeting).toBeTruthy()
        expect(greeting.props.numberOfLines).toBe(1)
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
            expect(translations['Templates'].length).toBeGreaterThan(0)
            expect(translations['All chats'].length).toBeGreaterThan(0)
        })
    })
})

/**
 * AT-2504 — "wenn ich über die assistant line was abschicke, sollte es sofort verschwinden und
 * dann im Hintergrund weiterlaufen".
 *
 * The whole complaint is about ORDER, so every assertion here is about what has already happened
 * at a point in time where `createBotQuickTopic` has NOT resolved yet. A test that only checks the
 * end state passes just as well against the old code, which cleared the composer too — several
 * hundred milliseconds and two round trips later.
 */
describe('AssistantOptions immediate clear (AT-2504)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        localStorage.clear()
        resetAssistantLinePendingSends()
    })

    const typeAndSend = async (tree, text) => {
        await act(async () => {
            tree.root.findByType(TextInput).props.onChangeText(text)
        })
        const sendButton = tree.root
            .findAllByType(TouchableOpacity)
            .find(node => node.props.accessibilityLabel === 'Send')
        return sendButton.props.onPress()
    }

    it('empties the composer before the topic call resolves, and finishes in the background', async () => {
        // Never resolved inside the assertion window: this is the "slow network" the user felt.
        let releaseTopic
        createBotQuickTopic.mockReturnValue(
            new Promise(resolve => {
                releaseTopic = resolve
            })
        )

        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions />)
        })

        let sendPromise
        await act(async () => {
            sendPromise = typeAndSend(tree, 'make this feel instant')
        })

        // The composer is already empty while the send is still in flight...
        expect(createBotQuickTopic).toHaveBeenCalledTimes(1)
        expect(mockInputClear).toHaveBeenCalledTimes(1)
        expect(tree.root.findByType(TextInput).props.value ?? '').toBe('')

        // ...and it is usable, not frozen. `disabledEdition` was what greyed it out for the whole
        // round trip.
        expect(tree.root.findByType(TextInput).props.disabledEdition).toBeFalsy()

        // ...while the Last comment slot has something to show for it.
        const pending = getPendingAssistantLineSend('selected-project')
        expect(pending).toMatchObject({
            status: PENDING_SEND_SENDING,
            text: 'make this feel instant',
            assistantName: 'Assistant',
        })

        await act(async () => {
            releaseTopic({ projectId: 'selected-project', chatId: 'chat-1', isPublicFor: ['all'] })
            await sendPromise
        })

        // Once the thread exists the wait is on the assistant, and the card says so.
        expect(getPendingAssistantLineSend('selected-project')).toMatchObject({
            status: PENDING_SEND_AWAITING_REPLY,
            chatId: 'chat-1',
        })
    })

    it('files the pending send under the same keys the real last-comment pointer uses', async () => {
        createBotQuickTopic.mockResolvedValue({ projectId: 'selected-project', chatId: 'chat-1' })

        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions />)
        })
        await act(async () => {
            await typeAndSend(tree, 'where does this show up')
        })

        // The conversation project's own line...
        expect(getPendingAssistantLineSend('selected-project')).toBeTruthy()
        // ...and the All-projects line, which is where the answer also lands.
        expect(getPendingAssistantLineSend('allProjects')).toBeTruthy()
        // ...but not a project this message has nothing to do with.
        expect(getPendingAssistantLineSend('default-project')).toBeNull()
    })

    it.each(['completed', 'failed', 'cancelled', 'skipped'])(
        'clears the pending wait when the backend run is %s',
        async status => {
            createBotQuickTopic.mockResolvedValue({ projectId: 'selected-project', chatId: 'chat-1' })
            let tree
            await act(async () => {
                tree = renderer.create(<AssistantOptions />)
            })
            await act(async () => {
                await typeAndSend(tree, 'one assistant request')
            })

            expect(getPendingAssistantLineSend('selected-project')).toMatchObject({
                status: PENDING_SEND_AWAITING_REPLY,
            })
            act(() => createBotQuickTopic.mock.calls[0][2].onAssistantRunSettled({ status }))
            expect(getPendingAssistantLineSend('selected-project')).toBeNull()
        }
    )

    it('accepts a second message while the first is still being created', async () => {
        let releaseFirst
        createBotQuickTopic
            .mockReturnValueOnce(
                new Promise(resolve => {
                    releaseFirst = resolve
                })
            )
            .mockResolvedValue({ projectId: 'selected-project', chatId: 'chat-2' })

        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions />)
        })

        let firstSend
        await act(async () => {
            firstSend = typeAndSend(tree, 'first message')
        })
        await act(async () => {
            await typeAndSend(tree, 'second message')
        })

        // The old composer refused this outright — `isSendingRef` stayed true until the first
        // topic existed, so the second message was silently dropped.
        expect(createBotQuickTopic).toHaveBeenCalledTimes(2)
        expect(createBotQuickTopic).toHaveBeenNthCalledWith(2, expect.anything(), 'second message', expect.anything())

        await act(async () => {
            releaseFirst({ projectId: 'selected-project', chatId: 'chat-1' })
            await firstSend
        })
    })

    it('gives the text back when the send fails, and says why', async () => {
        createBotQuickTopic.mockRejectedValue(new Error('offline'))
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions />)
        })
        await act(async () => {
            await typeAndSend(tree, 'this one fails')
        })

        // The rich editor is uncontrolled, so putting `message` back is not enough — the text has
        // to go back into Quill too.
        expect(mockInputClearAndSetContent).toHaveBeenCalledWith('this one fails')
        expect(getPendingAssistantLineSend('selected-project')).toMatchObject({ status: PENDING_SEND_FAILED })

        consoleError.mockRestore()
    })

    it('gives the text back when no project could be resolved to write into', async () => {
        createBotQuickTopic.mockResolvedValue(undefined)

        let tree
        await act(async () => {
            tree = renderer.create(<AssistantOptions />)
        })
        await act(async () => {
            await typeAndSend(tree, 'nowhere to put this')
        })

        expect(mockInputClearAndSetContent).toHaveBeenCalledWith('nowhere to put this')
        expect(getPendingAssistantLineSend('selected-project')).toMatchObject({ status: PENDING_SEND_FAILED })
    })

    it('does not register a pending send, or clear the composer, when the user is out of gold', async () => {
        mockState.loggedUser.gold = 0
        try {
            let tree
            await act(async () => {
                tree = renderer.create(<AssistantOptions />)
            })
            await act(async () => {
                await typeAndSend(tree, 'no gold left')
            })

            expect(createBotQuickTopic).not.toHaveBeenCalled()
            expect(mockInputClear).not.toHaveBeenCalled()
            expect(getPendingAssistantLineSend('selected-project')).toBeNull()
        } finally {
            mockState.loggedUser.gold = 100
        }
    })
})
