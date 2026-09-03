import React from 'react'
import { Animated } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskDisintegration from './TaskDisintegration'
import { COLLAPSE_START, DISSOLVE_END, DUST_MOTES, DUST_MOTE_COUNT, buildDustMotes } from './taskRowDisintegration'
import { colors } from '../../../styles/global'

/**
 * AT-2495 — the dust layer.
 *
 * What is asserted here is everything that decides whether this layer can HARM the row it is
 * drawn over: it must not take a tap, must not size anything, must not survive its own run, and
 * must not colour a workflow step advance green. The look itself belongs to
 * `browser-tests/at2495` — jsdom has no layout and `__mocks__/react-native.js` stubs
 * `Animated.timing`, so nothing here can watch a mote actually move.
 */

const render = (props = {}) =>
    renderer.create(<TaskDisintegration progress={new Animated.Value(0)} height={48} {...props} />)

// `deep: false`: react-native-web's Animated.View matches both as the composite and as the host
// View it renders, which silently doubles every count.
const find = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })
const layer = tree => find(tree, 'task-disintegration')[0]
const motes = tree => find(tree, 'task-disintegration-mote')

/**
 * react-native-web's `StyleSheet.flatten` compiles `transform` to a CSS string and throws away the
 * Animated nodes, so the raw style array is the only way to read them back.
 */
const rawStyle = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

describe('TaskDisintegration', () => {
    it('never intercepts a tap', () => {
        // The row underneath is a real task for another second — it stays completable, draggable
        // and editable while it comes apart. Same rule as the checkbox burst and the row wash.
        expect(layer(render()).props.pointerEvents).toBe('none')
    })

    it('takes no space of its own', () => {
        const style = rawStyle(layer(render()))

        expect(style.position).toBe('absolute')
        expect(style.top).toBe(0)
        expect(style.left).toBe(0)
        expect(style.right).toBe(0)
    })

    it('keeps the height the row had when it started leaving', () => {
        // Not a live height. The row underneath is collapsing, and dust that collapsed with it
        // would be clipped off mid-flight.
        expect(rawStyle(layer(render({ height: 62 }))).height).toBe(62)
    })

    it('paints above the row and below the file-drop feedback', () => {
        // The feedback overlay sits at z-index 10 and must still win: a drag in progress is a
        // live interaction, dust is decoration.
        const zIndex = rawStyle(layer(render())).zIndex
        expect(zIndex).toBeGreaterThan(0)
        expect(zIndex).toBeLessThan(10)
    })

    it('draws one mote per column and no more', () => {
        expect(motes(render())).toHaveLength(DUST_MOTE_COUNT)
    })

    it('is neutral, never the completion green', () => {
        // This layer plays for a workflow step advance too — a task handed to the next reviewer,
        // which leaves the list without being finished. Green is what the rest of the sequence
        // reserves for "done", so the dust must not claim it.
        const greens = [
            colors.UtilityGreen100,
            colors.UtilityGreen112,
            colors.UtilityGreen125,
            colors.UtilityGreen150,
            colors.UtilityGreen200,
        ]
        motes(render()).forEach(mote => expect(greens).not.toContain(rawStyle(mote).backgroundColor))
    })

    describe('a mote', () => {
        const progress = new Animated.Value(0)
        const only = buildDustMotes(1)
        const tree = render({ progress, motes: only })
        const mote = motes(tree)[0]
        const style = rawStyle(mote)
        const [{ translateX }, { translateY }, { scale }] = style.transform

        const at = value => {
            act(() => progress.setValue(value))
        }

        it('is not there before the row under it starts coming apart', () => {
            at(0)
            expect(style.opacity.__getValue()).toBe(0)
            at(Math.max(0, only[0].start - 0.01))
            expect(style.opacity.__getValue()).toBe(0)
        })

        it('appears, drifts up and to the right, shrinks and is gone', () => {
            at(only[0].start + (only[0].end - only[0].start) * 0.22)
            expect(style.opacity.__getValue()).toBeCloseTo(only[0].peakOpacity, 5)

            at(only[0].end)
            expect(style.opacity.__getValue()).toBe(0)
            // Up (negative) and to the right (positive): the front travels LEFT, so the dust it
            // frees is left behind to its right.
            expect(translateY.__getValue()).toBeLessThan(0)
            expect(translateX.__getValue()).toBeGreaterThan(0)
            expect(scale.__getValue()).toBeLessThan(1)
        })

        it('does not come back once the run has moved past it', () => {
            // Clamped windows are what let one shared value drive eighteen independent lifetimes.
            at(1)
            expect(style.opacity.__getValue()).toBe(0)
        })

        it('is placed as a fraction of the row, so it scales with any row width', () => {
            expect(style.left).toBe(`${only[0].x * 100}%`)
            expect(style.top).toBe(`${only[0].y * 100}%`)
        })
    })

    it('has finished before the row starts closing the gap', () => {
        // Pinned here as well as in the geometry suite because it is the one cross-layer timing
        // that is invisible when it breaks: the motes are simply clipped, and it looks like the
        // dust merely ended early.
        DUST_MOTES.forEach(mote => {
            expect(mote.start).toBeGreaterThanOrEqual(0)
            expect(mote.end).toBeLessThanOrEqual(COLLAPSE_START)
            // …and every mote is released while the mask is still working, never afterwards.
            expect(mote.start).toBeLessThan(DISSOLVE_END)
        })
    })
})
