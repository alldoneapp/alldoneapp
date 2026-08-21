import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet as WebStyleSheet } from 'react-native-web'
import { createSheet } from 'react-native-web/dist/exports/StyleSheet/dom'

import TaskRoutingActivityOverlay from './TaskRoutingActivityOverlay'

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

    it('emits a real gradient rather than dropping the property', () => {
        expect(compiledCss()).toContain('background-image: linear-gradient')
    })

    it('emits keyframes that actually move the band across the row', () => {
        const css = compiledCss()

        // The regression this pins: the ordinary react-native transform form
        // `[{ translateX: '-160%' }]` serializes to the literal "[object Object]" inside a
        // keyframe step, which the browser discards.
        expect(css).toContain('transform: translateX(-160%)')
        expect(css).toContain('transform: translateX(360%)')
        expect(css).not.toContain('transform: [object Object]')
    })
})
