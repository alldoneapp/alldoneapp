/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))
// The unread list's tag row has its own tests (UnreadTriage/); here only whether it shows.
jest.mock('./UnreadTriage/UnreadTriageFilters', () => ({
    UnreadTriageTagChips: () => 'UnreadTriageTagChips',
    UnreadTriageTools: () => 'UnreadTriageTools',
}))

import ChatFiltersLine from './ChatFiltersLine'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

const renderFilter = ({ notifications, tab = ALL_TAB, unreadOnly = false, setUnreadOnly = jest.fn() }) => {
    const state = { chatsActiveTab: tab, projectChatNotifications: notifications }
    useSelector.mockImplementation(selector => selector(state))
    let component
    act(() => {
        component = renderer.create(
            <ChatFiltersLine projectIds={['project-1']} unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly} />
        )
    })
    return { component, setUnreadOnly }
}

// chat1: two followed unread messages, chat2: one unfollowed unread message.
const TWO_CHATS_THREE_MESSAGES = {
    totalFollowed: 2,
    totalUnfollowed: 1,
    chat1: {
        totalFollowed: 2,
        totalUnfollowed: 0,
        followedNotifications: [{ commentId: 'a' }, { commentId: 'b' }],
    },
    chat2: { totalFollowed: 0, totalUnfollowed: 1, unfollowedNotifications: [{ commentId: 'c' }] },
}

describe('ChatFiltersLine', () => {
    beforeEach(() => jest.clearAllMocks())

    it('is hidden when the current view has no unread threads', () => {
        const { component } = renderFilter({
            notifications: { 'project-1': { totalFollowed: 0, totalUnfollowed: 0 } },
        })

        expect(component.root.findAllByProps({ testID: 'chat-filters' })).toHaveLength(0)
    })

    it('shows the unread message count and switches between Unread and All', () => {
        const setUnreadOnly = jest.fn()
        const { component } = renderFilter({
            notifications: {
                'project-1': TWO_CHATS_THREE_MESSAGES,
            },
            setUnreadOnly,
        })

        // react-native-web renders host DOM tags, so 'Text' no longer matches
        // a node type - find the Text component itself instead.
        expect(component.root.findByProps({ testID: 'chat-filter-unread' }).findAllByType(Text)[1].props.children).toBe(
            3
        )
        act(() => component.root.findByProps({ testID: 'chat-filter-unread' }).props.onPress())
        expect(setUnreadOnly).toHaveBeenCalledWith(true)
        act(() => component.root.findByProps({ testID: 'chat-filter-all' }).props.onPress())
        expect(setUnreadOnly).toHaveBeenCalledWith(false)
    })

    it('shows the unread list tags and tools in the filter row only on the Unread filter', () => {
        const notifications = {
            'project-1': {
                totalFollowed: 1,
                totalUnfollowed: 0,
                chat1: { totalFollowed: 1, totalUnfollowed: 0, followedNotifications: [{ commentId: 'a' }] },
            },
        }
        const all = renderFilter({ notifications })
        expect(JSON.stringify(all.component.toJSON())).not.toContain('UnreadTriageTagChips')
        expect(JSON.stringify(all.component.toJSON())).not.toContain('UnreadTriageTools')

        // One row (decided 2026-11-18): the tags and tools sit in the same row as All | Unread.
        const unread = renderFilter({ notifications, unreadOnly: true })
        const row = unread.component.root.findByProps({ testID: 'chat-filter-unread' }).parent.parent
        expect(JSON.stringify(unread.component.toJSON())).toContain('UnreadTriageTagChips')
        expect(JSON.stringify(unread.component.toJSON())).toContain('UnreadTriageTools')
        expect(row.findAll(node => node.props.testID === 'chat-filter-all')).not.toHaveLength(0)
    })

    // AT-2264: the header used to carry a badge with the number of selected filters -- here a
    // hardcoded "1", since Unread is the only filter. It read like an unread count next to the
    // chip's own count, so it is gone; the highlighted chip already says what is selected.
    it('does not show how many filters are selected', () => {
        const { component } = renderFilter({
            notifications: {
                'project-1': TWO_CHATS_THREE_MESSAGES,
            },
            unreadOnly: true,
        })

        expect(component.root.findAllByProps({ testID: 'chat-filter-active-count' })).toHaveLength(0)
        expect(component.root.findByProps({ testID: 'chat-filter-unread' }).findAllByType(Text)[1].props.children).toBe(
            3
        )
    })

    it('counts only the followed messages in the Followed tab, like the red chats badge', () => {
        const { component } = renderFilter({
            notifications: { 'project-1': TWO_CHATS_THREE_MESSAGES },
            tab: FOLLOWED_TAB,
        })

        expect(component.root.findByProps({ testID: 'chat-filter-unread' }).findAllByType(Text)[1].props.children).toBe(
            2
        )
    })

    it('counts a chat with followed and unfollowed messages the way the list shows it: followed only', () => {
        const { component } = renderFilter({
            notifications: {
                'project-1': {
                    totalFollowed: 1,
                    totalUnfollowed: 2,
                    chat1: {
                        totalFollowed: 1,
                        totalUnfollowed: 2,
                        followedNotifications: [{ commentId: 'a' }],
                        unfollowedNotifications: [{ commentId: 'b' }, { commentId: 'c' }],
                    },
                },
            },
        })

        expect(component.root.findByProps({ testID: 'chat-filter-unread' }).findAllByType(Text)[1].props.children).toBe(
            1
        )
    })

    it('hides unfollowed unread threads in the Followed tab', () => {
        const { component } = renderFilter({
            notifications: {
                'project-1': {
                    totalFollowed: 0,
                    totalUnfollowed: 1,
                    chat1: { totalFollowed: 0, totalUnfollowed: 1 },
                },
            },
            tab: FOLLOWED_TAB,
        })

        expect(component.root.findAllByProps({ testID: 'chat-filters' })).toHaveLength(0)
    })

    it('clears the active filter when its last unread thread is read', () => {
        const setUnreadOnly = jest.fn()
        renderFilter({
            notifications: { 'project-1': { totalFollowed: 0, totalUnfollowed: 0 } },
            unreadOnly: true,
            setUnreadOnly,
        })

        expect(setUnreadOnly).toHaveBeenCalledWith(false)
    })
})
