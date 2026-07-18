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
    triggerChatSubmit: null,
    triggerChatDraft: null,
}

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))

jest.mock('@firebase/app', () => ({
    firebase: {},
}))

jest.mock('react-quill', () => ({
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
    getAssistantInProjectObject: (projectId, assistantId) => ({
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
