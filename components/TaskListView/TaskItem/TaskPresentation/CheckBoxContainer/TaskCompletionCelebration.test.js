import React from 'react'
import { Animated } from 'react-native'
import renderer from 'react-test-renderer'

import TaskCompletionCelebration, { CHECKBOX_SIZE, SUBTASK_CHECKBOX_SIZE } from './TaskCompletionCelebration'
import { colors } from '../../../../styles/global'

/**
 * AT-2404. The checkbox burst is the beat the first pass of this feature was missing entirely, and
 * it is the one that has to behave under two constraints that pull against each other: be worth
 * looking at, and be safe to fire fifteen times in a row while somebody clears a list. What is
 * pinned here is the second one — that it stays inside the row, never takes a tap, and drops to a
 * single static frame the moment motion is unwelcome.
 */

const render = props =>
    renderer.create(
        <TaskCompletionCelebration
            punch={new Animated.Value(1)}
            burst={new Animated.Value(0)}
            opacity={new Animated.Value(0)}
            animated
            isSubtask={false}
            {...props}
        />
    )

// `deep: false` matters: react-native-web's Animated.View renders a View which renders the host
// element, and the testID rides all the way down — a plain findAllByProps counts each node twice.
const find = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })
const fill = tree => find(tree, 'task-completion-checkbox-fill')[0]
const container = tree => find(tree, 'task-completion-celebration')[0]

/**
 * react-native-web's `StyleSheet.flatten` compiles `transform` down to a CSS string, which throws
 * away the Animated nodes this whole component is made of. Reading the raw style array back is the
 * only way to assert on them.
 */
const rawStyle = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

describe('TaskCompletionCelebration', () => {
    it('never intercepts a tap', () => {
        // The row stays fully completable, draggable and editable while it sparkles — the same rule
        // TaskRoutingActivityOverlay and the title's progress bar already follow.
        expect(container(render()).props.pointerEvents).toBe('none')
    })

    it('draws the ring and every spark from the one burst value', () => {
        const burst = new Animated.Value(0)
        const tree = render({ burst })

        expect(find(tree, 'task-completion-ring')).toHaveLength(1)
        // Six sparks off one shared value: the rotation is a static wrapper and only the travel is
        // animated, so a per-spark animation is never needed and they cannot fall out of step.
        expect(find(tree, 'task-completion-spark')).toHaveLength(6)
    })

    it('keeps the spark travel inside the row', () => {
        // The predecessor here was a random 300px GIF portalled over the middle of the screen. The
        // whole point of this version is that it is a handful of pixels around a 24px box, so it
        // survives being fired repeatedly while a list is cleared — and can never overlap the row
        // above or the task title beside it.
        const burst = new Animated.Value(0)
        const tree = render({ burst })
        const [{ translateY }] = rawStyle(find(tree, 'task-completion-spark')[0]).transform

        expect(Math.abs(translateY.__getValue())).toBeLessThanOrEqual(CHECKBOX_SIZE / 2 + 2)
        burst.setValue(1)
        expect(Math.abs(translateY.__getValue())).toBeLessThan(CHECKBOX_SIZE)
    })

    it('fades every spark out before it stops travelling', () => {
        // A spark that is still fully opaque when the animation ends reads as six little bars that
        // suddenly disappeared, not as a burst.
        const burst = new Animated.Value(1)
        const spark = find(render({ burst }), 'task-completion-spark')[0]

        expect(rawStyle(spark).opacity.__getValue()).toBe(0)
    })

    it('expands the ring out of the checkbox outline and fades it as it goes', () => {
        const burst = new Animated.Value(0)
        const tree = render({ burst })
        const ringStyle = rawStyle(find(tree, 'task-completion-ring')[0])

        // Starts inside the checkbox and finishes well outside it, invisible.
        expect(ringStyle.transform[0].scale.__getValue()).toBeLessThan(1)
        burst.setValue(1)
        expect(ringStyle.transform[0].scale.__getValue()).toBeGreaterThan(1)
        expect(ringStyle.opacity.__getValue()).toBe(0)
    })

    it('uses the saturated brand green on the fill, not the row wash', () => {
        // A 24px target has to carry the moment; the row tint has to survive fifteen of them.
        expect(rawStyle(fill(render())).backgroundColor).toBe(colors.UtilityGreen200)
    })

    it('scales the fill with the checkbox so the two move as one element', () => {
        const punch = new Animated.Value(1)
        expect(rawStyle(fill(render({ punch }))).transform).toEqual([{ scale: punch }])
    })

    it('shares its opacity with the rest of the flourish', () => {
        const opacity = new Animated.Value(0)
        expect(rawStyle(fill(render({ opacity }))).opacity).toBe(opacity)
    })

    it.each([
        ['a task', false, CHECKBOX_SIZE],
        ['a subtask', true, SUBTASK_CHECKBOX_SIZE],
    ])('sizes itself to the checkbox of %s', (_description, isSubtask, expected) => {
        const tree = render({ isSubtask })

        expect(rawStyle(container(tree))).toEqual(expect.objectContaining({ width: expected, height: expected }))
        expect(rawStyle(fill(tree)).width).toBe(expected)
    })

    describe('with motion switched off', () => {
        it('keeps the green check and drops the ring and the sparks', () => {
            const tree = render({ animated: false })

            // The fill says "this is done" and is the layer that carries information. The ring and
            // the sparks are pure motion and carry none, so a reduced-motion user is not shown a
            // frozen frame of them.
            expect(find(tree, 'task-completion-checkbox-fill')).toHaveLength(1)
            expect(find(tree, 'task-completion-ring')).toHaveLength(0)
            expect(find(tree, 'task-completion-spark')).toHaveLength(0)
        })
    })
})
