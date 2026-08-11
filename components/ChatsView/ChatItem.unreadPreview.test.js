/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ChatItem from './ChatItem'
import ChatItemUnreadMessages from './ChatItemUnreadMessages'
import ChatItemLastComment from './ChatItemLastComment'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

jest.mock('./ChatItemUnreadMessages', () => jest.fn(() => null))
jest.mock('./ChatItemLastComment', () => jest.fn(() => null))

jest.mock('../UIControls/SocialText/SocialText', () => () => null)
jest.mock('./ChatHeaderItem', () => () => null)
jest.mock('./ChatIndicator', () => () => null)
jest.mock('../Tags/ObjectNoteTag', () => () => null)
jest.mock('../Icon', () => () => null)
jest.mock('../../assets/svg/SVGGenericUser', () => () => null)
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('./Utils/ChatHelper', () => ({ getChatIcon: () => 'chat', onOpenChat: jest.fn() }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ getUserPresentationData: () => ({}) }))
jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: () => ({ displayName: 'User', photoURL: null }),
}))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

const PROJECT = { id: 'project-1', index: 0 }
const CHAT = {
    id: 'chat-1',
    title: 'A chat',
    lastEditionDate: 1786000000000,
    type: 'topics',
    stickyData: { days: 0 },
    commentsData: { lastComment: 'the newest one', lastCommentOwnerId: 'user-2' },
    hasStar: '#FFFFFF',
    members: [],
}

const UNREAD = {
    totalFollowed: 2,
    totalUnfollowed: 1,
    followedNotifications: [
        { commentId: 'f1', date: 100 },
        { commentId: 'f2', date: 300 },
    ],
    unfollowedNotifications: [{ commentId: 'u1', date: 200 }],
}

const READ = { totalFollowed: 0, totalUnfollowed: 0 }

const buildState = (chatNotifications, chatsActiveTab = ALL_TAB) => ({
    loggedUser: { uid: 'user-1' },
    isLoadingData: 0,
    showFloatPopup: false,
    chatsActiveTab,
    projectChatNotifications: { 'project-1': { 'chat-1': chatNotifications } },
})

const renderChatItem = (state, props = {}) => {
    useSelector.mockImplementation(selector => selector(state))
    act(() => {
        renderer.create(<ChatItem chat={CHAT} project={PROJECT} openEditModal={jest.fn()} {...props} />)
    })
}

const previewProps = () => ChatItemUnreadMessages.mock.calls[0][0]

describe('ChatItem unread message preview (AT-2256)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('previews the unread messages of a topic that has some', () => {
        renderChatItem(buildState(UNREAD))

        expect(ChatItemUnreadMessages).toHaveBeenCalled()
        expect(previewProps()).toEqual(
            expect.objectContaining({
                project: PROJECT,
                chat: CHAT,
                // Oldest first, so the preview reads in the same direction as the thread.
                unreadCommentIds: ['f1', 'u1', 'f2'],
            })
        )
    })

    it('renders no preview for a topic with nothing unread', () => {
        renderChatItem(buildState(READ))

        expect(ChatItemUnreadMessages).not.toHaveBeenCalled()
        expect(ChatItemLastComment).toHaveBeenCalled()
    })

    it('drops the one-line teaser while the full unread messages are shown', () => {
        // Otherwise the newest unread message appears twice: once truncated, once in full.
        renderChatItem(buildState(UNREAD))

        expect(ChatItemLastComment).not.toHaveBeenCalled()
    })

    it('follows the active tab, so the preview cannot disagree with the row badge', () => {
        renderChatItem(buildState(UNREAD, FOLLOWED_TAB))

        expect(previewProps().unreadCommentIds).toEqual(['f1', 'f2'])
    })

    it('previews nothing inside the comment popup', () => {
        // That popup is a compact chat picker and renders the thread it points at anyway.
        renderChatItem(buildState(UNREAD), { inCommentPopup: true, onPress: jest.fn() })

        expect(ChatItemUnreadMessages).not.toHaveBeenCalled()
        expect(ChatItemLastComment).toHaveBeenCalled()
    })
})
