/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Keyboard } from 'react-native'

import ChatInput from './ChatInput'
import { createObjectMessage } from '../../../../utils/backends/Chats/chatsComments'

const mockInputFocus = jest.fn()
const mockInputBlur = jest.fn()
const mockKeyboardDismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn())

const mockState = {
    openModals: {},
    quotedNoteText: '',
    quotedText: null,
    loggedUser: { uid: 'user-1', gold: 100 },
    disableAutoFocusInChat: false,
    assistantEnabled: true,
    assistantEnabledScope: null,
    triggerChatSubmit: null,
    triggerChatDraft: null,
}

jest.mock('react-redux', () => ({
    shallowEqual: jest.fn(),
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {},
}))

jest.mock('react-quill-new', () => ({
    Quill: {
        import: () =>
            function Delta() {
                this.insert = jest.fn(() => this)
            },
    },
}))

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    const { TextInput } = require('react-native')

    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({
            blur: mockInputBlur,
            clear: jest.fn(),
            focus: mockInputFocus,
            getEditorId: jest.fn(() => 'editor-1'),
            isFocused: jest.fn(() => false),
        }))
        return <TextInput testID="chat-input" {...props} />
    })
})

jest.mock('./ChatInputButtons', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="chat-input-buttons" {...props} />
})

jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    processPastedTextWithBreakLines: jest.fn(),
    TASK_THEME: 'TASK_THEME',
}))

jest.mock('../../../ModalsManager/modalsManager', () => ({
    MENTION_MODAL_ID: 'MENTION_MODAL_ID',
}))

jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    STAYWARD_COMMENT: 'STAYWARD_COMMENT',
    updateNewAttachmentsData: jest.fn((projectId, text) => Promise.resolve(text)),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../../../../utils/Levels', () => ({
    updateXpByCommentInChat: jest.fn(),
}))

jest.mock('../../../../utils/BackendBridge', () => ({
    getDb: jest.fn(),
}))

jest.mock('../../../Premium/PremiumHelper', () => ({
    checkIsLimitedByXp: jest.fn(() => false),
}))

jest.mock('../../../../redux/actions', () => ({
    setAssistantEnabled: jest.fn(value => ({ type: 'assistant', value })),
    setDisableAutoFocusInChat: jest.fn(),
    setMainChatEditor: jest.fn(),
    setQuotedNoteText: jest.fn(),
    setQuotedText: jest.fn(),
    setTriggerChatDraft: jest.fn(),
    setTriggerChatSubmit: jest.fn(),
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    CHAT_INPUT_LIMIT_IN_CHARACTERS: 10000,
}))

jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    resolveAssistantForProjectObject: (projectId, assistantId) => ({
        uid: assistantId || 'anna-assistant',
    }),
}))

jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    createObjectMessage: jest.fn(() => Promise.resolve()),
}))

jest.mock('../../../styles/global', () => ({
    colors: {
        Text03: '#000000',
        Grey200: '#000000',
        Grey100: '#000000',
        Gray300: '#000000',
    },
}))

describe('ChatInput assistant selection', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('binds the clicked assistant to the submitted message', async () => {
        const setAssistantId = jest.fn()
        let tree

        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics', isAssistantEnabled: true }}
                    projectId="project-1"
                    assistantId="project-assistant"
                    setAssistantId={setAssistantId}
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                />
            )
        })

        act(() => {
            tree.root.findByProps({ testID: 'chat-input' }).props.setAssistantId('anna-assistant')
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'chat-input-buttons' }).props.onSubmit('Hello Anna')
            await Promise.resolve()
        })

        expect(setAssistantId).toHaveBeenCalledWith('anna-assistant')
        expect(createObjectMessage).toHaveBeenCalledWith(
            'project-1',
            'chat-1',
            'Hello Anna',
            'topics',
            null,
            null,
            null,
            false,
            true,
            'anna-assistant'
        )

        tree.unmount()
    })

    it('binds the displayed default assistant when the stored assistant ID is empty', async () => {
        let tree

        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics', isAssistantEnabled: true }}
                    projectId="project-1"
                    assistantId=""
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                />
            )
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'chat-input-buttons' }).props.onSubmit('Hello Anna')
            await Promise.resolve()
        })

        expect(createObjectMessage).toHaveBeenCalledWith(
            'project-1',
            'chat-1',
            'Hello Anna',
            'topics',
            null,
            null,
            null,
            false,
            true,
            'anna-assistant'
        )

        tree.unmount()
    })
})

// AT-2084: `generateTaskFromPreConfig` / `createBotQuickTopic` with `skipNavigation: true` arm the
// global assistant-enabled flag for a chat the user is never taken to. Because ChatInput ORs that
// flag with the persisted state and passes the result to `createObjectMessage` as
// `explicitAssistantEnabled` — which OVERRIDES the object's own `isAssistantEnabled` — an unscoped
// leak fired a real, Gold-spending assistant run in an unrelated chat.
describe('ChatInput assistant-enabled scoping', () => {
    const submit = async chat => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={chat}
                    projectId="project-1"
                    assistantId="anna-assistant"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                />
            )
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'chat-input-buttons' }).props.onSubmit('Hello')
            await Promise.resolve()
        })

        const buttons = tree.root.findByProps({ testID: 'chat-input-buttons' }).props
        return { tree, buttons, explicitAssistantEnabled: createObjectMessage.mock.calls[0][8] }
    }

    beforeEach(() => {
        jest.clearAllMocks()
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = null
    })

    afterEach(() => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = null
    })

    it('does not trigger the assistant in a chat the flag was not armed for', async () => {
        mockState.assistantEnabledScope = { projectId: 'project-1', objectId: 'task-created-from-my-day' }

        const { tree, buttons, explicitAssistantEnabled } = await submit({
            id: 'chat-1',
            type: 'topics',
            isAssistantEnabled: false,
        })

        expect(explicitAssistantEnabled).toBe(false)
        expect(buttons.assistantEnabled).toBe(false)

        tree.unmount()
    })

    it('does not trigger the assistant when the flag belongs to another project', async () => {
        mockState.assistantEnabledScope = { projectId: 'other-project', objectId: 'chat-1' }

        const { tree, explicitAssistantEnabled } = await submit({
            id: 'chat-1',
            type: 'topics',
            isAssistantEnabled: false,
        })

        expect(explicitAssistantEnabled).toBe(false)

        tree.unmount()
    })

    // Preserved behavior: when the pre-config flow DOES navigate, the chat it armed the flag for
    // is exactly the one that mounts, and it must still come up with the assistant switched on.
    it('triggers the assistant in the chat the flag was armed for', async () => {
        mockState.assistantEnabledScope = { projectId: 'project-1', objectId: 'chat-1' }

        const { tree, buttons, explicitAssistantEnabled } = await submit({
            id: 'chat-1',
            type: 'topics',
            isAssistantEnabled: false,
        })

        expect(explicitAssistantEnabled).toBe(true)
        expect(buttons.assistantEnabled).toBe(true)

        tree.unmount()
    })

    // Preserved behavior: every in-chat writer (bot button, start chatting, …) dispatches without
    // a scope, meaning "the chat that is open right now".
    it('still honors an unscoped flag', async () => {
        mockState.assistantEnabledScope = null

        const { tree, explicitAssistantEnabled } = await submit({
            id: 'chat-1',
            type: 'topics',
            isAssistantEnabled: false,
        })

        expect(explicitAssistantEnabled).toBe(true)

        tree.unmount()
    })
})

describe('ChatInput auto focus', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        mockState.disableAutoFocusInChat = false
        mockState.quotedText = null
    })

    afterEach(() => {
        jest.runOnlyPendingTimers()
        jest.useRealTimers()
    })

    it('focuses the input when the thread was opened without unread comments', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                    autoFocus
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'chat-input' }).props.autoFocus).toBe(true)
        act(() => jest.runOnlyPendingTimers())
        expect(mockInputFocus).toHaveBeenCalled()
        expect(mockInputBlur).not.toHaveBeenCalled()

        tree.unmount()
    })

    it('keeps the input blurred when the thread was opened with unread comments', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                    autoFocus={false}
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'chat-input' }).props.autoFocus).toBe(false)
        act(() => jest.runOnlyPendingTimers())
        expect(mockInputBlur).toHaveBeenCalled()
        expect(mockKeyboardDismiss).toHaveBeenCalled()
        expect(mockInputFocus).not.toHaveBeenCalled()

        tree.unmount()
    })

    it('cancels pending focus when unread state arrives after mount', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                    autoFocus
                />
            )
        })

        await act(async () => {
            tree.update(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                    autoFocus={false}
                />
            )
        })

        act(() => jest.runOnlyPendingTimers())
        expect(mockInputBlur).toHaveBeenCalled()
        expect(mockInputFocus).not.toHaveBeenCalled()

        tree.unmount()
    })

    it('preserves the existing one-shot auto focus override', async () => {
        mockState.disableAutoFocusInChat = true
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'chat-input' }).props.autoFocus).toBe(false)
        act(() => jest.runOnlyPendingTimers())
        expect(mockInputBlur).toHaveBeenCalled()
        expect(mockInputFocus).not.toHaveBeenCalled()

        tree.unmount()
    })

    it('focuses an explicit reply even when open-time auto focus is disabled', async () => {
        mockState.quotedText = { text: 'Original message', userName: 'Karsten' }
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                    autoFocus={false}
                />
            )
        })

        act(() => jest.runOnlyPendingTimers())
        expect(mockInputFocus).toHaveBeenCalled()

        tree.unmount()
    })

    it('keeps message editing focused', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    editing
                    initialText="Existing message"
                    creatorId="user-1"
                    closeEditMode={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'chat-input' }).props.autoFocus).toBe(true)
        act(() => jest.runOnlyPendingTimers())
        expect(mockInputFocus).toHaveBeenCalled()

        tree.unmount()
    })
})

// AT-2355: the dictation mic was revealed by hover/focus only, so on touch it appeared only after
// the composer had already been tapped. The chat composer pins it on, like the assistant line.
describe('ChatInput dictation mic', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // `mockState` is module-level and the preceding describe leaves `disableAutoFocusInChat`
        // at `false`, so this block used to mount ChatInput with auto-focus ENABLED — which
        // schedules a real focus timeout on mount, because this describe (unlike the one above
        // it) never installs fake timers. The `not.toHaveBeenCalled()` below was therefore racing
        // that timeout rather than asserting anything: green on a fast machine, red on a loaded
        // CI runner, and reproducible on demand by allowing ~50ms of wall clock to pass before
        // the assertion. Auto-focus has to be OFF for "the mic is visible without focusing the
        // composer" to be what is actually measured.
        mockState.disableAutoFocusInChat = true
        mockState.quotedText = null
    })

    afterEach(() => {
        mockState.disableAutoFocusInChat = false
    })

    it('shows the mic without focusing or hovering the composer', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'chat-input' }).props.alwaysShowDictation).toBe(true)
        expect(mockInputFocus).not.toHaveBeenCalled()

        tree.unmount()
    })
})

/**
 * AT-2410 — push-to-talk in the chat composer.
 *
 * This composer already opted in (AT-2405), and the bug that gave AT-2410 its name lived in the
 * OTHER comment surface (the comment popup). Pinning it here anyway: `onDictationSubmit` is the
 * only thing standing between "held the mic" and "posted the comment" for a composer that owns its
 * Enter with a document listener, and it is one prop away from silently disappearing again.
 */
describe('ChatInput push-to-talk submit', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState.disableAutoFocusInChat = true
        mockState.quotedText = null
    })

    afterEach(() => {
        mockState.disableAutoFocusInChat = false
    })

    const renderComposer = async (props = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <ChatInput
                    chat={{ id: 'chat-1', type: 'topics' }}
                    projectId="project-1"
                    setWaitingForBotAnswer={jest.fn()}
                    setAmountOfNewCommentsToHighligth={jest.fn()}
                    {...props}
                />
            )
        })
        return tree
    }

    it('posts the dictated comment when the mic is released', async () => {
        const tree = await renderComposer()

        await act(async () => {
            tree.root.findByProps({ testID: 'chat-input' }).props.onDictationSubmit('draft plus transcript')
        })

        expect(createObjectMessage).toHaveBeenCalledWith(
            'project-1',
            'chat-1',
            'draft plus transcript',
            'topics',
            null,
            null,
            null,
            false,
            expect.anything(),
            expect.anything()
        )

        tree.unmount()
    })

    it('never posts an empty transcript as a new comment', async () => {
        const tree = await renderComposer()

        await act(async () => {
            tree.root.findByProps({ testID: 'chat-input' }).props.onDictationSubmit('')
        })

        expect(createObjectMessage).not.toHaveBeenCalled()

        tree.unmount()
    })

    it('stands down while an existing message is being edited', async () => {
        // `onSubmit` posts a NEW comment; editing has to go through `onEdit` instead, so the
        // composer deliberately hands down nothing here rather than the wrong action.
        const tree = await renderComposer({ editing: true, messageId: 'message-1', creatorId: 'user-1' })

        expect(tree.root.findByProps({ testID: 'chat-input' }).props.onDictationSubmit).toBeUndefined()

        tree.unmount()
    })
})
