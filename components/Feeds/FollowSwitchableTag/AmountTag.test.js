import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import AmountTag from './AmountTag'

// react-native-web renders host DOM tags, so 'Text' no longer matches a node
// type - find the Text component itself instead.
describe('AmountTag', () => {
    it('shows the full amount when requested', () => {
        const component = renderer.create(<AmountTag feedAmount={123} showFullAmount={true} />)

        expect(component.root.findByType(Text).props.children).toBe(123)
    })

    it('keeps the existing capped format by default', () => {
        const component = renderer.create(<AmountTag feedAmount={123} />)

        expect(component.root.findByType(Text).props.children).toBe('+99')
    })
})
