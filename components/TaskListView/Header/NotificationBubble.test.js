/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer from 'react-test-renderer'

import NotificationBubble from './NotificationBubble'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: { themeName: 'default' } }),
}))
jest.mock('../../../Themes/Themes', () => ({
    getTheme: () => ({}),
}))
jest.mock('../../SidebarMenu/Themes', () => ({ Themes: {} }))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../../utils/TabNavigationConstants', () => ({
    DV_TAB_ROOT_CHATS: 'chats',
    ROOT_ROUTES: [],
}))
jest.mock('../../Feeds/Utils/FeedsConstants', () => ({ ALL_TAB: 'all', FOLLOWED_TAB: 'followed' }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../utils/NavigationService', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { body3: { color: '#04142F' } },
    colors: {
        UtilityRed200: '#FF0000',
        Gray500: '#808080',
    },
}))

describe('NotificationBubble', () => {
    it.each([
        [true, '#FF0000'],
        [false, '#808080'],
    ])('renders white text on the %s notification badge', (isFollowedNotification, backgroundColor) => {
        const tree = renderer.create(
            <NotificationBubble amount={1} isFollowedNotification={isFollowedNotification} projectId="project-1" />
        )
        const badge = tree.root.findByType(TouchableOpacity)
        const text = tree.root.findByType(Text)

        expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe(backgroundColor)
        expect(StyleSheet.flatten(text.props.style).color).toBe('#FFFFFF')
    })
})
