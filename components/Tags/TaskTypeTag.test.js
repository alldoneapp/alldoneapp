import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import TaskTypeTag from './TaskTypeTag'

jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

describe('TaskTypeTag', () => {
    it('renders the regular text pill by default', () => {
        const tree = renderer.create(<TaskTypeTag icon="fast-forward" text="Bypass workflow" />)

        expect(tree.root.findByType(Text).props.children).toBe('Bypass workflow')
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Bypass workflow' })).toHaveLength(0)
    })

    it('renders an accessible icon-only tag without the desktop pill text', () => {
        const tree = renderer.create(<TaskTypeTag icon="fast-forward" text="Bypass workflow" iconOnly />)
        const tag = tree.root.findByProps({ accessibilityLabel: 'Bypass workflow' })

        expect(tag.props.title).toBe('Bypass workflow')
        expect(tag.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ paddingHorizontal: 0 })]))
        expect(tree.root.findAllByType(Text)).toHaveLength(0)
        expect(tree.root.findByType('Icon').props.name).toBe('fast-forward')
    })
})
