import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import NotificationArea from './NotificationArea'
import MobileNotificationArea from './TopBarMobile/MobileNotificationArea'
import NavigationService from '../../utils/NavigationService'

const mockDispatch = jest.fn()
let mockState
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: () => ({ type: 'hide' }),
    navigateToUpdates: options => ({ type: 'updates', options }),
    setReloadGlobalFeeds: value => ({ type: 'reload', value }),
    setSearchText: jest.fn(),
    showGlobalSearchPopup: jest.fn(),
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ ALL_PROJECTS_INDEX: -1 }))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../Feeds/FollowSwitchableTag/AmountTag', () => 'AmountTag')
jest.mock('../UIControls/Shortcut', () => 'Shortcut')
jest.mock('./ChatsButton', () => 'ChatsButton')
jest.mock('../../Themes/Themes', () => ({ getTheme: () => ({}) }))

describe.each([
    ['desktop', NotificationArea],
    ['mobile', MobileNotificationArea],
])('%s top navigation updates', (_name, Component) => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            loggedUser: { themeName: 'default', isAnonymous: false },
            followedFeedsAmount: 5,
            allFeedsAmount: 8,
            selectedProjectIndex: 0,
            route: 'Root',
        }
        useSelector.mockImplementation(selector => selector(mockState))
    })

    it('opens all-project updates with the same badge after every project switch', () => {
        let tree
        act(() => {
            tree = renderer.create(<Component />)
        })
        for (const selectedProjectIndex of [0, 1, -1]) {
            mockState = { ...mockState, selectedProjectIndex }
            act(() => tree.update(<Component />))
            expect(tree.root.findByType('AmountTag').props.feedAmount).toBe(5)
            const bell = tree.root
                .findAllByType(TouchableOpacity)
                .find(button => button.findAllByType('Icon').some(icon => icon.props.name === 'bell'))
            act(() => bell.props.onPress())
            expect(mockDispatch).toHaveBeenLastCalledWith([
                { type: 'hide' },
                { type: 'reload', value: true },
                { type: 'updates', options: { selectedProjectIndex: -1 } },
            ])
        }
        act(() => tree.unmount())
    })

    it('preserves the all-updates badge fallback and returns from detailed views', () => {
        mockState = { ...mockState, followedFeedsAmount: 0, route: 'TaskDetailedView', expandedNavPicker: true }
        const expandSecondaryBar = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(<Component expandSecondaryBar={expandSecondaryBar} />)
        })
        expect(tree.root.findByType('AmountTag').props).toMatchObject({ feedAmount: 8, isFollowedButton: false })
        const bell = tree.root
            .findAllByType(TouchableOpacity)
            .find(button => button.findAllByType('Icon').some(icon => icon.props.name === 'bell'))
        act(() => bell.props.onPress())
        expect(NavigationService.navigate).toHaveBeenCalledWith('Root')
        if (_name === 'mobile') expect(expandSecondaryBar).toHaveBeenCalledTimes(1)
        act(() => tree.unmount())
    })
})
