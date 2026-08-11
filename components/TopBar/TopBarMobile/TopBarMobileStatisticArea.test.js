import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

const mockDispatch = jest.fn()
const mockStoreState = { expandedNavPicker: false }
let mockSidebarExpanded = true

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector =>
        selector({
            loggedUser: {
                themeName: 'default',
                isAnonymous: false,
                sidebarExpanded: mockSidebarExpanded,
                archivedProjectIds: [],
                templateProjectIds: [],
            },
            projectChatNotifications: { 'project-1': { totalFollowed: 7 } },
            activeChatData: {},
        }),
}))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../ChatsView/ChatIndicator', () => 'ChatIndicator')
jest.mock('../GoldArea', () => 'GoldArea')
jest.mock('../HomeButton', () => 'HomeButton')
jest.mock('../../../Themes/Themes', () => ({ getTheme: () => ({ menuIcon: 'black' }) }))
jest.mock('../Themes', () => ({ Themes: {} }))
jest.mock('../../../redux/actions', () => ({
    setShowWebSideBar: () => ({ type: 'show web sidebar' }),
}))
jest.mock('../../../redux/store', () => ({ getState: () => mockStoreState }))

const TopBarMobileStatisticArea = require('./TopBarMobileStatisticArea').default

describe('mobile sidebar opener', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockStoreState.expandedNavPicker = false
    })

    it.each([true, false])('does not show a chat unread badge when sidebarExpanded is %s', sidebarExpanded => {
        mockSidebarExpanded = sidebarExpanded

        const component = renderer.create(<TopBarMobileStatisticArea />)

        expect(component.root.findAllByType('ChatIndicator')).toHaveLength(0)
        expect(component.root.findByType('Icon').props.name).toBe('menu')
    })

    it('still opens the sidebar and expands an active secondary navigation bar', () => {
        mockStoreState.expandedNavPicker = true
        const expandSecondaryBar = jest.fn()
        const component = renderer.create(<TopBarMobileStatisticArea expandSecondaryBar={expandSecondaryBar} />)

        act(() => component.root.findByType(TouchableOpacity).props.onPress({ preventDefault: jest.fn() }))

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'show web sidebar' })
        expect(expandSecondaryBar).toHaveBeenCalledTimes(1)
    })
})
