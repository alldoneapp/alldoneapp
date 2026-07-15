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

    it('keeps a red badge above an unnotified live VM status comment', () => {
        const notifications = {
            followedCommentIds: ['red-new'],
            unfollowedCommentIds: [],
            followedNotifications: [{ commentId: 'red-new', date: 200 }],
            unfollowedNotifications: [],
        }
        const commentsNewestFirst = [
            {
                id: 'vm-status',
                created: 300,
                isLoading: true,
                assistantRun: { kind: 'vm_job', status: 'running' },
            },
            { id: 'red-new', created: 200 },
            { id: 'already-read', created: 100 },
        ]

        expect(getUnreadCommentsCount(notifications, true, commentsNewestFirst)).toBe(1)
        expect(getUnreadCommentsCount(notifications, false, commentsNewestFirst)).toBe(0)
    })

    it('reconciles a notification that arrives before its live or stable comment', () => {
        const notifications = {
            followedCommentIds: ['red-pending'],
            unfollowedCommentIds: [],
            followedNotifications: [{ commentId: 'red-pending', date: 300 }],
            unfollowedNotifications: [],
        }
        const beforeCommentSnapshot = [{ id: 'already-read', created: 100 }]
        const partialCommentSnapshot = [
            { commentText: 'Streaming…', created: 300, isLoading: true },
            ...beforeCommentSnapshot,
        ]
        const stableCommentSnapshot = [
            { id: 'red-pending', commentText: 'Finished', created: 300, isLoading: false },
            ...beforeCommentSnapshot,
        ]

        expect(getUnreadCommentsCount(notifications, true, beforeCommentSnapshot)).toBe(1)
        expect(getUnreadCommentsCount(notifications, true, partialCommentSnapshot)).toBe(1)
        expect(getUnreadCommentsCount(notifications, true, stableCommentSnapshot)).toBe(1)
    })

    it('does not count stale markers while a newer notification is still pending', () => {
        const notifications = {
            followedCommentIds: ['red-stale', 'red-pending'],
            unfollowedCommentIds: [],
            followedNotifications: [
                { commentId: 'red-stale', date: 50 },
                { commentId: 'red-pending', date: 300 },
            ],
            unfollowedNotifications: [],
        }
        const commentsNewestFirst = [
            { id: 'temporary-vm-output', created: 300, isLoading: true },
            { id: 'already-read', created: 100 },
            { id: 'red-stale', created: 50 },
        ]

        expect(getUnreadCommentsCount(notifications, true, commentsNewestFirst)).toBe(1)
    })

    it('preserves grey counts while skipping live comments and hides stale-only badges', () => {
        const notifications = {
            followedCommentIds: [],
            unfollowedCommentIds: ['grey-new', 'grey-stale'],
            followedNotifications: [],
            unfollowedNotifications: [
                { commentId: 'grey-new', date: 200 },
                { commentId: 'grey-stale', date: 50 },
            ],
        }
        const liveThenUnread = [
            { id: 'vm-status', created: 300, assistantRun: { status: 'running' } },
            { id: 'grey-new', created: 200 },
            { id: 'already-read', created: 100 },
            { id: 'grey-stale', created: 50 },
        ]
        const liveThenRead = [
            { id: 'vm-status', created: 300, assistantRun: { status: 'running' } },
            { id: 'already-read', created: 100 },
            { id: 'grey-stale', created: 50 },
        ]

        expect(getUnreadCommentsCount(notifications, false, liveThenUnread)).toBe(1)
        expect(
            getUnreadCommentsCount(
                {
                    ...notifications,
                    unfollowedCommentIds: ['grey-stale'],
                    unfollowedNotifications: [{ commentId: 'grey-stale', date: 50 }],
                },
                false,
                liveThenRead
            )
        ).toBe(0)
    })
})
