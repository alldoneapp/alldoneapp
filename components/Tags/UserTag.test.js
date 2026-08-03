import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import UserTag from './UserTag'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: { Text03: '#999999', Grey300: '#eeeeee' },
    windowTagStyle: () => ({}),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

describe('UserTag', () => {
    const user = { displayName: 'Karsten Wysk', photoURL: 'avatar.jpg' }

    it('renders the assignee name in the regular tag by default', () => {
        const tree = renderer.create(<UserTag user={user} />)

        expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Karsten')).toBe(true)
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Karsten Wysk' })).toHaveLength(0)
    })

    it('renders an accessible photo-only tag without the assignee text', () => {
        const tree = renderer.create(<UserTag user={user} onlyPhoto />)
        const tag = tree.root.findByProps({ accessibilityLabel: 'Karsten Wysk' })

        expect(tag.props.title).toBe('Karsten Wysk')
        expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Karsten')).toBe(false)
    })
})
