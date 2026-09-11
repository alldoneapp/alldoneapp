import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import QuickActionsMeasurer from './QuickActionsMeasurer'

describe('QuickActionsMeasurer', () => {
    it('measures labels without leaving an invisible pointer or focus target', () => {
        const onOptionLayout = jest.fn()
        let tree

        act(() => {
            tree = renderer.create(
                <QuickActionsMeasurer
                    options={[{ id: 'search-report', text: 'Search report', icon: 'search' }]}
                    onOptionLayout={onOptionLayout}
                />
            )
        })

        const button = tree.root.findByType(TouchableOpacity)
        expect(button.props.pointerEvents).toBe('none')
        expect(button.props.focusable).toBe(false)
        expect(button.props.accessible).toBe(false)
        expect(button.props.disabled).toBe(false)

        act(() => {
            button.props.onLayout({ nativeEvent: { layout: { width: 93 } } })
        })
        expect(onOptionLayout).toHaveBeenCalledWith('search-report', 93)
    })
})
