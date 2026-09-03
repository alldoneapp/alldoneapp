import React from 'react'
import { Animated } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ProjectLineDisintegration from './ProjectLineDisintegration'
import {
    COLLAPSE_START,
    DISSOLVE_END,
    DUST_MOTES,
    DUST_MOTE_COUNT,
    SPARKS,
    SPARK_COUNT,
    SPARK_PEAK,
    buildDustMotes,
    buildSparks,
} from '../OpenTasksView/projectLineDisintegration'
import { colors } from '../../styles/global'

/** The real project header: a 56px content box plus its 1px bottom rule. */
const ROW_HEIGHT = 57
const TINT = '#2F80ED'

/**
 * AT-2495 (second pass) — the particle layer a cleared project's line sheds as it leaves.
 *
 * TWO layers, and the assertions split the same way. The DUST is the disintegration's texture and
 * everything about it is defensive: it must not take a tap, must not size anything, must not survive
 * its own run. The SPARKS are the celebration, and what is asserted about them is that they stay a
 * celebration of the smaller KIND — nine of them, bounded to the row, rising and twinkling rather
 * than falling and spinning, because AT-2492's ranking rule reserves confetti for the all-projects
 * empty inbox.
 *
 * The look itself belongs to `browser-tests/at2495` — jsdom has no layout and
 * `__mocks__/react-native.js` stubs `Animated.timing`, so nothing here can watch a particle move.
 */

const render = (props = {}) =>
    renderer.create(
        <ProjectLineDisintegration progress={new Animated.Value(0)} height={ROW_HEIGHT} tint={TINT} {...props} />
    )

// `deep: false`: react-native-web's Animated.View matches both as the composite and as the host
// View it renders, which silently doubles every count.
const find = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })
const layer = tree => find(tree, 'project-line-disintegration')[0]
const motes = tree => find(tree, 'project-line-disintegration-mote')
const sparks = tree => find(tree, 'project-line-disintegration-spark')
const sparkArms = tree => find(tree, 'project-line-disintegration-spark-arm')

/**
 * react-native-web's `StyleSheet.flatten` compiles `transform` to a CSS string and throws away the
 * Animated nodes, so the raw style array is the only way to read them back.
 */
const rawStyle = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

describe('ProjectLineDisintegration', () => {
    it('never intercepts a tap', () => {
        // The row underneath is a real task for another second — it stays completable, draggable
        // and editable while it comes apart. Same rule as the checkbox burst and the row wash.
        // In `style` rather than as a prop: react-native-web 0.21 deprecates the prop form.
        expect(rawStyle(layer(render())).pointerEvents).toBe('none')
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
        // Green is AT-2404's "this task is done" vocabulary, and this is a statement about a
        // PROJECT — landing within a second of the last task's own green, which is exactly why the
        // two must stay distinguishable. The dust is the material of the row, so it is grey.
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

    describe('the celebration', () => {
        it('draws nine sparks, each a four-point twinkle made of two crossed bars', () => {
            const tree = render()
            expect(sparks(tree)).toHaveLength(SPARK_COUNT)
            // Two bars per spark, and no image or SVG anywhere: the whole celebration is free of
            // any asset — nothing to license, nothing to load.
            expect(sparkArms(tree)).toHaveLength(SPARK_COUNT * 2)
        })

        it('carries the project colour, with a highlight so a pale project still reads', () => {
            const colours = sparkArms(render()).map(arm => rawStyle(arm).backgroundColor)
            expect(colours).toContain(TINT)
            expect(colours.some(colour => colour !== TINT)).toBe(true)
        })

        it('is a sprinkle rather than confetti', () => {
            // AT-2492's ranking rule, asserted where the pieces are actually drawn. The
            // all-projects moment throws 46 pieces across the whole viewport; this is nine inside
            // one 56px row.
            expect(SPARK_COUNT).toBeLessThan(16)
            const tree = render()
            expect(rawStyle(layer(tree)).position).toBe('absolute')
            expect(rawStyle(layer(tree)).height).toBe(ROW_HEIGHT)
        })

        it('twinkles — it grows into its peak, where a mote only ever shrinks', () => {
            const progress = new Animated.Value(0)
            const only = buildSparks(1)
            const tree = renderer.create(
                <ProjectLineDisintegration
                    progress={progress}
                    height={ROW_HEIGHT}
                    tint={TINT}
                    sparks={only}
                    motes={[]}
                />
            )
            const style = rawStyle(sparks(tree)[0])
            const scale = style.transform.find(entry => entry.scale !== undefined).scale
            const at = value => act(() => progress.setValue(value))

            at(only[0].start)
            const born = scale.__getValue()
            at(only[0].start + (only[0].end - only[0].start) * SPARK_PEAK)
            expect(scale.__getValue()).toBeGreaterThan(born)
            expect(style.opacity.__getValue()).toBeCloseTo(only[0].peakOpacity, 5)

            at(only[0].end)
            expect(scale.__getValue()).toBeLessThan(born)
            expect(style.opacity.__getValue()).toBe(0)
            // Up, and it is gone: nothing falls back down the way a confetti piece does.
            const translateY = style.transform.find(entry => entry.translateY !== undefined).translateY
            expect(translateY.__getValue()).toBeLessThan(0)
        })

        it('is centred on the point the front struck, not hung from its corner', () => {
            const only = buildSparks(1)
            const style = rawStyle(sparks(render({ sparks: only, motes: [] }))[0])
            expect(style.marginLeft).toBe(-only[0].size / 2)
            expect(style.marginTop).toBe(-only[0].size / 2)
        })

        it('leaves nothing behind once the run is over', () => {
            const progress = new Animated.Value(1)
            const tree = render({ progress })
            sparks(tree).forEach(spark => expect(rawStyle(spark).opacity.__getValue()).toBe(0))
            motes(tree).forEach(mote => expect(rawStyle(mote).opacity.__getValue()).toBe(0))
        })
    })

    it('has finished before the row starts closing the gap', () => {
        // Pinned here as well as in the geometry suite because it is the one cross-layer timing
        // that is invisible when it breaks: the motes are simply clipped, and it looks like the
        // dust merely ended early.
        ;[...DUST_MOTES, ...SPARKS].forEach(particle => {
            expect(particle.start).toBeGreaterThanOrEqual(0)
            expect(particle.end).toBeLessThanOrEqual(COLLAPSE_START)
            // …and every particle is released while the mask is still working, never afterwards.
            expect(particle.start).toBeLessThan(DISSOLVE_END)
        })
    })
})
