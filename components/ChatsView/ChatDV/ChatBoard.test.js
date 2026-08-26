/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ChatBoard from './ChatBoard'
import { buildBotSpinnerTrigger } from '../Utils/botSpinnerTrigger'
import { buildAssistantEnabledScope } from '../Utils/assistantEnabledScope'
import { CHAT_FULLSCREEN_COOLDOWN_MS } from '../Utils/chatScrollFullscreen'

const PROJECT_ID = 'project-1'
const TASK_CHAT_ID = 'task-1'

const mockDispatch = jest.fn()
let mockState = {}
let mockMessages = []
let mockAccessGranted = false

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
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => mockAccessGranted }))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: creatorId => (creatorId === 'assistant-1' ? { id: creatorId } : null),
}))
jest.mock('../../../utils/backends/Chats/chatsComments', () => ({
    getChatCommentsWithLinkedEmails: jest.fn(),
    markChatMessagesAsRead: jest.fn(),
}))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markAlldoneChatsReadForLinkedEmails: jest.fn(),
    markChatCommentsAsReadByMessageIds: jest.fn(),
}))
jest.mock('./useNewEmailCommentIds', () => () => new Set())
jest.mock('./PagesAmountSubscriptionContainer', () => () => null)
// The ghosts animate off an async AccessibilityInfo read, whose resolution lands outside act();
// they have their own coverage (AT-2382) and are not what these tests are about.
jest.mock('./MessagesSkeleton', () => () => null)
// AT-2439 - reaching the real `onMessageSent` is the point of the "sending re-arms the pin" test,
// so the mock has to surface the prop rather than render nothing.
jest.mock('./EditorView/ChatInput', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => React.createElement(View, { testID: 'chat-input', onMessageSent: props.onMessageSent })
})
jest.mock('./EditorView/MessageItem', () => () => null)
const mockScrollToEnd = jest.fn()
const mockScrollTo = jest.fn()
jest.mock('../../UIControls/CustomScrollView', () => {
    const React = require('react')
    const { View } = require('react-native')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ scrollToEnd: mockScrollToEnd, scrollTo: mockScrollTo }))
        return React.createElement(
            View,
            {
                testID: 'chat-scroll-view',
                showIndicator: props.showIndicator,
                onScroll: props.onScroll,
                // AT-2439 - the auto-scroll pin is driven by these two, not by onScroll, so the
                // mock has to hand them back for the tests to be about the real mechanism.
                onContentSizeChange: props.onContentSizeChange,
                scrollOnLayout: props.scrollOnLayout,
            },
            props.children,
            // The pill renders through `fixedChildren`, outside the scrolled content.
            props.fixedChildren
        )
    })
})
jest.mock('./EditorView/BotMessagePlaceholder', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => React.createElement(Text, { testID: 'bot-message-placeholder' }, 'working')
})

const CHAT = { id: TASK_CHAT_ID, type: 'tasks' }

const renderChatBoard = (props = {}) => {
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
                {...props}
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
// raw `state.assistantEnabled`, such as the "keep the comment popover open" checks, without each
// of them having to understand scopes.
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

// AT-2439 - "when I answer in the DV chat it should scroll down so I always see the reply without
// scrolling myself". Auto-scroll is a STATE ("is the reader parked at the newest message?") that
// every producer of height re-pins against, not an event fired when a message changes — see the
// header of components/ChatsView/Utils/chatAutoScroll.js for the four ways the event model failed.
// These tests drive the mechanism the app actually uses: the content-size and layout reports, not
// just the message-changed effect.
describe('ChatBoard auto-scroll to the newest message', () => {
    const VIEWPORT = 800
    const CONTENT = 4000
    const MAX_SCROLL = CONTENT - VIEWPORT

    const scrollView = tree => tree.root.findByProps({ testID: 'chat-scroll-view' })

    // The bottom MOVES as the thread grows, which is the whole reason the pin is derived from
    // geometry rather than remembered: a position that was the bottom one chunk ago is not.
    const bottomOf = (contentHeight = CONTENT) => contentHeight - VIEWPORT

    const scrollTo = (tree, scrollY, contentHeight = CONTENT) => {
        act(() => {
            scrollView(tree).props.onScroll({
                nativeEvent: {
                    contentOffset: { y: scrollY },
                    contentSize: { height: contentHeight },
                    layoutMeasurement: { height: VIEWPORT },
                },
            })
        })
    }

    // What a growing message actually reports: markdown/images settling, or a streamed chunk.
    const growContentTo = (tree, contentHeight) => {
        act(() => {
            scrollView(tree).props.onContentSizeChange(600, contentHeight)
        })
    }

    const relayout = tree => {
        act(() => {
            scrollView(tree).props.scrollOnLayout({ nativeEvent: { layout: { height: VIEWPORT } } })
        })
    }

    const sendMessage = tree => {
        act(() => {
            tree.root.findByProps({ testID: 'chat-input' }).props.onMessageSent()
        })
    }

    // `deep: false` matters: TouchableOpacity passes the label straight through to the host View it
    // renders, so a deep search counts one pill three times.
    const pill = tree =>
        tree.root.findAll(node => node.props?.accessibilityLabel === 'Jump to newest message', { deep: false })

    const pressPill = tree => {
        act(() => {
            pill(tree)[0].props.onPress()
        })
    }

    const lastScrollAnimated = () => {
        const call = mockScrollToEnd.mock.calls[mockScrollToEnd.mock.calls.length - 1]
        return !!(call && call[0] && call[0].animated)
    }

    const pressShowEarlier = tree => {
        act(() => {
            tree.root.findByProps({ expandText: 'show earlier' }).props.expand()
        })
    }

    beforeEach(() => {
        jest.useFakeTimers()
        mockDispatch.mockClear()
        mockScrollToEnd.mockClear()
        mockScrollTo.mockClear()
        mockAccessGranted = true
        mockMessages = [
            { id: 'm-1', creatorId: 'user-2', commentText: 'Older question' },
            { id: 'm-2', creatorId: 'assistant-1', commentText: 'Answer' },
        ]
        mockState = {
            triggerBotSpinner: null,
            assistantEnabled: false,
            assistantEnabledScope: null,
            loggedUser: { uid: 'user-1', isAnonymous: false },
            selectedNavItem: 'unrelated-tab',
            chatPagesAmount: 0,
            smallScreenNavigation: false,
            isMiddleScreen: false,
            projectChatNotifications: { [PROJECT_ID]: { [TASK_CHAT_ID]: null } },
        }
    })

    afterEach(() => {
        jest.useRealTimers()
        mockAccessGranted = false
    })

    it('lands on the newest message when the chat opens', () => {
        const tree = renderChatBoard()

        act(() => {
            jest.runOnlyPendingTimers()
        })

        expect(mockScrollToEnd).toHaveBeenCalled()
    })

    // The load-bearing one. A message's height is not final on the render that introduced it, so
    // the message-changed effect alone aims at the previous content height and stops short.
    it('follows content that grows after the message rendered', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL)
        mockScrollToEnd.mockClear()

        growContentTo(tree, CONTENT + 300)

        expect(mockScrollToEnd).toHaveBeenCalled()
    })

    it('keeps following a streamed answer through every growth step', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL)
        mockScrollToEnd.mockClear()

        growContentTo(tree, CONTENT + 120)
        growContentTo(tree, CONTENT + 260)
        growContentTo(tree, CONTENT + 410)

        expect(mockScrollToEnd).toHaveBeenCalledTimes(3)
    })

    it('leaves a reader who scrolled up to read older messages alone', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL / 2)
        mockScrollToEnd.mockClear()

        growContentTo(tree, CONTENT + 300)

        expect(mockScrollToEnd).not.toHaveBeenCalled()
    })

    // The one-way-flag bug: nudging the wheel once mid-answer used to stop the follow for the rest
    // of that answer, and coming back to the newest message by hand did NOT bring it back.
    it('resumes following once the reader returns to the newest message', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL / 2)
        growContentTo(tree, CONTENT + 100)
        expect(mockScrollToEnd).not.toHaveBeenCalled()

        scrollTo(tree, bottomOf(CONTENT + 100), CONTENT + 100)
        mockScrollToEnd.mockClear()
        growContentTo(tree, CONTENT + 400)

        expect(mockScrollToEnd).toHaveBeenCalled()
    })

    it('still counts as parked a few pixels short of the exact bottom', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL - 8)
        mockScrollToEnd.mockClear()

        growContentTo(tree, CONTENT + 300)

        expect(mockScrollToEnd).toHaveBeenCalled()
    })

    // React Native Web re-reports the content size on layout passes that resized nothing; acting
    // on those would fight a reader dragging at the very bottom of the thread.
    it('ignores a content-size report that changed nothing', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL)
        mockScrollToEnd.mockClear()

        growContentTo(tree, CONTENT)

        expect(mockScrollToEnd).not.toHaveBeenCalled()
    })

    // The mobile keyboard (KeyboardAvoidingView takes the height off this scroller) and a composer
    // growing to several lines push the newest message out of view without changing the content or
    // firing a scroll event.
    it('re-pins when the viewport shrinks under a parked reader', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL)
        mockScrollToEnd.mockClear()

        relayout(tree)

        expect(mockScrollToEnd).toHaveBeenCalled()
    })

    it('does not re-pin on layout while the reader is up in the thread', () => {
        const tree = renderChatBoard()
        scrollTo(tree, MAX_SCROLL / 2)
        mockScrollToEnd.mockClear()

        relayout(tree)

        expect(mockScrollToEnd).not.toHaveBeenCalled()
    })

    // A message arriving below the fold while the reader is up in the thread must not move them —
    // but it must not be invisible either, or there is no way to know there is anything to come
    // back to. Sending is the exception the user asked for explicitly: writing an answer yourself
    // always scrolls, from anywhere in the thread.
    describe('the "new message" pill', () => {
        const receiveMessage = (tree, message) => {
            mockMessages = [...mockMessages, message]
            act(() => {
                tree.update(
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
            act(() => {
                jest.runOnlyPendingTimers()
            })
        }

        const ANSWER = { id: 'm-3', creatorId: 'assistant-1', commentText: 'A fresh answer' }

        it('appears when an answer arrives while the reader is up in the thread', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL / 2)
            mockScrollToEnd.mockClear()

            receiveMessage(tree, ANSWER)

            expect(pill(tree)).toHaveLength(1)
            // and the reader was left exactly where they were
            expect(mockScrollToEnd).not.toHaveBeenCalled()
        })

        it('stays away while the reader is already at the newest message', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL)

            receiveMessage(tree, ANSWER)

            expect(pill(tree)).toHaveLength(0)
            expect(mockScrollToEnd).toHaveBeenCalled()
        })

        it('goes away when the reader scrolls back to the newest message themselves', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL / 2)
            receiveMessage(tree, ANSWER)
            expect(pill(tree)).toHaveLength(1)

            scrollTo(tree, MAX_SCROLL)

            expect(pill(tree)).toHaveLength(0)
        })

        it('returns to the newest message when pressed, and resumes following', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL / 2)
            receiveMessage(tree, ANSWER)
            mockScrollToEnd.mockClear()

            pressPill(tree)

            expect(mockScrollToEnd).toHaveBeenCalled()
            expect(lastScrollAnimated()).toBe(true)
            expect(pill(tree)).toHaveLength(0)

            // the pin is armed again, so the rest of the answer is followed
            mockScrollToEnd.mockClear()
            growContentTo(tree, CONTENT + 300)
            expect(mockScrollToEnd).toHaveBeenCalled()
        })

        // "wenn der Nutzer selber eine Antwort schreibt, sollte der Chat automatisch scrollen"
        it('never appears for a message the user sent themselves', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL / 2)

            sendMessage(tree)
            receiveMessage(tree, { id: 'm-3', creatorId: 'user-1', commentText: 'My own reply' })

            expect(pill(tree)).toHaveLength(0)
            expect(mockScrollToEnd).toHaveBeenCalled()
        })
    })

    // Smooth for the deliberate jumps the reader should be able to follow with their eyes; instant
    // for the automatic follow, because animating three to ten scrolls a second while an answer
    // streams would smear the text being read.
    describe('scroll style', () => {
        it('scrolls smoothly when the user sends a message', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL / 2)

            sendMessage(tree)

            expect(lastScrollAnimated()).toBe(true)
        })

        it('follows a streamed answer instantly', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL)
            mockScrollToEnd.mockClear()

            growContentTo(tree, CONTENT + 200)

            expect(lastScrollAnimated()).toBe(false)
        })

        // A smooth scroll reports a frame per step on the way down, none of them at the bottom yet.
        // Left unguarded they read as "the reader moved away" and switch the follow off during the
        // very scroll that was meant to arm it.
        it('does not let its own animation frames switch the follow off', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL / 2)
            sendMessage(tree)

            // mid-flight frames: heading down, not there yet
            scrollTo(tree, MAX_SCROLL - 900)
            scrollTo(tree, MAX_SCROLL - 400)
            mockScrollToEnd.mockClear()
            growContentTo(tree, CONTENT + 300)

            expect(mockScrollToEnd).toHaveBeenCalled()
        })

        // Browsers cancel a smooth scroll on wheel/touch input, so a frame that moved UP is the
        // reader taking over. Control must go back immediately, not after the grace runs out.
        it('hands control back the moment the reader scrolls up during it', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL)
            sendMessage(tree)

            scrollTo(tree, 1000)
            mockScrollToEnd.mockClear()
            growContentTo(tree, CONTENT + 300)

            expect(mockScrollToEnd).not.toHaveBeenCalled()
        })
    })

    describe('after opening older messages', () => {
        beforeEach(() => {
            mockState.chatPagesAmount = 3
        })

        // The arriving page is a round trip behind the press, so the pin has to stand down at the
        // press itself — otherwise that content re-pins to the bottom before any scroll event can
        // report where the reader went.
        it('does not yank the reader back down when the older page lands', () => {
            const tree = renderChatBoard()
            scrollTo(tree, MAX_SCROLL)
            pressShowEarlier(tree)
            mockScrollToEnd.mockClear()

            growContentTo(tree, CONTENT * 2)

            expect(mockScrollToEnd).not.toHaveBeenCalled()
        })

        // The reported bug: "show earlier" used to be a latch that killed auto-scroll for the rest
        // of the mount — so the reply the user then typed themselves never scrolled into view.
        it('follows again as soon as the user sends a message', () => {
            const tree = renderChatBoard()
            pressShowEarlier(tree)
            growContentTo(tree, CONTENT * 2)
            expect(mockScrollToEnd).not.toHaveBeenCalled()

            sendMessage(tree)
            expect(mockScrollToEnd).toHaveBeenCalled()

            mockScrollToEnd.mockClear()
            growContentTo(tree, CONTENT * 2 + 300)
            expect(mockScrollToEnd).toHaveBeenCalled()
        })

        it('follows again as soon as the reader scrolls back to the newest message', () => {
            const tree = renderChatBoard()
            pressShowEarlier(tree)
            mockScrollToEnd.mockClear()

            scrollTo(tree, MAX_SCROLL)
            growContentTo(tree, CONTENT + 300)

            expect(mockScrollToEnd).toHaveBeenCalled()
        })
    })
})

// Scrolling into the middle of a thread hands the DV chrome's space to the messages; resting at
// either edge — newest message or beginning of the thread — restores the normal layout. The
// trigger used to be `assistantEnabled` (removed in "Keep detail headers visible with
// assistants"); it is scroll position now, so the header only moves when the reader asks for it.
describe('ChatBoard scroll-driven fullscreen', () => {
    const VIEWPORT = 800
    const CONTENT = 4000
    const MAX_SCROLL = CONTENT - VIEWPORT

    let setFullscreen

    const scrollTo = (tree, scrollY) => {
        act(() => {
            tree.root.findByProps({ testID: 'chat-scroll-view' }).props.onScroll({
                nativeEvent: {
                    contentOffset: { y: scrollY },
                    contentSize: { height: CONTENT },
                    layoutMeasurement: { height: VIEWPORT },
                },
            })
        })
    }

    beforeEach(() => {
        jest.useFakeTimers()
        mockDispatch.mockClear()
        mockScrollToEnd.mockClear()
        mockScrollTo.mockClear()
        mockMessages = []
        setFullscreen = jest.fn()
        mockState = {
            triggerBotSpinner: null,
            assistantEnabled: false,
            assistantEnabledScope: null,
            loggedUser: { uid: 'user-1', isAnonymous: false },
            selectedNavItem: 'unrelated-tab',
            chatPagesAmount: 0,
            smallScreenNavigation: false,
            isMiddleScreen: false,
            projectChatNotifications: { [PROJECT_ID]: { [TASK_CHAT_ID]: null } },
        }
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('expands when the reader scrolls away from both edges', () => {
        const tree = renderChatBoard({ setFullscreen })

        scrollTo(tree, MAX_SCROLL / 2)

        expect(setFullscreen).toHaveBeenCalledWith(true)
    })

    it('stays normal while the newest message is on screen', () => {
        const tree = renderChatBoard({ setFullscreen })

        scrollTo(tree, MAX_SCROLL)

        expect(setFullscreen).not.toHaveBeenCalled()
    })

    it('collapses back at the bottom and re-anchors to the newest message', () => {
        const tree = renderChatBoard({ setFullscreen, isFullscreen: true })

        scrollTo(tree, MAX_SCROLL)

        expect(setFullscreen).toHaveBeenCalledWith(false)
        act(() => {
            jest.runOnlyPendingTimers()
        })
        expect(mockScrollToEnd).toHaveBeenCalled()
    })

    it('collapses back at the top and re-anchors to the beginning of the thread', () => {
        const tree = renderChatBoard({ setFullscreen, isFullscreen: true })

        scrollTo(tree, 0)

        expect(setFullscreen).toHaveBeenCalledWith(false)
        act(() => {
            jest.runOnlyPendingTimers()
        })
        expect(mockScrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false })
    })

    // A layout change re-fires onScroll, so a switch must not be able to chase its own
    // consequences within the cooldown.
    it('does not switch twice in a row while the cooldown holds', () => {
        const tree = renderChatBoard({ setFullscreen })

        scrollTo(tree, MAX_SCROLL / 2)
        scrollTo(tree, MAX_SCROLL)

        expect(setFullscreen).toHaveBeenCalledTimes(1)
        expect(setFullscreen).toHaveBeenCalledWith(true)
    })

    it('leaves the layout alone in a DV that does not opt in', () => {
        const tree = renderChatBoard()

        expect(() => scrollTo(tree, MAX_SCROLL / 2)).not.toThrow()
    })

    // Pressing the bot line's X leaves the reader on the position that expanded the layout, so
    // reopening it on their next wheel tick would fight the close they just asked for.
    it('does not reopen after the DV collapses the layout until an edge is reached', () => {
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
                    isFullscreen={true}
                    setFullscreen={setFullscreen}
                />
            )
        })

        // The DV collapses on its own (bot line close button), reader still mid-thread.
        act(() => {
            tree.update(
                <ChatBoard
                    projectId={PROJECT_ID}
                    chat={CHAT}
                    parentObject={{ id: TASK_CHAT_ID, isAssistantEnabled: false }}
                    assistantId="assistant-1"
                    chatTitle="Task"
                    members={[]}
                    objectType="tasks"
                    isFullscreen={false}
                    setFullscreen={setFullscreen}
                />
            )
        })
        setFullscreen.mockClear()

        scrollTo(tree, MAX_SCROLL / 2)
        expect(setFullscreen).not.toHaveBeenCalled()

        // Returning to the newest message arms it again.
        scrollTo(tree, MAX_SCROLL)
        act(() => {
            jest.advanceTimersByTime(CHAT_FULLSCREEN_COOLDOWN_MS)
        })
        scrollTo(tree, MAX_SCROLL / 2)
        expect(setFullscreen).toHaveBeenCalledWith(true)
    })

    // The expanded layout belongs to the chat tab: switching tabs must give the header and the
    // navigation bar back to whatever renders next.
    it('restores the normal layout when the chat unmounts', () => {
        const tree = renderChatBoard({ setFullscreen, isFullscreen: true })

        act(() => {
            tree.unmount()
        })

        expect(setFullscreen).toHaveBeenCalledWith(false)
    })
})
