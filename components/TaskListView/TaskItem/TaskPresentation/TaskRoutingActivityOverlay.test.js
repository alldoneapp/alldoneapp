import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet as WebStyleSheet } from 'react-native-web'
import { createSheet } from 'react-native-web/dist/exports/StyleSheet/dom'

import TaskRoutingActivityOverlay, {
    SWEEP_FROM,
    SWEEP_TINT,
    SWEEP_TO,
    SWEEP_TRANSPARENT,
} from './TaskRoutingActivityOverlay'

// "163,209,255" — the channels of whatever tint the overlay currently uses. Derived rather than
// written out so re-tinting the sweep does not silently stop these assertions from finding the
// rule they are meant to police.
const SWEEP_CHANNELS = SWEEP_TINT.replace(/rgba\(|\)/g, '')
    .split(',')
    .slice(0, 3)
    .join(',')

const render = async element => {
    let tree
    await act(async () => {
        tree = renderer.create(element)
        await Promise.resolve()
    })
    return tree
}

describe('TaskRoutingActivityOverlay', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
    })

    it('renders nothing for a task with no routing activity', async () => {
        const tree = await render(<TaskRoutingActivityOverlay processing={null} confirmation={null} />)

        expect(tree.toJSON()).toBeNull()
    })

    it('sweeps while the server is still deciding', async () => {
        const tree = await render(
            <TaskRoutingActivityOverlay processing={{ subject: 'project' }} confirmation={null} />
        )

        expect(tree.root.findByProps({ testID: 'task-routing-sweep' })).toBeTruthy()
    })

    it('glows once the decision changed the task', async () => {
        const tree = await render(
            <TaskRoutingActivityOverlay processing={null} confirmation={{ subject: 'project' }} />
        )

        expect(tree.root.findByProps({ testID: 'task-routing-glow' })).toBeTruthy()
        expect(tree.root.findAllByProps({ testID: 'task-routing-sweep' })).toHaveLength(0)
    })

    it('stands down completely under reduced motion', async () => {
        // The badge carries the message; this layer is pure decoration, so it is the right thing
        // to drop entirely rather than to slow down.
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const processing = await render(
            <TaskRoutingActivityOverlay processing={{ subject: 'goal' }} confirmation={null} />
        )
        const confirmed = await render(
            <TaskRoutingActivityOverlay processing={null} confirmation={{ subject: 'goal' }} />
        )

        expect(processing.toJSON()).toBeNull()
        expect(confirmed.toJSON()).toBeNull()
    })

    it('never intercepts pointer events on the row it covers', async () => {
        // The single most important property here: a task being classified must stay completable,
        // draggable and editable. An overlay that ate taps would break the row for the seconds it
        // is shown, on exactly the task the user just created and is most likely to act on.
        const tree = await render(
            <TaskRoutingActivityOverlay processing={{ subject: 'project' }} confirmation={null} />
        )

        expect(tree.root.findByProps({ testID: 'task-routing-sweep' }).props.pointerEvents).toBe('none')
    })
})

/**
 * react-native-web compiles `animationKeyframes` at StyleSheet.create time, and a step it cannot
 * serialize is emitted as a declaration the browser silently drops — no warning, no error, just a
 * band that never moves. So assert against the CSS text react-native-web actually produced, the
 * same way `ghostAnimation.test.js` does for the loading ghosts.
 */
describe('routing sweep stylesheet', () => {
    const compiledCss = () => {
        void WebStyleSheet
        return createSheet().getTextContent()
    }

    beforeAll(async () => {
        // Rendering the overlay is what registers its rules in react-native-web's sheet.
        await render(<TaskRoutingActivityOverlay processing={{ subject: 'project' }} confirmation={null} />)
    })

    // The overlay's own gradient, isolated from the loading ghosts' (which register an almost
    // identically shaped rule in the same sheet).
    const sweepGradient = () => {
        const gradients = compiledCss().match(/background-image: linear-gradient\([^;}]+\)/g) || []
        return gradients.find(rule => rule.includes(SWEEP_CHANNELS))
    }

    it('emits a real gradient rather than dropping the property', () => {
        expect(compiledCss()).toContain('background-image: linear-gradient')
        expect(sweepGradient()).toBeTruthy()
    })

    it('emits keyframes that actually move the band across the row', () => {
        const css = compiledCss()

        // The regression this pins: the ordinary react-native transform form
        // `[{ translateX: '-190%' }]` serializes to the literal "[object Object]" inside a
        // keyframe step, which the browser discards.
        expect(css).toContain(`transform: translateX(${SWEEP_FROM})`)
        expect(css).toContain(`transform: translateX(${SWEEP_TO})`)
        expect(css).not.toContain('transform: [object Object]')
    })

    it('fades the band out at both ends instead of ending it on an opaque colour', () => {
        // THE regression that made the first version of this read as an aggressive blue stripe:
        // `hexColorToRGBa(colour, 0)` returns the OPAQUE `rgb(…)` form, because its alpha branch
        // is `if (alpha)` and `0` is falsy. The gradient therefore ran opaque → 12% → opaque: a
        // solid band with a pale middle, the exact inverse of a shimmer. It is invisible in the
        // source (the constant is literally named "transparent") and produces no warning, so it
        // can only be caught here, against the colour that was actually compiled.
        const gradient = sweepGradient()

        expect(SWEEP_TRANSPARENT).toBe(`rgba(${SWEEP_CHANNELS},0)`)
        expect(gradient).not.toMatch(/rgb\(/)
        expect(gradient).toContain(`${SWEEP_TRANSPARENT} 0%`)
        expect(gradient).toContain(`${SWEEP_TRANSPARENT} 100%`)
    })

    it('keeps the band faint enough to stay behind the text it passes over', () => {
        // A ratchet, not a snapshot. The row stays readable and the task stays the subject of the
        // row only while the tint is a wash; this is the number that decides that, and it has
        // already been raised past comfort once.
        const alphas = (sweepGradient().match(/rgba\([^)]*\)/g) || []).map(stop =>
            Number(stop.replace(/rgba\(|\)/g, '').split(',')[3])
        )

        expect(Math.max(...alphas)).toBeLessThanOrEqual(0.3)
    })
})
