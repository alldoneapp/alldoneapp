import {
    getFollowedAndUnfollowedChatNotificationsAmount,
    resetNotificationsWhenUserHasAnActiveChat,
    getRedChatNotifications,
    getFollowedFeedAmount,
} from './notificationBadges'
const followed = { totalFollowed: 1, totalUnfollowed: 0, followedNotifications: [{ commentId: 'm', date: 1000 }] }
const chats = {
    activeProject: { totalFollowed: 1, totalUnfollowed: 0, active: followed },
    visible: { totalFollowed: 1, totalUnfollowed: 4, next: followed },
    archived: { totalFollowed: 1, totalUnfollowed: 0, archived: followed },
    template: { totalFollowed: 1, totalUnfollowed: 0, template: followed },
}
const user = { archivedProjectIds: ['archived'], templateProjectIds: ['template'] }
const active = { projectId: 'activeProject', chatId: 'active', chatType: 'tasks' }

it('selects red notices from the same active-chat/project filtering as the top-right badge', () => {
    const visible = resetNotificationsWhenUserHasAnActiveChat(chats, active)
    expect(
        getFollowedAndUnfollowedChatNotificationsAmount(
            true,
            '',
            visible,
            user.archivedProjectIds,
            user.templateProjectIds
        )
    ).toEqual({ totalFollowed: 1, totalUnfollowed: 4 })
    expect(Object.keys(getRedChatNotifications(chats, active, user))).toEqual(['visible'])
    expect(chats.activeProject.active).toBe(followed)
})

it('does not produce red activity for a grey-only or zero badge', () => {
    expect(getRedChatNotifications({ p: { totalFollowed: 0, totalUnfollowed: 3, stale: followed } }, {}, {})).toEqual(
        {}
    )
    expect(getFollowedFeedAmount({ followedFeedsAmount: 0, allFeedsAmount: 3 })).toBe(0)
})

it('handles empty startup state', () => {
    expect(getRedChatNotifications({}, null, {})).toEqual({})
    expect(getFollowedFeedAmount({})).toBe(0)
})
