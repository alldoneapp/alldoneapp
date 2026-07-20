import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { FOLLOWED_TAB } from '../../../Feeds/Utils/FeedsConstants'

const mockDispatch = jest.fn()
const mockGetState = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
}))
jest.mock('../../../../redux/store', () => ({
    getState: () => mockGetState(),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../SectionItemLayoutHeader', () => 'SectionItemLayoutHeader')
jest.mock('../../../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide popup' }),
    hideWebSideBar: () => ({ type: 'hide sidebar' }),
    setChatsActiveTab: tab => ({ type: 'set chats tab', tab }),
    setSelectedSidebarTab: tab => ({ type: 'set sidebar tab', tab }),
}))
jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    getFollowedAndUnfollowedChatNotificationsAmount: () => ({ totalFollowed: 3, totalUnfollowed: 5 }),
}))

const Chats = require('./Chats').default

describe('sidebar Chats item', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockGetState.mockReturnValue({
            projectChatNotifications: {},
            loggedUser: { archivedProjectIds: [], templateProjectIds: [] },
            smallScreenNavigation: false,
        })
    })

    it('keeps the navigation item without sidebar unread badge props', () => {
        const component = renderer.create(
            <Chats
                navigateToRoot={jest.fn()}
                projectColor={'blue'}
                selected={false}
                projectId={'project-1'}
                inAllProjects={false}
            />
        )
        const item = component.root.findByType('SectionItemLayoutHeader')

        expect(item.props.icon).toBe('comments-thread')
        expect(item.props.text).toBe('Chats')
        expect(item.props.inChats).toBeUndefined()
        expect(item.props.inAllProjects).toBeUndefined()
        expect(item.props.projectId).toBeUndefined()
    })

    it('still uses unread state to open the appropriate chat tab', () => {
        const navigateToRoot = jest.fn()
        const component = renderer.create(
            <Chats
                navigateToRoot={navigateToRoot}
                projectColor={'blue'}
                selected={false}
                projectId={'project-1'}
                inAllProjects={false}
            />
        )

        act(() => component.root.findByType('SectionItemLayoutHeader').props.onPress({ preventDefault: jest.fn() }))

        expect(mockDispatch).toHaveBeenCalledWith(
            expect.arrayContaining([{ type: 'set chats tab', tab: FOLLOWED_TAB }])
        )
        expect(navigateToRoot).toHaveBeenCalled()
    })
})
