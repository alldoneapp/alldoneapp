/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ChatItem from './ChatItem'
import ArchiveUnreadEmailsButton from './ArchiveUnreadEmailsButton'
import { UnreadEmailArchiveProvider } from './unreadEmailArchiveContext'
import useGetUnreadChatMessages from '../../hooks/Chats/useGetUnreadChatMessages'
import { performEmailLineAction } from '../../utils/backends/EmailLine/emailLineBackend'
import { markChatMessagesAsRead } from '../../utils/backends/Chats/chatsComments'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

jest.mock('../../hooks/Chats/useGetUnreadChatMessages', () => jest.fn())
jest.mock('../../utils/SharedHelper', () => ({ accessGranted: () => mockAccessGranted }))
jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    markChatMessagesAsRead: jest.fn(),
    markMessagesAsRead: jest.fn(),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

// The previewed message renderer pulls in the whole thread rendering stack. This suite is about
// what the previews *publish* to the header buttons, so the row is stubbed down to a recorder of
// the email props it is handed (which is also how the shared archive state is observed).
jest.mock('./ChatItemUnreadMessage', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return props => {
        mockRowProps.push(props)
        return <Text>{`${props.projectId}:${props.message.id}`}</Text>
    }
})

// ChatItem's own presentation stack, none of which this suite is about.
jest.mock('./ChatItemLastComment', () => () => null)
jest.mock('../UIControls/SocialText/SocialText', () => () => null)
jest.mock('./ChatHeaderItem', () => () => null)
jest.mock('./ChatIndicator', () => () => null)
jest.mock('../Tags/ObjectNoteTag', () => () => null)
jest.mock('../../assets/svg/SVGGenericUser', () => () => null)
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('./Utils/ChatHelper', () => ({
    getChatIcon: () => 'chat',
    onOpenChat: jest.fn(),
    getTimestampInMilliseconds: timestamp => (typeof timestamp === 'number' ? timestamp : undefined),
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ getUserPresentationData: () => ({}) }))
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: () => ({ displayName: 'User', photoURL: null }),
}))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

let mockAccessGranted = true
const mockRowProps = []

const project = (id, index) => ({ id, index })
const chatOf = id => ({
    id,
    title: `Daily emails ${id}`,
    lastEditionDate: 1786000000000,
    type: 'topics',
    stickyData: { days: 0 },
    members: [],
    hasStar: '#FFFFFF',
})

const emailMessage = (id, connectionProjectId, messageId) => ({
    id,
    commentText: `Email from someone: ${messageId}`,
    creatorId: 'assistant-1',
    lastChangeDate: 1786000000000,
    gmailData: { messageId, connectionId: connectionProjectId, webUrl: `https://mail.google.com/${messageId}` },
})

// A Gmail informational email writes an *unfollowed* (grey) chat notification while still adding
// the user to the chat's usersFollowing - so the topic is listed on the Followed tab, and this is
// exactly the notification shape that used to preview nothing there (AT-2256 follow-up).
const unfollowedEmailNotifications = commentIds => ({
    totalFollowed: 0,
    totalUnfollowed: commentIds.length,
    followedNotifications: [],
    unfollowedNotifications: commentIds.map((commentId, index) => ({ commentId, date: 100 + index })),
    unfollowedCommentIds: commentIds,
    followedCommentIds: [],
})

/**
 * Renders what the chat list renders in All Projects: the shared registry, one row per project,
 * and both header buttons - the project line's ("Archive emails", scoped to one project) and the
 * All Projects line's ("Archive all emails", spanning every project).
 */
const renderChatList = ({ chatsActiveTab, rows }) => {
    const state = {
        loggedUser: { uid: 'user-1' },
        isLoadingData: 0,
        showFloatPopup: false,
        chatsActiveTab,
        projectChatNotifications: rows.reduce(
            (notifications, row) => ({
                ...notifications,
                [row.projectId]: {
                    ...(notifications[row.projectId] || {}),
                    [row.chatId]: unfollowedEmailNotifications(row.messages.map(message => message.id)),
                },
            }),
            {}
        ),
    }
    useSelector.mockImplementation(selector => selector(state))
    useGetUnreadChatMessages.mockImplementation((projectId, chatId) => {
        const row = rows.find(candidate => candidate.projectId === projectId && candidate.chatId === chatId)
        return { messages: row ? row.messages : [], loaded: true }
    })

    let tree
    act(() => {
        tree = renderer.create(
            <UnreadEmailArchiveProvider>
                {rows.map(row => (
                    <ChatItem
                        key={`${row.projectId}:${row.chatId}`}
                        project={project(row.projectId, 0)}
                        chat={chatOf(row.chatId)}
                        openEditModal={jest.fn()}
                    />
                ))}
                <ArchiveUnreadEmailsButton projectId="project-1" />
                <ArchiveUnreadEmailsButton />
            </UnreadEmailArchiveProvider>
        )
    })
    return tree
}

// The icon renders a glyph from a private-use code point through a <Text> of its own, and the
// stubbed rows render their own ids; only the buttons' readable labels are interesting here.
const buttonLabels = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .filter(
            text => typeof text === 'string' && /^(Archive emails|Archive all emails|Archived|try again)$/.test(text)
        )

// The label is also the accessibility label, and it keeps naming the action while the button
// reports "Archived", so it identifies the same button before and after the press.
const buttonWithLabel = (tree, label) =>
    tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)

const archiveCalls = () =>
    performEmailLineAction.mock.calls.map(([connectionProjectId, payload]) => [connectionProjectId, payload])

const oneEmailInOneProject = [
    { projectId: 'project-1', chatId: 'chat-1', messages: [emailMessage('c1', 'conn-a', 'm1')] },
]

describe('bulk email archive on the Followed tab (AT-2256 follow-up)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRowProps.length = 0
        mockAccessGranted = true
        performEmailLineAction.mockResolvedValue(undefined)
    })

    it('offers "Archive emails" on the project line', () => {
        // The bug: the Followed tab previewed no unfollowed message, so the previews published no
        // email and both header buttons rendered null - while the All tab, over the very same
        // topic, showed them.
        const tree = renderChatList({ chatsActiveTab: FOLLOWED_TAB, rows: oneEmailInOneProject })

        expect(buttonLabels(tree)).toEqual(['Archive emails', 'Archive all emails'])
    })

    it('renders exactly what the All tab renders for the same topic', () => {
        const followed = renderChatList({ chatsActiveTab: FOLLOWED_TAB, rows: oneEmailInOneProject })
        const all = renderChatList({ chatsActiveTab: ALL_TAB, rows: oneEmailInOneProject })

        expect(buttonLabels(followed)).toEqual(buttonLabels(all))
    })

    it('archives the previewed email through the same call the thread uses', async () => {
        const tree = renderChatList({ chatsActiveTab: FOLLOWED_TAB, rows: oneEmailInOneProject })

        await act(async () => {
            await buttonWithLabel(tree, 'Archive emails').props.onPress()
        })

        expect(archiveCalls()).toEqual([['conn-a', { action: 'archive', messageIds: ['m1'] }]])
    })

    it('archives every project from the All Projects line, each email exactly once', async () => {
        // The same email previewed by two topics in two projects: the registry deduplicates on the
        // linked email key, so the All Projects button must not send it twice.
        const tree = renderChatList({
            chatsActiveTab: FOLLOWED_TAB,
            rows: [
                { projectId: 'project-1', chatId: 'chat-1', messages: [emailMessage('c1', 'conn-a', 'm1')] },
                {
                    projectId: 'project-2',
                    chatId: 'chat-2',
                    messages: [emailMessage('c2', 'conn-a', 'm1'), emailMessage('c3', 'conn-b', 'm2')],
                },
            ],
        })

        await act(async () => {
            await buttonWithLabel(tree, 'Archive all emails').props.onPress()
        })

        expect(archiveCalls().sort()).toEqual(
            [
                ['conn-a', { action: 'archive', messageIds: ['m1'] }],
                ['conn-b', { action: 'archive', messageIds: ['m2'] }],
            ].sort()
        )
    })

    it('scopes the project line to its own project', async () => {
        const tree = renderChatList({
            chatsActiveTab: FOLLOWED_TAB,
            rows: [
                { projectId: 'project-1', chatId: 'chat-1', messages: [emailMessage('c1', 'conn-a', 'm1')] },
                { projectId: 'project-2', chatId: 'chat-2', messages: [emailMessage('c2', 'conn-b', 'm2')] },
            ],
        })

        await act(async () => {
            await buttonWithLabel(tree, 'Archive emails').props.onPress()
        })

        expect(archiveCalls()).toEqual([['conn-a', { action: 'archive', messageIds: ['m1'] }]])
    })

    it('shares its archive state with the per-message buttons', async () => {
        const tree = renderChatList({ chatsActiveTab: FOLLOWED_TAB, rows: oneEmailInOneProject })

        expect(mockRowProps[mockRowProps.length - 1].isArchivedEmail('conn-a:m1')).toBe(false)

        await act(async () => {
            await buttonWithLabel(tree, 'Archive emails').props.onPress()
        })

        // The row's own "Archive email" button flips to "Archived" without a second call, and the
        // bulk button reports the same completed state.
        expect(mockRowProps[mockRowProps.length - 1].isArchivedEmail('conn-a:m1')).toBe(true)
        expect(buttonLabels(tree)).toEqual(['Archived', 'Archived'])
    })

    it('marks nothing as read', async () => {
        const tree = renderChatList({ chatsActiveTab: FOLLOWED_TAB, rows: oneEmailInOneProject })

        await act(async () => {
            await buttonWithLabel(tree, 'Archive emails').props.onPress()
        })

        // Archiving is a mailbox action. The unread notifications the preview renders from are
        // cleared only by opening the topic or by "Mark as read", on either tab.
        expect(markChatMessagesAsRead).not.toHaveBeenCalled()
    })

    it('stays hidden for a viewer who is not a project member', () => {
        mockAccessGranted = false

        const tree = renderChatList({ chatsActiveTab: FOLLOWED_TAB, rows: oneEmailInOneProject })

        // Same gate as everywhere else: a preview publishes its emails only for a project member,
        // so a non-member's scope is empty and neither button exists to be pressed.
        expect(buttonLabels(tree)).toEqual([])
    })

    it('stays hidden when the Followed tab previews messages that carry no email', () => {
        const tree = renderChatList({
            chatsActiveTab: FOLLOWED_TAB,
            rows: [
                {
                    projectId: 'project-1',
                    chatId: 'chat-1',
                    messages: [{ id: 'c1', commentText: 'just a message', creatorId: 'user-2' }],
                },
            ],
        })

        expect(buttonLabels(tree)).toEqual([])
    })
})
