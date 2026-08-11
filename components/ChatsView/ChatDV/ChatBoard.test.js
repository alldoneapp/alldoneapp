/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ChatBoard from './ChatBoard'
import { buildBotSpinnerTrigger } from '../Utils/botSpinnerTrigger'
import { buildAssistantEnabledScope } from '../Utils/assistantEnabledScope'

const PROJECT_ID = 'project-1'
const TASK_CHAT_ID = 'task-1'

const mockDispatch = jest.fn()
let mockState = {}
let mockMessages = []

jest.mock('react-redux', () => ({
    shallowEqual: jest.fn(),
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))

// `redux/actions` pulls the whole Firestore backend in, which cannot be loaded under Jest.
// The action shapes below mirror the real creators (which are covered in
// components/ChatsView/Utils/botSpinnerTrigger.test.js).
jest.mock('../../../redux/actions', () => ({
    setActiveChatData: (projectId, chatId, chatType) => ({ type: 'Set active chat data', projectId, chatId, chatType }),
    setActiveChatMessageId: activeChatMessageId => ({ type: 'Set active chat message id', activeChatMessageId }),
    setAssistantEnabled: (assistantEnabled, scope = null) => ({
        type: 'Set assistant enabled',
        assistantEnabled,
        assistantEnabledScope: assistantEnabled ? scope : null,
    }),
    setChatPagesAmount: chatPagesAmount => ({ type: 'Set chat pages amount', chatPagesAmount }),
    setTriggerBotSpinner: triggerBotSpinner => ({
        type: 'Set trigger bot spinner',
        triggerBotSpinner:
            triggerBotSpinner && typeof triggerBotSpinner === 'object' && triggerBotSpinner.chatId
                ? triggerBotSpinner
                : null,
    }),
}))
jest.mock('../../../URLSystem/Tasks/URLsTasks', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../URLSystem/Chats/URLsChats', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../URLSystem/People/URLsPeople', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../URLSystem/Goals/URLsGoals', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../URLSystem/Notes/URLsNotes', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../URLSystem/Skills/URLsSkills', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../URLSystem/Assistants/URLsAssistants', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Utils/ChatHelper', () => ({
    LIMIT_SHOW_EARLIER: 25,
    getTimestampInMilliseconds: timestamp => timestamp || null,
}))
jest.mock('../../../hooks/Chats/useGetMessages', () => () => mockMessages)
jest.mock('../../../utils/BackendBridge', () => ({
    getFirebaseTimestampDirectly: () => new Promise(() => {}),
}))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => false }))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: creatorId => (creatorId === 'assistant-1' ? { id: creatorId } : null),
}))
jest.mock('../../../utils/backends/Chats/chatsComments', () => ({
    getChatCommentsWithLinkedEmails: jest.fn(),
    markChatMessagesAsRead: jest.fn(),
}))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('./useNewEmailCommentIds', () => () => new Set())
jest.mock('./PagesAmountSubscriptionContainer', () => () => null)
jest.mock('./EditorView/ChatInput', () => () => null)
jest.mock('./EditorView/MessageItem', () => () => null)
jest.mock('../../UIControls/CustomScrollView', () => {
    const React = require('react')
    const { View } = require('react-native')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollToEnd: jest.fn(), scrollTo: jest.fn() }))
        return React.createElement(
            View,
            { testID: 'chat-scroll-view', showIndicator: props.showIndicator },
            props.children
        )
    })
})
jest.mock('./EditorView/BotMessagePlaceholder', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => React.createElement(Text, { testID: 'bot-message-placeholder' }, 'working')
})

const CHAT = { id: TASK_CHAT_ID, type: 'tasks' }

const renderChatBoard = () => {
    let tree
    act(() => {
        tree = renderer.create(
            <ChatBoard
                projectId={PROJECT_ID}
                chat={CHAT}
                parentObject={{ id: TASK_CHAT_ID, isAssistantEnabled: false }}
                assistantId="assistant-1"
                chatTitle="Task"
                members={[]}
                objectType="tasks"
            />
        )
    })
    return tree
}

const hasPlaceholder = tree => tree.root.findAll(node => node.props?.testID === 'bot-message-placeholder').length > 0

const consumeCalls = () =>
    mockDispatch.mock.calls.filter(
        ([action]) => action?.type === 'Set trigger bot spinner' && !action.triggerBotSpinner
    )

describe('ChatBoard bot spinner placeholder', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockMessages = []
        mockState = {
            triggerBotSpinner: null,
            loggedUser: { uid: 'user-1', isAnonymous: false },
            selectedNavItem: 'unrelated-tab',
            chatPagesAmount: 0,
            smallScreenNavigation: false,
            projectChatNotifications: { [PROJECT_ID]: { [TASK_CHAT_ID]: null } },
        }
    })

    it('does not show the placeholder when no assistant run was triggered', () => {
        expect(hasPlaceholder(renderChatBoard())).toBe(false)
    })

    // AT-2084: a quick topic / pre-config task started elsewhere (skipNavigation) used to leave a
    // global `true` behind, so the next task chat opened claimed the assistant was working while
    // no run existed for it — and it never answered.
    it('ignores a trigger that targets a different chat', () => {
        mockState.triggerBotSpinner = buildBotSpinnerTrigger(PROJECT_ID, 'some-other-topic')

        const tree = renderChatBoard()

        expect(hasPlaceholder(tree)).toBe(false)
        expect(consumeCalls()).toHaveLength(0)
    })

    it('ignores a legacy unscoped boolean trigger', () => {
        mockState.triggerBotSpinner = true

        expect(hasPlaceholder(renderChatBoard())).toBe(false)
    })

    it('ignores an expired trigger for this chat', () => {
        mockState.triggerBotSpinner = buildBotSpinnerTrigger(PROJECT_ID, TASK_CHAT_ID, Date.now() - 60 * 60 * 1000)

        expect(hasPlaceholder(renderChatBoard())).toBe(false)
    })

    it('shows the placeholder for its own chat and consumes the trigger so it cannot be replayed', () => {
        mockState.triggerBotSpinner = buildBotSpinnerTrigger(PROJECT_ID, TASK_CHAT_ID)

        const tree = renderChatBoard()

        expect(hasPlaceholder(tree)).toBe(true)
        expect(consumeCalls()).toHaveLength(1)
    })

    it('does not clear the trigger of another chat when unmounting', () => {
        mockState.triggerBotSpinner = buildBotSpinnerTrigger(PROJECT_ID, 'some-other-topic')

        const tree = renderChatBoard()
        act(() => {
            tree.unmount()
        })

        expect(consumeCalls()).toHaveLength(0)
    })
})

describe('ChatBoard mobile loading scrollbar', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockMessages = []
        mockState = {
            triggerBotSpinner: null,
            assistantEnabled: false,
            assistantEnabledScope: null,
            loggedUser: { uid: 'user-1', isAnonymous: false },
            selectedNavItem: 'unrelated-tab',
            chatPagesAmount: 0,
            smallScreenNavigation: true,
            projectChatNotifications: { [PROJECT_ID]: { [TASK_CHAT_ID]: null } },
        }
    })

    it('hides only the custom indicator while an assistant response loads on mobile', () => {
        mockMessages = [
            {
                id: 'assistant-loading',
                creatorId: 'assistant-1',
                commentText: '',
                isLoading: true,
                assistantRun: { kind: 'chat', status: 'running' },
            },
        ]

        const tree = renderChatBoard()

        expect(tree.root.findByProps({ testID: 'chat-scroll-view' }).props.showIndicator).toBe(false)
    })

    it('restores the custom indicator after the response appears', () => {
        mockMessages = [
            {
                id: 'assistant-done',
                creatorId: 'assistant-1',
                commentText: 'Finished response',
                isLoading: false,
                assistantRun: { kind: 'chat', status: 'completed' },
            },
        ]

        const tree = renderChatBoard()

        expect(tree.root.findByProps({ testID: 'chat-scroll-view' }).props.showIndicator).toBe(true)
    })

    it('keeps the indicator on desktop while the assistant loads', () => {
        mockState.smallScreenNavigation = false
        mockMessages = [
            {
                id: 'assistant-loading',
                creatorId: 'assistant-1',
                commentText: '',
                isLoading: true,
                assistantRun: { kind: 'chat', status: 'running' },
            },
        ]

        const tree = renderChatBoard()

        expect(tree.root.findByProps({ testID: 'chat-scroll-view' }).props.showIndicator).toBe(true)
    })
})

// AT-2084 (follow-up): ChatBoard is the component that owns the chat currently on screen, so it
// clears an assistant-enabled flag armed for a different chat. That protects every reader of the
// raw `state.assistantEnabled` — DV fullscreen, the "keep the comment popover open" checks —
// without each of them having to understand scopes.
describe('ChatBoard assistant-enabled scope guard', () => {
    const disableCalls = () =>
        mockDispatch.mock.calls.filter(
            ([action]) => action?.type === 'Set assistant enabled' && action.assistantEnabled === false
        )

    beforeEach(() => {
        mockDispatch.mockClear()
        mockState = {
            triggerBotSpinner: null,
            assistantEnabled: false,
            assistantEnabledScope: null,
            loggedUser: { uid: 'user-1', isAnonymous: false },
            selectedNavItem: 'unrelated-tab',
            chatPagesAmount: 0,
            smallScreenNavigation: false,
            projectChatNotifications: { [PROJECT_ID]: { [TASK_CHAT_ID]: null } },
        }
    })

    it('clears a flag armed for a different chat', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, 'task-created-from-my-day')

        renderChatBoard()

        expect(disableCalls()).toHaveLength(1)
    })

    it('clears a flag armed for a chat of another project', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope('other-project', TASK_CHAT_ID)

        renderChatBoard()

        expect(disableCalls()).toHaveLength(1)
    })

    // Preserved behavior: the pre-config flow that DOES navigate arms the flag for exactly this
    // chat, and it must survive the mount.
    it('keeps a flag armed for its own chat', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, TASK_CHAT_ID)

        renderChatBoard()

        expect(disableCalls()).toHaveLength(0)
    })

    // Preserved behavior: every in-chat writer dispatches unscoped, meaning "the open chat".
    it('keeps an unscoped flag', () => {
        mockState.assistantEnabled = true
        mockState.assistantEnabledScope = null

        renderChatBoard()

        expect(disableCalls()).toHaveLength(0)
    })

    it('does nothing while the assistant is globally off', () => {
        mockState.assistantEnabled = false
        mockState.assistantEnabledScope = buildAssistantEnabledScope(PROJECT_ID, 'some-other-topic')

        renderChatBoard()

        expect(disableCalls()).toHaveLength(0)
    })
})

describe('ChatBoard placeholder safety timeout', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockDispatch.mockClear()
        mockState = {
            triggerBotSpinner: buildBotSpinnerTrigger(PROJECT_ID, TASK_CHAT_ID),
            loggedUser: { uid: 'user-1', isAnonymous: false },
            selectedNavItem: 'unrelated-tab',
            chatPagesAmount: 0,
            smallScreenNavigation: false,
            projectChatNotifications: { [PROJECT_ID]: { [TASK_CHAT_ID]: null } },
        }
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('drops the placeholder when the answer never arrives', () => {
        const tree = renderChatBoard()
        expect(hasPlaceholder(tree)).toBe(true)

        act(() => {
            jest.advanceTimersByTime(5 * 60 * 1000 + 1)
        })

        expect(hasPlaceholder(tree)).toBe(false)
    })
})
