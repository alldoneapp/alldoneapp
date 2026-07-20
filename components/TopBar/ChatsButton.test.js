import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import { getChatsButtonBadge } from './chatsButtonHelper'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

const mockDispatch = jest.fn()
const mockUseSelector = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => mockUseSelector(selector),
}))
jest.mock('../Icon', () => 'Icon')
jest.mock('../Feeds/FollowSwitchableTag/AmountTag', () => 'AmountTag')
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ route: 'Root' }) }))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide popup' }),
    navigateToAllProjectsChats: options => ({ type: 'all chats', options }),
}))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({
    resetNotificationsWhenUserHasAnActiveChat: notifications => notifications,
    getFollowedAndUnfollowedChatNotificationsAmount: () => ({ totalFollowed: 4, totalUnfollowed: 9 }),
}))

const ChatsButton = require('./ChatsButton').default

describe('getChatsButtonBadge', () => {
    it('prioritizes the red followed count and tab', () => {
        expect(getChatsButtonBadge(3, 8)).toEqual({ amount: 3, tab: FOLLOWED_TAB, isFollowed: true })
    })

    it('uses the grey unfollowed count when there are no followed notifications', () => {
        expect(getChatsButtonBadge(0, 8)).toEqual({ amount: 8, tab: ALL_TAB, isFollowed: false })
    })

    it('defaults to the followed tab when there are no unread chats', () => {
        expect(getChatsButtonBadge(0, 0)).toEqual({ amount: 0, tab: FOLLOWED_TAB, isFollowed: false })
    })
})

describe('ChatsButton', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockUseSelector.mockImplementation(selector =>
            selector({
                loggedUser: { archivedProjectIds: [], templateProjectIds: [] },
                activeChatData: {},
                projectChatNotifications: {},
            })
        )
    })

    it('opens the cross-project followed chat list when the red count is available', () => {
        const component = renderer.create(<ChatsButton color={'black'} />)

        expect(component.root.findByType('AmountTag').props.feedAmount).toBe(4)

        act(() => component.root.findByType(TouchableOpacity).props.onPress({ preventDefault: jest.fn() }))

        expect(mockDispatch).toHaveBeenCalledWith([
            { type: 'hide popup' },
            { type: 'all chats', options: { chatsActiveTab: FOLLOWED_TAB } },
        ])
    })
})
