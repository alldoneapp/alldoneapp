/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ChatItemUnreadMessages, {
    CHAT_ITEM_UNREAD_PREVIEW_LIMIT,
    resolvePreviewServerTime,
    splitUnreadMessagesForPreview,
} from './ChatItemUnreadMessages'
import useGetUnreadChatMessages from '../../hooks/Chats/useGetUnreadChatMessages'
import { markChatMessagesAsRead } from '../../utils/backends/Chats/chatsComments'
import { onOpenChat } from './Utils/ChatHelper'

jest.mock('../../hooks/Chats/useGetUnreadChatMessages', () => jest.fn())

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))

jest.mock('../../utils/SharedHelper', () => ({ accessGranted: () => mockAccessGranted }))

jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))

jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    markChatMessagesAsRead: jest.fn(),
    markMessagesAsRead: jest.fn(),
}))

jest.mock('../../i18n/TranslationService', () => ({
    translate: (key, interpolations = {}) =>
        Object.keys(interpolations).reduce(
            (text, name) => text.replace(`%{${name}}`, interpolations[name]),
            key === 'Amount earlier unread messages' ? '%{amount} earlier unread messages' : key
        ),
}))

// ChatHelper reaches the redux store and NavigationService on import; the only thing used here is
// its timestamp coercion, which is the identity for the plain millisecond numbers these tests use.
jest.mock('./Utils/ChatHelper', () => ({
    getTimestampInMilliseconds: timestamp => (typeof timestamp === 'number' ? timestamp : undefined),
    onOpenChat: jest.fn(),
}))

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { caption2: {} },
    colors: { Text03: '#000000', Gray300: '#cccccc', Primary100: '#007FFF' },
}))

// The preview's message renderer pulls in the whole thread rendering stack (quill-adjacent
// parsers, tags, redux-connected presentation data). This suite is about *which* messages the
// preview shows, in what order, and what each row is handed; the row itself is stubbed down to
// its identity, and its email props are recorded for the email tests below. What the row does
// with them is covered by ChatItemUnreadMessage.email.test.js.
jest.mock('./ChatItemUnreadMessage', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return props => {
        mockRowProps.push(props)
        return <Text>{`${props.message.id}:${props.message.commentText}`}</Text>
    }
})

const project = { id: 'project-1' }
const chat = { id: 'chat-1', type: 'topics' }

let mockState = { loggedUser: { uid: 'user-1' }, projectChatNotifications: {} }
let mockAccessGranted = true
const mockRowProps = []

const setNotifications = chatNotifications => {
    mockState = {
        loggedUser: { uid: 'user-1' },
        projectChatNotifications: { [project.id]: { [chat.id]: chatNotifications } },
    }
}

const makeMessages = amount =>
    Array.from({ length: amount }, (unused, index) => ({
        id: `c${index + 1}`,
        commentText: `message ${index + 1}`,
        creatorId: 'user-1',
    }))

const renderPreview = (messages, unreadCommentIds) => {
    useGetUnreadChatMessages.mockReturnValue({ messages, loaded: true })
    let tree
    act(() => {
        tree = renderer.create(
            <ChatItemUnreadMessages project={project} chat={chat} unreadCommentIds={unreadCommentIds} />
        )
    })
    return tree
}

const renderedTexts = tree => tree.root.findAllByType(Text).map(node => node.props.children)

describe('ChatItemUnreadMessages', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRowProps.length = 0
        mockAccessGranted = true
        setNotifications(undefined)
    })

    it('renders every unread message in thread order', () => {
        const tree = renderPreview(makeMessages(3), ['c1', 'c2', 'c3'])

        expect(renderedTexts(tree)).toEqual(['c1:message 1', 'c2:message 2', 'c3:message 3'])
    })

    it('subscribes to the chat with the unread comment ids it was given', () => {
        renderPreview(makeMessages(2), ['c1', 'c2'])

        expect(useGetUnreadChatMessages).toHaveBeenCalledWith('project-1', 'chat-1', 'topics', ['c1', 'c2'])
    })

    it('never marks the chat as read just because it previewed it', () => {
        renderPreview(makeMessages(3), ['c1', 'c2', 'c3'])

        // Opening the topic (ChatBoard) and "Mark as read" stay the only things that clear
        // notifications; a preview that cleared them would delete the unread state it renders.
        expect(markChatMessagesAsRead).not.toHaveBeenCalled()
    })

    it('shows the newest messages and counts the rest when a topic has many unread', () => {
        const amount = CHAT_ITEM_UNREAD_PREVIEW_LIMIT + 3
        const tree = renderPreview(
            makeMessages(amount),
            makeMessages(amount).map(message => message.id)
        )

        const texts = renderedTexts(tree)
        expect(texts[0]).toBe('3 earlier unread messages')
        expect(texts.slice(1)).toEqual(['c4:message 4', 'c5:message 5', 'c6:message 6', 'c7:message 7', 'c8:message 8'])
    })

    it('opens the topic from the earlier-unread line, the only way to reach what the cap hid', () => {
        const amount = CHAT_ITEM_UNREAD_PREVIEW_LIMIT + 3
        const tree = renderPreview(
            makeMessages(amount),
            makeMessages(amount).map(message => message.id)
        )

        act(() => {
            tree.root.findByType(TouchableOpacity).props.onPress()
        })

        expect(onOpenChat).toHaveBeenCalledWith('project-1', chat)
    })

    it('offers no earlier-unread link when nothing was capped away', () => {
        const tree = renderPreview(makeMessages(2), ['c1', 'c2'])

        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(0)
    })

    it('renders nothing while the messages have not arrived yet', () => {
        const tree = renderPreview([], ['c1'])

        expect(tree.toJSON()).toBeNull()
    })
})

describe('ChatItemUnreadMessages email actions', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRowProps.length = 0
        mockAccessGranted = true
        setNotifications(undefined)
    })

    it('hands every previewed message the project membership gate the thread applies', () => {
        renderPreview(makeMessages(2), ['c1', 'c2'])
        expect(mockRowProps.map(props => props.accessGranted)).toEqual([true, true])

        mockAccessGranted = false
        mockRowProps.length = 0
        renderPreview(makeMessages(2), ['c1', 'c2'])
        expect(mockRowProps.map(props => props.accessGranted)).toEqual([false, false])
    })

    it('marks exactly the emails the notification docs call new', () => {
        // Same source the thread reads (informational emails arrive as unfollowed notifications),
        // read live rather than captured: previewing clears nothing, so there is nothing to lose.
        setNotifications({ unfollowedCommentIds: ['c2'] })
        renderPreview(makeMessages(3), ['c1', 'c2', 'c3'])

        expect(mockRowProps.map(props => `${props.message.id}:${props.linkedEmailNew}`)).toEqual([
            'c1:false',
            'c2:true',
            'c3:false',
        ])
    })

    it('shares one archive state across the whole preview, as the thread does', () => {
        renderPreview(makeMessages(3), ['c1', 'c2', 'c3'])

        const handlers = new Set(mockRowProps.map(props => props.onArchiveLinkedEmail))
        const archivingProbes = new Set(mockRowProps.map(props => props.isArchivingEmail))
        expect(handlers.size).toBe(1)
        expect(archivingProbes.size).toBe(1)
        expect(typeof [...handlers][0]).toBe('function')
    })

    it('tolerates a chat with no notification doc at all', () => {
        setNotifications(undefined)
        renderPreview(makeMessages(1), ['c1'])

        expect(mockRowProps.map(props => props.linkedEmailNew)).toEqual([false])
    })
})

describe('splitUnreadMessagesForPreview', () => {
    it('keeps everything when the list fits', () => {
        const messages = makeMessages(3)
        expect(splitUnreadMessagesForPreview(messages, 5)).toEqual({ hiddenCount: 0, visibleMessages: messages })
    })

    it('keeps the tail of the thread, not its head', () => {
        const result = splitUnreadMessagesForPreview(makeMessages(6), 2)
        expect(result.hiddenCount).toBe(4)
        expect(result.visibleMessages.map(message => message.id)).toEqual(['c5', 'c6'])
    })

    it('shows everything when the limit is disabled', () => {
        const messages = makeMessages(20)
        expect(splitUnreadMessagesForPreview(messages, Infinity)).toEqual({ hiddenCount: 0, visibleMessages: messages })
    })

    it('tolerates a missing message list', () => {
        expect(splitUnreadMessagesForPreview(undefined)).toEqual({ hiddenCount: 0, visibleMessages: [] })
    })
})

describe('resolvePreviewServerTime', () => {
    it('uses the local clock when it is already ahead of every message', () => {
        expect(resolvePreviewServerTime([{ lastChangeDate: 1000 }], 5000)).toBe(5000)
    })

    it('never hands MessageItemHeader a clock behind the message it labels', () => {
        // parseLastEdited renders nothing at all unless serverTime > lastEdition, so a client
        // running behind the server would otherwise show a message with a blank timestamp.
        expect(resolvePreviewServerTime([{ lastChangeDate: 9000 }], 5000)).toBe(10000)
    })

    it('ignores messages with an unusable timestamp', () => {
        expect(resolvePreviewServerTime([{ lastChangeDate: null }, {}], 5000)).toBe(5000)
    })

    it('tolerates an empty list', () => {
        expect(resolvePreviewServerTime([], 5000)).toBe(5000)
        expect(resolvePreviewServerTime(undefined, 5000)).toBe(5000)
    })
})
