import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

export const getChatsButtonBadge = (totalFollowed, totalUnfollowed) => ({
    amount: totalFollowed || totalUnfollowed,
    tab: totalFollowed || !totalUnfollowed ? FOLLOWED_TAB : ALL_TAB,
    isFollowed: totalFollowed > 0,
})
