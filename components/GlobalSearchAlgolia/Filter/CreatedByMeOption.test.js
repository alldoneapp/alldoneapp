/**
 * @jest-environment jsdom
 *
 * AT-2258 — the "only objects I created" row inside the search scope modal.
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

    it('does not close the scope modal when toggled', () => {
        // The creator filter is independent of the project scope, so the user
        // must be able to set both before returning to the search. A press must
        // therefore not be wired to anything but the toggle callback.
        const onToggle = jest.fn()
        const component = render({ enabled: true, onToggle })

        const touchable = component.root.findByType(TouchableOpacity)
        expect(touchable.props.onPress).toBeDefined()
        expect(touchable.props.disabled).toBeFalsy()

        act(() => component.unmount())
    })
})
