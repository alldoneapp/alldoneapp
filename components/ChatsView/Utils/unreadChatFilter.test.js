import { ALL_TAB, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import {
    filterChatsByUnread,
    filterStickyChatsByUnread,
    getUnreadChatIds,
    getUnreadCommentIds,
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
            20260720: [{ id: 'followed' }, { id: 'read' }],
            20260719: [{ id: 'unfollowed' }],
        }
        const stickyChats = [{ id: 'read' }, { id: 'unfollowed' }]

        expect(filterChatsByUnread(chatsByDate, notifications, FOLLOWED_TAB)).toEqual({
            20260720: [{ id: 'followed' }],
        })
        expect(filterStickyChatsByUnread(stickyChats, notifications, ALL_TAB)).toEqual([{ id: 'unfollowed' }])
    })
})

describe('getUnreadCommentIds', () => {
    const bothKinds = {
        totalFollowed: 2,
        totalUnfollowed: 1,
        followedNotifications: [
            { commentId: 'f2', date: 300 },
            { commentId: 'f1', date: 100 },
        ],
        unfollowedNotifications: [{ commentId: 'u1', date: 200 }],
    }

    const unfollowedOnly = {
        totalFollowed: 0,
        totalUnfollowed: 2,
        unfollowedNotifications: [
            { commentId: 'u2', date: 400 },
            { commentId: 'u1', date: 200 },
        ],
    }

    it('returns the unread comments oldest first, so the preview reads like the thread', () => {
        expect(getUnreadCommentIds(unfollowedOnly, ALL_TAB)).toEqual(['u1', 'u2'])
    })

    it('previews exactly the set the row badge counts when a chat has both kinds', () => {
        // The badge is `totalFollowed || totalUnfollowed`, so it prints 2 here. Merging both sets
        // would preview three messages under a badge that says two.
        expect(getUnreadCommentIds(bothKinds, ALL_TAB)).toEqual(['f1', 'f2'])
    })

    it('falls back to unfollowed notifications only when there is no followed one', () => {
        expect(getUnreadCommentIds(unfollowedOnly, ALL_TAB)).toEqual(['u1', 'u2'])
    })

    it('never previews unfollowed notifications on the Followed tab', () => {
        expect(getUnreadCommentIds(bothKinds, FOLLOWED_TAB)).toEqual(['f1', 'f2'])
        expect(getUnreadCommentIds(unfollowedOnly, FOLLOWED_TAB)).toEqual([])
    })

    it('lets the counters, not the arrays, choose the set', () => {
        // A legacy followed notification carries no commentId, so the followed array is empty while
        // the badge still counts it. Previewing the unfollowed set instead would show messages the
        // red badge is not talking about.
        expect(
            getUnreadCommentIds(
                {
                    totalFollowed: 1,
                    totalUnfollowed: 1,
                    followedNotifications: [{ date: 100 }],
                    unfollowedNotifications: [{ commentId: 'u1', date: 200 }],
                },
                ALL_TAB
            )
        ).toEqual([])
    })

    it('drops legacy notifications that carry no comment id', () => {
        expect(
            getUnreadCommentIds(
                { totalFollowed: 2, followedNotifications: [{ date: 1 }, { commentId: 'f1', date: 2 }] },
                ALL_TAB
            )
        ).toEqual(['f1'])
    })

    it('returns nothing for a chat with no notifications at all', () => {
        expect(getUnreadCommentIds(undefined, ALL_TAB)).toEqual([])
        expect(getUnreadCommentIds({ totalFollowed: 0, totalUnfollowed: 0 }, ALL_TAB)).toEqual([])
    })
})
