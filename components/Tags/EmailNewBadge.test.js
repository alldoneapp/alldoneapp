/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text } from 'react-native'
import renderer from 'react-test-renderer'

import EmailNewBadge from './EmailNewBadge'

jest.mock('../../i18n/TranslationService', () => ({
    translate: value => (value === 'New' ? 'Neu' : value),
}))

describe('EmailNewBadge', () => {
    test('renders the translated label with the neutral grey treatment', () => {
        const tree = renderer.create(<EmailNewBadge />)
        const badge = tree.root.findByProps({ testID: 'email-new-badge' })

        expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe('#718592')
        expect(tree.root.findByType(Text).props.children).toBe('Neu')
        expect(badge.props.accessibilityLabel).toBe('Neu')
    })
})
