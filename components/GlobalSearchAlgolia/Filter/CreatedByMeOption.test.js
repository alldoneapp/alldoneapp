/**
 * @jest-environment jsdom
 *
 * AT-2258 — the "only objects I created" row in the search popup.
 */
import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import CreatedByMeOption from './CreatedByMeOption'
import CheckBox from '../../CheckBox'

const render = props => {
    let component
    act(() => {
        component = renderer.create(<CreatedByMeOption {...props} />)
    })
    return component
}

describe('CreatedByMeOption', () => {
    it('reflects the current filter state in the checkbox', () => {
        const off = render({ enabled: false, onToggle: jest.fn() })
        expect(off.root.findByType(CheckBox).props.checked).toBe(false)

        const on = render({ enabled: true, onToggle: jest.fn() })
        expect(on.root.findByType(CheckBox).props.checked).toBe(true)

        act(() => off.unmount())
        act(() => on.unmount())
    })

    it('toggles on press', () => {
        const onToggle = jest.fn()
        const component = render({ enabled: false, onToggle })

        act(() => component.root.findByType(TouchableOpacity).props.onPress())

        expect(onToggle).toHaveBeenCalledTimes(1)
        act(() => component.unmount())
    })

    it('does not fire while the popup is busy indexing', () => {
        // Shares that disabled condition with the scope row and the full-search
        // row: a search cannot run mid-reindex, so a toggle that silently does
        // nothing would be worse than a greyed-out one.
        const onToggle = jest.fn()
        const component = render({ enabled: false, onToggle, disabled: true })

        expect(component.root.findByType(TouchableOpacity).props.disabled).toBe(true)

        act(() => component.unmount())
    })

    it('exposes its checked state to assistive tech', () => {
        const component = render({ enabled: true, onToggle: jest.fn() })

        const touchable = component.root.findByType(TouchableOpacity)
        expect(touchable.props.accessibilityRole).toBe('checkbox')
        expect(touchable.props.accessibilityState).toEqual({ checked: true, disabled: false })

        act(() => component.unmount())
    })
})
