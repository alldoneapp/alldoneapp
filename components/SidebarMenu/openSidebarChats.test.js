import { getSidebarChatsActions, getSidebarChatsTab } from './openSidebarChats'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'

let mockAmounts = { totalFollowed: 0, totalUnfollowed: 0 }
const mockGetAmounts = jest.fn(() => mockAmounts)

jest.mock('../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide popup' }),
    hideWebSideBar: () => ({ type: 'hide sidebar' }),
    setChatsActiveTab: tab => ({ type: 'set chats tab', tab }),
    setSelectedSidebarTab: tab => ({ type: 'set sidebar tab', tab }),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    getFollowedAndUnfollowedChatNotificationsAmount: (...args) => mockGetAmounts(...args),
}))

const state = (overrides = {}) => ({
    projectChatNotifications: { p1: {} },
    loggedUser: { archivedProjectIds: ['a'], templateProjectIds: ['t'] },
    smallScreenNavigation: false,
    ...overrides,
})

describe('openSidebarChats (AT-3020)', () => {
    beforeEach(() => mockGetAmounts.mockClear())

    it.each([
        [{ totalFollowed: 0, totalUnfollowed: 0 }, FOLLOWED_TAB],
        [{ totalFollowed: 2, totalUnfollowed: 5 }, FOLLOWED_TAB],
        [{ totalFollowed: 0, totalUnfollowed: 5 }, ALL_TAB],
    ])('with unread %o opens %s', (amounts, tab) => {
        mockAmounts = amounts
        expect(getSidebarChatsTab(state(), 'p1')).toBe(tab)
    })

    it('counts the unread chats of the one project, leaving archived and template projects out', () => {
        const current = state()
        getSidebarChatsTab(current, 'p1')

        expect(mockGetAmounts).toHaveBeenCalledWith(false, 'p1', current.projectChatNotifications, ['a'], ['t'])
    })

    it('selects the Chats view and closes popups, and the sidebar only on a small screen', () => {
        mockAmounts = { totalFollowed: 1, totalUnfollowed: 0 }
        const opening = [
            { type: 'set chats tab', tab: FOLLOWED_TAB },
            { type: 'set sidebar tab', tab: DV_TAB_ROOT_CHATS },
            { type: 'hide popup' },
        ]

        expect(getSidebarChatsActions(state(), 'p1')).toEqual(opening)
        expect(getSidebarChatsActions(state({ smallScreenNavigation: true }), 'p1')).toEqual([
            ...opening,
            { type: 'hide sidebar' },
        ])
    })
})
