/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text } from 'react-native'
import renderer from 'react-test-renderer'

import UnreadCommentsBadge from './UnreadCommentsBadge'

jest.mock('../../../styles/global', () => ({
    colors: {
        UtilityRed200: '#FF0000',
        Gray500: '#808080',
    },
}))

describe('UnreadCommentsBadge', () => {
    it('renders the red count with a red background', () => {
        const tree = renderer.create(<UnreadCommentsBadge amount={3} followed={true} />)
        const badge = tree.root.findByProps({ testID: 'unread-comments-badge' })

        expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe('#FF0000')
        expect(tree.root.findByType(Text).props.children).toBe(3)
    })

    it('renders the grey count with a grey background', () => {
        const tree = renderer.create(<UnreadCommentsBadge amount={5} followed={false} />)
        const badge = tree.root.findByProps({ testID: 'unread-comments-badge' })

        expect(StyleSheet.flatten(badge.props.style).backgroundColor).toBe('#808080')
        expect(tree.root.findByType(Text).props.children).toBe(5)
    })

    it.each([true, false])('does not render a badge at zero when followed is %s', followed => {
        const tree = renderer.create(<UnreadCommentsBadge amount={0} followed={followed} />)

        expect(tree.toJSON()).toBeNull()
    })
})
