import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useVirtualKeyboardVisible from './useVirtualKeyboardVisible'
import { KEYBOARD_VISIBLE_CLASS, applyKeyboardVisible } from '../utils/virtualKeyboard'

// AT-3076: the hook mirrors the class `startVirtualKeyboardViewport` toggles on <html>.
const flushObserver = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

let latest
const Probe = () => {
    latest = useVirtualKeyboardVisible()
    return null
}

describe('useVirtualKeyboardVisible', () => {
    beforeEach(() => {
        document.documentElement.className = ''
        latest = undefined
    })

    it('reads the current state on mount', () => {
        document.documentElement.classList.add(KEYBOARD_VISIBLE_CLASS)
        let tree
        act(() => {
            tree = renderer.create(<Probe />)
        })
        expect(latest).toBe(true)
        act(() => tree.unmount())
    })

    it('follows the keyboard opening and closing', async () => {
        let tree
        act(() => {
            tree = renderer.create(<Probe />)
        })
        expect(latest).toBe(false)

        applyKeyboardVisible(true)
        await flushObserver()
        expect(latest).toBe(true)

        applyKeyboardVisible(false)
        await flushObserver()
        expect(latest).toBe(false)
        act(() => tree.unmount())
    })

    it('ignores unrelated class changes on <html>', async () => {
        let tree
        act(() => {
            tree = renderer.create(<Probe />)
        })
        document.documentElement.classList.add('app-keyboard-open')
        await flushObserver()
        expect(latest).toBe(false)
        act(() => tree.unmount())
    })
})
