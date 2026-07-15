import { getAllUnreadCommentIds, getUnreadCommentIds, getUnreadCommentsCount } from './unreadCommentsHelper'

describe('unread comments helpers', () => {
    const chatNotifications = {
        totalFollowed: 3,
        totalUnfollowed: 5,
        followedCommentIds: ['red-1', 'red-2', 'red-3'],
        unfollowedCommentIds: ['grey-old-1', 'grey-old-2', 'grey-old-3', 'grey-new-1', 'grey-new-2'],
    }

    it('selects notification IDs for the matching red or grey preview type', () => {
        expect(getUnreadCommentIds(chatNotifications, true)).toEqual(['red-1', 'red-2', 'red-3'])
        expect(getUnreadCommentIds(chatNotifications, false)).toEqual([
            'grey-old-1',
            'grey-old-2',
            'grey-old-3',
            'grey-new-1',
            'grey-new-2',
        ])
    })

    it('counts only the genuinely new grey tail instead of the inflated cumulative total', () => {
        const commentsNewestFirst = [
            'grey-new-2',
            'grey-new-1',
            'already-read-comment',
            'grey-old-3',
            'grey-old-2',
            'grey-old-1',
        ]

        expect(getUnreadCommentsCount(chatNotifications, false, commentsNewestFirst)).toBe(2)
    })

    it('counts red comments in a mixed unread tail without counting grey comments', () => {
        const mixedNotifications = {
            followedCommentIds: ['red-1', 'red-2'],
            unfollowedCommentIds: ['grey-1'],
        }

        expect(getUnreadCommentsCount(mixedNotifications, true, ['grey-1', 'red-2', 'red-1', 'read-1'])).toBe(2)
        expect(getUnreadCommentsCount(mixedNotifications, false, ['grey-1', 'red-2', 'red-1', 'read-1'])).toBe(1)
    })

    it('deduplicates IDs and returns zero when the newest comment is already read', () => {
        expect(getUnreadCommentIds({ unfollowedCommentIds: ['grey-1', 'grey-1'] }, false)).toEqual(['grey-1'])
        expect(getAllUnreadCommentIds({ followedCommentIds: ['same'], unfollowedCommentIds: ['same'] })).toEqual([
            'same',
        ])
        expect(getUnreadCommentsCount({ unfollowedCommentIds: ['grey-1'] }, false, ['read-1', 'grey-1'])).toBe(0)
        expect(getUnreadCommentsCount(undefined, false, undefined)).toBe(0)
    })
})
