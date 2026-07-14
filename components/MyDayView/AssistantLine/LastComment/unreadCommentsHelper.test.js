import { getUnreadCommentsCount } from './unreadCommentsHelper'

describe('getUnreadCommentsCount', () => {
    const chatNotifications = { totalFollowed: 3, totalUnfollowed: 5 }

    it('returns the red followed count for a followed notification', () => {
        expect(getUnreadCommentsCount(chatNotifications, true)).toBe(3)
    })

    it('returns the grey unfollowed count for an unfollowed notification', () => {
        expect(getUnreadCommentsCount(chatNotifications, false)).toBe(5)
    })

    it('returns zero for missing or non-positive counts', () => {
        expect(getUnreadCommentsCount(undefined, true)).toBe(0)
        expect(getUnreadCommentsCount({ totalFollowed: 0, totalUnfollowed: -1 }, true)).toBe(0)
        expect(getUnreadCommentsCount({ totalFollowed: 0, totalUnfollowed: -1 }, false)).toBe(0)
    })
})
