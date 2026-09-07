import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

jest.mock('../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))

const Switch = require('./Switch').default

function render(props) {
    let tree
    act(() => {
        tree = renderer.create(<Switch {...props} />)
    })
    return tree
}

function press(tree) {
    act(() => {
        tree.root.findAllByType(TouchableOpacity)[0].props.onPress()
    })
}

describe('Switch', () => {
    it('calls the handler for the direction it is in', () => {
        const activeSwitch = jest.fn()
        const deactiveSwitch = jest.fn()

        press(render({ active: false, activeSwitch, deactiveSwitch }))
        expect(activeSwitch).toHaveBeenCalledTimes(1)
        expect(deactiveSwitch).not.toHaveBeenCalled()

        press(render({ active: true, activeSwitch, deactiveSwitch }))
        expect(deactiveSwitch).toHaveBeenCalledTimes(1)
    })

    it('never throws out of a press when a handler is missing', () => {
        // AT-2518: a caller reaching for React Native's core `value`/`onValueChange` names left both
        // handlers undefined, and the press surfaced as an uncaught `TypeError: t is not a function`
        // from inside PressResponder — a stack that names neither the switch nor the wrong prop. A
        // missing handler is a no-op now; the toggle still does not move, but the page survives.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            expect(() => press(render({ active: false }))).not.toThrow()
            expect(() => press(render({ active: true }))).not.toThrow()
            expect(() => press(render({ value: true, onValueChange: jest.fn() }))).not.toThrow()

            // And it says which prop is missing, so the fix is one line away from the console.
            expect(warn).toHaveBeenCalled()
            expect(String(warn.mock.calls[0][0])).toMatch(/activeSwitch/)
        } finally {
            warn.mockRestore()
        }
    })

    it('reports the state through `active`, not through `value`', () => {
        // The prop that decides what is drawn. `value` is ignored, which is why a caller using it
        // saw a switch permanently stuck at "No".
        expect(render({ active: true, activeSwitch: jest.fn(), deactiveSwitch: jest.fn() }).toJSON()).toBeTruthy()
        const withValueOnly = render({ value: true })
        const labels = withValueOnly.root
            .findAll(node => typeof node.props?.children === 'string')
            .map(node => node.props.children)
        expect(labels).toContain('No')
    })
})
