import React, { useRef } from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../utils/safeAreaInsets', () => ({
    getSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}))

import useLiftAboveKeyboard from './useLiftAboveKeyboard'

// Geometry from the real iPad landscape incident (AT-2220 follow-up):
// innerHeight 820, keyboard 422 -> visible bottom 386; popover container at
// 477..698 must be lifted 312 so the card lands fully above the keyboard.
const setup = ({ parentRect }) => {
    const results = { lift: 0 }
    function Probe() {
        const ref = useRef(null)
        results.lift = useLiftAboveKeyboard(ref)
        ref.current = {
            getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
            parentElement: { getBoundingClientRect: () => parentRect },
        }
        return null
    }
    let tree
    act(() => {
        tree = renderer.create(<Probe />)
    })
    return { results, tree }
}

describe('useLiftAboveKeyboard', () => {
    let originalInnerHeight
    let listeners

    beforeEach(() => {
        originalInnerHeight = window.innerHeight
        listeners = {}
        window.visualViewport = {
            height: window.innerHeight,
            offsetTop: 0,
            addEventListener: (type, fn) => {
                listeners[type] = fn
            },
            removeEventListener: () => {},
        }
    })

    afterEach(() => {
        Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true })
        delete window.visualViewport
    })

    const openKeyboard = inset => {
        window.visualViewport.height = window.innerHeight - inset
        act(() => {
            listeners.resize()
        })
    }

    it('is 0 without a keyboard and lifts the popover clear when one opens', () => {
        Object.defineProperty(window, 'innerHeight', { value: 820, configurable: true })
        window.visualViewport.height = 820
        const { results } = setup({ parentRect: { top: 477, bottom: 698 } })
        expect(results.lift).toBe(0)

        openKeyboard(422) // visible bottom = 820 - 422 - 12 = 386
        expect(results.lift).toBe(312) // 698 -> 386

        openKeyboard(0)
        expect(results.lift).toBe(0)
    })

    it('never lifts the card into the top safe area', () => {
        Object.defineProperty(window, 'innerHeight', { value: 820, configurable: true })
        const { results } = setup({ parentRect: { top: 100, bottom: 800 } })
        openKeyboard(422)
        // needed would be 414, but top 100 only allows 88 (down to 12px margin)
        expect(results.lift).toBe(88)
    })

    it('ignores keyboards below the open threshold (floating/hardware)', () => {
        Object.defineProperty(window, 'innerHeight', { value: 820, configurable: true })
        const { results } = setup({ parentRect: { top: 477, bottom: 698 } })
        openKeyboard(80) // < KEYBOARD_OPEN_MIN_INSET_PX
        expect(results.lift).toBe(0)
    })
})
