/**
 * @jest-environment jsdom
 *
 * The hold overlay (AT-2408), rendered for real into the DOM.
 *
 * The complaint this answers is physical: on a phone the thumb holding the mic covers the mic, the
 * timer chip and a centimetre around them, so the only recording indicator the app had was
 * underneath the finger. The tests that matter are therefore about GEOMETRY and about the state
 * change at the boundary — that the ring is drawn at exactly the distance the release is judged by,
 * and that the card lands somewhere the thumb is not.
 *
 * Driven through react-dom rather than a shallow renderer because the overlay portals to
 * `document.body`; a shallow render would assert on an element that never reaches the page.
 */
import React from 'react'
import { Animated } from 'react-native'
import { act } from 'react-test-renderer'
import { createRoot } from 'react-dom/client'

import RambleHoldOverlay, { RAMBLE_RING_RADIUS, resolveHoldCardPosition } from './RambleHoldOverlay'
import { PUSH_TO_TALK_CANCEL_RADIUS } from './pushToTalk'

jest.mock('../Icon', () => {
    const React = require('react')
    return function IconStub({ name }) {
        return React.createElement('span', { 'data-testid': `icon-${name}` })
    }
})
jest.mock('../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
// The real hook resolves `AccessibilityInfo.isReduceMotionEnabled()` in a promise, which lands
// outside act() and drowns the run in warnings. Animations are inert under jest anyway
// (`animationsAreDisabled`), so the preference is not what these tests are about.
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => false }))

let container
let root

const render = (props = {}) => {
    act(() => {
        root.render(
            <RambleHoldOverlay
                visible
                originX={200}
                originY={600}
                progress={new Animated.Value(0)}
                armed={false}
                elapsedLabel={'0:07'}
                getInputLevel={() => 0}
                {...props}
            />
        )
    })
}

const byTestId = id => document.body.querySelector(`[data-testid="${id}"]`)

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    window.innerHeight = 900
    window.innerWidth = 420
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('the ring is the cancel boundary, drawn', () => {
    test('it is centred on the press point and sized to the cancel radius', () => {
        render({ originX: 300, originY: 500 })

        const ring = byTestId('ramble-hold-ring-safe')
        expect(ring).toBeTruthy()
        // Left/top place the box so its CENTRE is the finger; a box positioned at the finger would
        // put the whole boundary down and to the right of it.
        expect(ring.style.left).toBe(`${300 - RAMBLE_RING_RADIUS}px`)
        expect(ring.style.top).toBe(`${500 - RAMBLE_RING_RADIUS}px`)
        expect(ring.style.width).toBe(`${RAMBLE_RING_RADIUS * 2}px`)
        expect(ring.style.height).toBe(`${RAMBLE_RING_RADIUS * 2}px`)
    })

    test('the drawn radius IS the radius the release is judged by', () => {
        // If these two ever diverge, the app draws one promise and enforces another — the exact
        // failure AT-2408 exists to remove, just moved somewhere harder to see.
        expect(RAMBLE_RING_RADIUS).toBe(PUSH_TO_TALK_CANCEL_RADIUS)
    })

    test('it escapes the input that hosts the mic by portalling to the body', () => {
        render()

        const overlay = byTestId('ramble-hold-overlay')
        expect(overlay).toBeTruthy()
        // Every host of the mic — a chat composer, a task row, a comment popup — clips its subtree.
        expect(container.contains(overlay)).toBe(false)
        expect(overlay.parentElement).toBe(document.body)
    })

    test('it never takes the pointer, or the gesture driving it would freeze', () => {
        render()

        // react-native-web compiles static styles into classes, so the assertion has to go
        // through the resolved style rather than the inline attribute.
        expect(window.getComputedStyle(byTestId('ramble-hold-overlay')).pointerEvents).toBe('none')
    })

    test('nothing is drawn without a press point', () => {
        // A synthetic press with no coordinates still records; it just gets no ring, which beats a
        // ring pinned to the top-left corner of the screen.
        render({ originX: undefined, originY: undefined })

        expect(byTestId('ramble-hold-overlay')).toBeFalsy()
    })

    test('nothing is drawn when it is not visible', () => {
        render({ visible: false })

        expect(byTestId('ramble-hold-overlay')).toBeFalsy()
    })
})

describe('the card says what is happening, away from the thumb', () => {
    test('while recording it shows the elapsed time and how to cancel', () => {
        render({ elapsedLabel: '1:23' })

        const card = byTestId('ramble-hold-card')
        expect(card.textContent).toContain('1:23')
        expect(card.textContent).toContain('Slide away to cancel')
        expect(card.textContent).not.toContain('Release to cancel')
    })

    test('crossing the boundary swaps the instruction and the icon', () => {
        render({ armed: true })

        const card = byTestId('ramble-hold-card')
        expect(card.textContent).toContain('Release to cancel')
        // The mic becomes a bin: the copy alone would be a colour-blind-unfriendly single signal.
        expect(card.querySelector('[data-testid="icon-trash-2"]')).toBeTruthy()
    })

    test('the card changes colour on arming, not just its words', () => {
        render({ armed: false })
        const safeBackground = window.getComputedStyle(byTestId('ramble-hold-card')).backgroundColor

        render({ armed: true })
        const armedBackground = window.getComputedStyle(byTestId('ramble-hold-card')).backgroundColor

        expect(safeBackground).toBeTruthy()
        expect(armedBackground).toBeTruthy()
        expect(armedBackground).not.toBe(safeBackground)
    })

    test('it clears the ring rather than sitting inside it', () => {
        render({ originX: 200, originY: 600 })

        const top = parseFloat(byTestId('ramble-hold-card-row').style.top)
        // Anything inside 600 ± 96 is under the hand that is holding the button.
        expect(top).toBeLessThan(600 - RAMBLE_RING_RADIUS)
    })
})

/**
 * The above/below flip, as arithmetic. jsdom has no layout engine, so the placement can only be
 * proven here — and an off-by-one-inset in this function is the kind of thing that ships and then
 * hides under a Dynamic Island forever.
 */
describe('resolveHoldCardPosition', () => {
    test('a press near the bottom of the screen puts the card above the ring', () => {
        const { placement, top } = resolveHoldCardPosition({ originY: 700, windowHeight: 844 })

        expect(placement).toBe('above')
        expect(top).toBeLessThan(700 - RAMBLE_RING_RADIUS)
    })

    test('a press near the top flips the card below the ring instead of off-screen', () => {
        const { placement, top } = resolveHoldCardPosition({ originY: 90, windowHeight: 844 })

        expect(placement).toBe('below')
        expect(top).toBeGreaterThan(90 + RAMBLE_RING_RADIUS - 1)
    })

    test('the top safe-area inset counts as the top of the screen', () => {
        // A fixed portal does not inherit the body's env(safe-area-inset-*) padding, so without
        // this the card tucks under the status bar / Dynamic Island on exactly the devices where
        // the whole feature is used.
        const withoutInset = resolveHoldCardPosition({ originY: 210, windowHeight: 844 })
        const withInset = resolveHoldCardPosition({ originY: 210, windowHeight: 844, insetTop: 59 })

        expect(withoutInset.placement).toBe('above')
        expect(withInset.placement).toBe('below')
    })

    test('a viewport too short for either side still keeps the card on screen', () => {
        const { top } = resolveHoldCardPosition({ originY: 200, windowHeight: 320, insetTop: 20, insetBottom: 20 })

        expect(top).toBeGreaterThanOrEqual(20)
        expect(top).toBeLessThanOrEqual(320)
    })
})
