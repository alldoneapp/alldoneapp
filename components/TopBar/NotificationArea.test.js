import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet, TouchableOpacity } from 'react-native'
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
jest.mock('../../Themes/Themes', () => ({ getTheme: () => ({ iconColor: 'grey', bellIcon: 'white' }) }))

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
    it('marks the bell as selected only while the Updates view is open (AT-2979)', () => {
        const findBell = tree => tree.root.findByProps({ testID: 'top-bar-updates-button' })
        const bellColor = tree => findBell(tree).findByType('Icon').props.color
        const bellBackground = tree => StyleSheet.flatten(findBell(tree).props.style).backgroundColor

        mockState = { ...mockState, route: 'ROOT_UPDATES' }
        let tree
        act(() => {
            tree = renderer.create(<Component />)
        })
        expect(bellColor(tree)).toBe('#007FFF')
        expect(bellBackground(tree)).toBe('#E2EFFF')

        for (const route of ['ROOT_TASKS', 'ROOT_CHATS', 'TaskDetailedView']) {
            mockState = { ...mockState, route }
            act(() => tree.update(<Component />))
            expect(bellColor(tree)).toBe(_name === 'desktop' ? 'grey' : 'white')
            expect(bellBackground(tree)).toBeUndefined()
        }
        act(() => tree.unmount())
    })
})
