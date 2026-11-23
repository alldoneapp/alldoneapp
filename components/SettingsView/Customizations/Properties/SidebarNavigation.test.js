import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

import SidebarNavigation from './SidebarNavigation'
import { setUserSidebarNavigationMode } from '../../../../utils/backends/Users/usersFirestore'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false })),
}))
jest.mock('../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, content, isOpen }) => (
        <View>
            {children}
            {isOpen ? content : null}
        </View>
    )
})
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({ translate: jest.fn(text => text) }))
jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return ({ title, onPress }) => (
        <TouchableOpacity testID="current-mode" onPress={onPress}>
            <Text>{title}</Text>
        </TouchableOpacity>
    )
})
jest.mock('../../../../utils/backends/Users/usersFirestore', () => ({
    setUserSidebarNavigationMode: jest.fn(),
}))

const currentLabel = tree => tree.root.findByProps({ testID: 'current-mode' }).findByType(Text).props.children

// AT-3122: Settings shows the navigation the user actually gets.
describe('Settings → Sidebar navigation', () => {
    beforeEach(() => setUserSidebarNavigationMode.mockClear())

    it.each([undefined, null])('shows "Anna on top" for a user who never picked one (%p)', mode => {
        const tree = renderer.create(<SidebarNavigation userId="u1" sidebarNavigationMode={mode} />)
        expect(currentLabel(tree)).toBe('Anna on top')
    })

    it.each([
        ['simple', 'Simple navigation'],
        ['advanced', 'Advanced navigation'],
        ['sectionsTop', 'Anna on top'],
    ])('shows the picked %s mode', (mode, label) => {
        const tree = renderer.create(<SidebarNavigation userId="u1" sidebarNavigationMode={mode} />)
        expect(currentLabel(tree)).toBe(label)
    })

    it('stores a pick, even of the default, as the user choice', () => {
        const tree = renderer.create(<SidebarNavigation userId="u1" sidebarNavigationMode={undefined} />)
        act(() => tree.root.findByProps({ testID: 'current-mode' }).props.onPress())

        const option = label =>
            tree.root
                .findAllByType(TouchableOpacity)
                .filter(node => node.props.testID !== 'current-mode')
                .find(node => node.findAllByType(Text).some(text => text.props.children === label))

        act(() => option('Simple navigation').props.onPress())
        expect(setUserSidebarNavigationMode).toHaveBeenLastCalledWith('u1', 'simple')

        act(() => tree.root.findByProps({ testID: 'current-mode' }).props.onPress())
        act(() => option('Anna on top').props.onPress())
        expect(setUserSidebarNavigationMode).toHaveBeenLastCalledWith('u1', 'sectionsTop')
    })
})
