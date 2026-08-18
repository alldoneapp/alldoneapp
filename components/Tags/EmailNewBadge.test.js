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
    test('renders a grey dot with no visible label (AT-2366)', () => {
        const tree = renderer.create(<EmailNewBadge />)
        const badge = tree.root.findByProps({ testID: 'email-new-badge' })
        const style = StyleSheet.flatten(badge.props.style)

        expect(style.backgroundColor).toBe('#718592')
        expect(style.width).toBe(6)
        expect(style.height).toBe(6)
        // The word "New" must not be rendered as visible text any more - the dot is the whole marker.
        expect(tree.root.findAllByType(Text)).toHaveLength(0)
    })

    test('keeps announcing "New" to screen readers', () => {
        const tree = renderer.create(<EmailNewBadge />)
        const badge = tree.root.findByProps({ testID: 'email-new-badge' })

        expect(badge.props.accessibilityLabel).toBe('Neu')
    })

    test('still merges the positioning styles passed by its call sites', () => {
        const tree = renderer.create(<EmailNewBadge propStyles={{ marginLeft: 'auto', marginRight: 8 }} />)
        const style = StyleSheet.flatten(tree.root.findByProps({ testID: 'email-new-badge' }).props.style)

        expect(style.marginLeft).toBe('auto')
        expect(style.marginRight).toBe(8)
        expect(style.backgroundColor).toBe('#718592')
    })
})
