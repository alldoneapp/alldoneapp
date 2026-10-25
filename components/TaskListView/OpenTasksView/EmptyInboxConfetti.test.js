import React from 'react'
import renderer from 'react-test-renderer'
import { Animated, Dimensions, StyleSheet } from 'react-native'

import EmptyInboxConfetti, {
    CONFETTI_BURST_PIECE_COUNT,
    CONFETTI_PAGE_PIECE_COUNT,
    CONFETTI_PIECE_COUNT,
} from './EmptyInboxConfetti'

/**
 * AT-2460 — the confetti is the beat that makes the empty-inbox moment visible from across a room,
 * and it grew from a burst inside one block to a fall across the whole viewport.
 *
 * What is worth pinning is geometry and safety, not "does it animate": the values are driven by
 * `requestAnimationFrame`, which jest does not advance here, so anything read mid-flight would be
 * whatever it was initialised to. Every assertion below therefore drives the shared value by hand
 * to the frame it wants to inspect, which is the one thing that works identically in jsdom and in
 * a browser.
 */

// jsdom reports a 0×0 window to react-native-web's `Dimensions`, so the geometry below is measured
// against a stated viewport rather than an accidental one — otherwise every piece would be laid out
// at x=0 and the coverage assertions would pass on a completely broken layer.
const VIEWPORT = { width: 1280, height: 800, scale: 1, fontScale: 1 }

const renderConfetti = (confetti, visible = true) =>
    renderer.create(<EmptyInboxConfetti confetti={confetti} visible={visible} />)

const piecesIn = tree => tree.root.findAllByProps({ testID: 'empty-inbox-confetti-piece' }, { deep: false })
const layerPieces = (tree, testID) =>
    tree.root
        .findByProps({ testID }, { deep: false })
        .findAllByProps({ testID: 'empty-inbox-confetti-piece' }, { deep: false })

describe('EmptyInboxConfetti', () => {
    beforeEach(() => {
        jest.spyOn(Dimensions, 'get').mockReturnValue(VIEWPORT)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('renders nothing at all when there is nothing to celebrate', () => {
        // Under reduced motion, under jest and on every ordinary visit to the board. Confetti
        // carries no information a static frame could preserve, so it is not rendered still — it is
        // not rendered.
        const tree = renderConfetti(new Animated.Value(0), false)

        expect(tree.toJSON()).toBeNull()
    })

    it('throws a burst from the headline and rains across the page', () => {
        const tree = renderConfetti(new Animated.Value(0))

        expect(piecesIn(tree)).toHaveLength(CONFETTI_PIECE_COUNT)
        expect(layerPieces(tree, 'empty-inbox-confetti')).toHaveLength(CONFETTI_PAGE_PIECE_COUNT)
        expect(layerPieces(tree, 'empty-inbox-confetti-burst')).toHaveLength(CONFETTI_BURST_PIECE_COUNT)
    })

    /**
     * The page layer's whole justification is that it covers the page. Placing pieces at a free
     * random x reliably leaves a bald stripe somewhere on a wide screen, which reads as the effect
     * being broken rather than as randomness, so they are laid out one per column with a bounded
     * jitter. This asserts the coverage, not the jitter.
     */
    it('spreads the fall across the full width of the viewport', () => {
        const { width } = VIEWPORT
        const tree = renderConfetti(new Animated.Value(0))
        const lefts = layerPieces(tree, 'empty-inbox-confetti')
            .map(piece => StyleSheet.flatten(piece.props.style).left)
            .sort((a, b) => a - b)

        expect(lefts[0]).toBeLessThan(width * 0.1)
        expect(lefts[lefts.length - 1]).toBeGreaterThan(width * 0.85)
        // No gap wider than a couple of columns anywhere across the width.
        const widestGap = lefts.reduce(
            (widest, left, index) => (index === 0 ? widest : Math.max(widest, left - lefts[index - 1])),
            0
        )
        expect(widestGap).toBeLessThan((width / CONFETTI_PAGE_PIECE_COUNT) * 3)
    })

    /**
     * Every piece has to be gone by the last frame. One left resting in the middle of the viewport
     * would be a permanent artefact over the board until the next re-render, because the settle
     * unmounts the layer rather than animating it out.
     */
    it('carries every falling piece past the bottom edge before the run ends', () => {
        const { height } = VIEWPORT
        const confetti = new Animated.Value(1)
        const tree = renderConfetti(confetti)

        layerPieces(tree, 'empty-inbox-confetti').forEach(piece => {
            const style = StyleSheet.flatten(piece.props.style)
            const travelled = style.transform[1].translateY.__getValue()

            expect(style.top + travelled).toBeGreaterThan(height)
            // ...and faded out on the way, so nothing pops out of existence at the edge.
            expect(style.opacity.__getValue()).toBe(0)
        })
    })

    /**
     * The board is subscribed to the task counts and re-renders constantly, including throughout
     * the celebration. A `Math.random()` read during render would put every piece on a fresh
     * trajectory on each of those renders — mid-flight.
     */
    it('keeps every piece on the trajectory it was launched on across re-renders', () => {
        const confetti = new Animated.Value(0.4)
        const tree = renderConfetti(confetti)
        const snapshot = () => piecesIn(tree).map(piece => JSON.stringify(StyleSheet.flatten(piece.props.style)))

        const before = snapshot()
        renderer.act(() => {
            tree.update(<EmptyInboxConfetti confetti={confetti} visible />)
        })

        expect(snapshot()).toEqual(before)
    })
})
