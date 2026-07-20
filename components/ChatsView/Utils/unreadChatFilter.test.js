import { ALL_TAB, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import {
    filterChatsByUnread,
    filterStickyChatsByUnread,
    getUnreadChatIds,
    getUnreadThreadCount,
    isUnreadChat,
} from './unreadChatFilter'

const notifications = {
    totalFollowed: 3,
    totalUnfollowed: 2,
    followed: {
        totalFollowed: 3,
        totalUnfollowed: 0,
        followedNotifications: [{ date: 100 }],
    },
    unfollowed: {
        totalFollowed: 0,
        totalUnfollowed: 2,
        unfollowedNotifications: [{ date: 200 }],
    },
    read: { totalFollowed: 0, totalUnfollowed: 0 },
}

describe('unread chat filtering', () => {
    it('matches both notification types in All and only followed notifications in Followed', () => {
        expect(isUnreadChat(notifications, 'followed', ALL_TAB)).toBe(true)
        expect(isUnreadChat(notifications, 'unfollowed', ALL_TAB)).toBe(true)
        expect(isUnreadChat(notifications, 'unfollowed', FOLLOWED_TAB)).toBe(false)
        expect(isUnreadChat(notifications, 'followed', FOLLOWED_TAB)).toBe(true)
        expect(isUnreadChat(notifications, 'read', ALL_TAB)).toBe(false)
    })

    it('counts unread threads instead of unread comments across the requested projects', () => {
        const allNotifications = {
            project1: notifications,
            project2: {
                totalFollowed: 0,
                totalUnfollowed: 5,
                another: { totalFollowed: 0, totalUnfollowed: 5 },
            },
            archived: { old: { totalFollowed: 1, totalUnfollowed: 0 } },
        }

        expect(getUnreadThreadCount(allNotifications, ['project1', 'project2'], ALL_TAB)).toBe(3)
        expect(getUnreadThreadCount(allNotifications, ['project1', 'project2'], FOLLOWED_TAB)).toBe(1)
    })

    it('returns only unread chat ids for the active tab', () => {
        expect(getUnreadChatIds(notifications, ALL_TAB)).toEqual(['unfollowed', 'followed'])
        expect(getUnreadChatIds(notifications, FOLLOWED_TAB)).toEqual(['followed'])
    })

    it('keeps legacy unread chats without notification dates in their existing order', () => {
        expect(
            getUnreadChatIds(
                {
                    first: { totalFollowed: 1 },
                    second: { totalFollowed: 1 },
                },
                FOLLOWED_TAB
            )
        ).toEqual(['first', 'second'])
    })

    it('keeps only unread regular and sticky chats and removes empty date groups', () => {
        const chatsByDate = {
            '20260720': [{ id: 'followed' }, { id: 'read' }],
            '20260719': [{ id: 'unfollowed' }],
        }
        const stickyChats = [{ id: 'read' }, { id: 'unfollowed' }]

        expect(filterChatsByUnread(chatsByDate, notifications, FOLLOWED_TAB)).toEqual({
            '20260720': [{ id: 'followed' }],
        })
        expect(filterStickyChatsByUnread(stickyChats, notifications, ALL_TAB)).toEqual([{ id: 'unfollowed' }])
    })
})
