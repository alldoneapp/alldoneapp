import React, { useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors, hexColorToRGBa } from '../../styles/global'
import useProjectCompletedSweepMotion from '../OpenTasksView/projectCompletedSweepMotion'

/**
 * AT-2492 — the "completed sweep": the celebration a project's header row plays when that project's
 * today list has just been cleared.
 *
 * ── WHY THE PROJECT'S COLOUR AND NOT GREEN ───────────────────────────────────────────────────────
 *
 * Green is this app's "done" (AT-2404 fills a completing task's title with `UtilityGreen200`), and
 * that was the obvious candidate. It was declined on Karsten's call, and the reasoning holds up: a
 * task turning green is a statement about THAT TASK, while a project line is an identity — sweeping
 * it in the colour the user already reads as "this project" says "this project is finished" without
 * borrowing the row-level vocabulary of the thing that just happened inside it. It also keeps the
 * two moments distinguishable when they land within a second of each other, which is the ordinary
 * case: the last task goes green, and then its project line sweeps in blue.
 *
 * The cost is that project colours vary in weight, and a pale one has to survive. Hence layering
 * rather than one flat tint: a low-alpha WASH carries the fill while a full-strength EDGE and a
 * full-strength ACCENT carry the structure, so even a colour that almost disappears at 20% alpha
 * still shows a crisp line travelling the row and a crisp bar left under the project name.
 *
 * ── THE FOUR STAGES ──────────────────────────────────────────────────────────────────────────────
 *
 * The timings and the reasoning for staging at all live in `projectCompletedSweepMotion.js`. What
 * each stage DRAWS is here, and the layers map onto the stages one for one:
 *
 *   1. FILL     `progress` → the wash's `scaleX`, the edge's `translateX`, the accent's `scaleX`.
 *   2. SHIMMER  `shimmer`  → the shimmer band's `translateX`.
 *   3. PULSE    `pulse`    → the pulse glow's `opacity` and the accent's `scaleY`.
 *   4. SETTLE   `fade`     → every layer's `opacity`.
 *
 * Two of those layers need no stage gating at all, which is deliberate rather than lucky: the EDGE
 * and the SHIMMER BAND both travel from fully off the left of the row to fully off the right of it,
 * and the overlay clips (`overflow: 'hidden'`). So each is parked outside the row — invisible —
 * before and after its own stage, with no opacity bookkeeping that could get out of step with the
 * sequence. The pulse glow gates itself the same way, by amplitude: its shape maps both ends of
 * `pulse` to 0.
 *
 * ── GEOMETRY ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The overlay is inset to the row's CONTENT band rather than covering the full 56px box, because
 * `ProjectHeader`'s container carries `paddingTop: 25` — a sweep across the whole box would spend
 * its first half washing empty space above the project name. It is absolutely positioned and
 * pointer-transparent, so it adds nothing to layout and can never intercept a tap on the project
 * name, the add-task button or the tags underneath it.
 *
 * Three things are load-bearing and easy to break:
 *
 *   • the wash and the accent need `transformOrigin` pinned to their left edge (react-native-web
 *     0.21 forwards it to CSS `transform-origin`) or they expand from their own middle and stop
 *     reading as a direction at all;
 *   • the leading EDGE must sit OUTSIDE the scaled wash and travel by `translateX`, or `scaleX`
 *     squashes it to nothing along with everything else — the whole point of an edge is that it
 *     keeps its shape while the fill behind it grows (the AT-2404 lesson, same mistake available
 *     here). The shimmer band is a sibling for the same reason;
 *   • both travelling layers are measured (`onLayout`), because `translateX` takes pixels: a
 *     percentage would resolve against the LAYER's own width, not the row's, and park it 44px in.
 */

// The bright line at the front of the fill.
const EDGE_WIDTH = 3
// A soft ramp behind it, so the edge reads as a glow rather than as a hard divider sliding past.
const EDGE_GLOW_WIDTH = 56
// The bar left under the project name once the fill has crossed. Full strength, so a pale project
// colour still has one crisp element after the leading edge has left the row.
const ACCENT_HEIGHT = 2
// Low enough that a saturated project colour does not turn the row into a coloured block, high
// enough that a pale one is still visible as a fill.
const WASH_ALPHA = 0.2
const EDGE_GLOW_ALPHA = 0.34

/**
 * The band of light that glides over the filled row in stage 2. Wide and soft: a narrow hard band
 * reads as a second leading edge chasing the first, which is the one thing this stage must not look
 * like — it is meant to read as light passing over coloured glass, not as another wipe.
 *
 * It is built from five solid stripes rather than a gradient because react-native-web has no
 * first-party gradient primitive here, and a five-stop ramp at these alphas is indistinguishable
 * from one at 180px wide and 36px tall. The alphas are symmetric around a brighter core so the band
 * has no leading or trailing "side" — it is a highlight, not a direction.
 */
const SHIMMER_WIDTH = 180
const SHIMMER_STRIPE_ALPHAS = [0.04, 0.1, 0.2, 0.1, 0.04]

// One breath of colour over the whole band at the end. Kept under the wash's own alpha: the
// confirmation is a change in brightness, not a second fill.
const PULSE_ALPHA = 0.13
// 2px → 4px and back. Large enough to see on a bar that thin, small enough that the row's content
// never appears to move (the accent is inside a clipped overlay and grows upward from the bottom).
const ACCENT_PULSE_SCALE = 2

/**
 * @param {number} props.runId 0 for "nothing to celebrate", otherwise the run to play once.
 * @param {string} props.projectId Used only to resolve the project's colour. A primitive is selected
 *   out of `loggedUserProjectsMap` rather than the project object (let alone the map) — the AT-2336
 *   rule: selecting the object would hand every project header a fresh identity on every per-project
 *   write, and this component is mounted once per project on a board that can hold 78 of them.
 */
export default function ProjectCompletedSweep({ runId, projectId }) {
    const projectColor = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.color)
    const { progress, shimmer, pulse, fade, sweeping } = useProjectCompletedSweepMotion(runId)
    const [rowWidth, setRowWidth] = useState(0)

    if (!sweeping) return null

    // A project with no colour yet (mid-load, or a malformed document) still gets a legible sweep
    // rather than a crash inside `hexColorToRGBa`.
    const tint = projectColor || colors.Primary100

    // From fully off the left edge to fully past the right one, so the row is never left with a
    // stray bright line parked at either end — and so each travelling layer is clipped out of sight
    // outside its own stage without needing to be faded.
    const travelAcrossRow = (value, layerWidth) =>
        value.interpolate({ inputRange: [0, 1], outputRange: [-layerWidth, rowWidth], extrapolate: 'clamp' })

    /**
     * The breath. `pulse` is a normalised clock (0 → 1 over the stage) and this is where its SHAPE
     * lives, so the confirmation can be re-tuned without touching the sequence — the AT-2404
     * convention. Both ends map to 0, which is also what keeps the glow invisible during stages 1
     * and 2 (where `pulse` is still 0) and leaves nothing behind afterwards.
     */
    const pulseAmount = pulse.interpolate({ inputRange: [0, 0.42, 1], outputRange: [0, 1, 0], extrapolate: 'clamp' })

    return (
        <View
            testID="project-completed-sweep"
            // In `style`, not as a prop: react-native-web 0.21 deprecates the prop form and warns.
            style={localStyles.overlay}
            onLayout={event => setRowWidth(event.nativeEvent.layout.width)}
        >
            <Animated.View
                testID="project-completed-sweep-wash"
                style={[
                    localStyles.wash,
                    {
                        backgroundColor: hexColorToRGBa(tint, WASH_ALPHA),
                        opacity: fade,
                        transform: [{ scaleX: progress }],
                    },
                ]}
            />
            <Animated.View
                testID="project-completed-sweep-pulse"
                style={[
                    localStyles.pulse,
                    {
                        backgroundColor: hexColorToRGBa(tint, PULSE_ALPHA),
                        opacity: Animated.multiply(pulseAmount, fade),
                    },
                ]}
            />
            {/* Held back for the single frame before `onLayout` lands: with `rowWidth` still 0 both
                travelling layers would resolve to 0 instead of crossing the row, which reads as a
                flicker at the left margin. The wash is already drawing, so nothing is missing. */}
            {rowWidth > 0 && (
                <>
                    <Animated.View
                        testID="project-completed-sweep-shimmer"
                        style={[
                            localStyles.shimmer,
                            { opacity: fade, transform: [{ translateX: travelAcrossRow(shimmer, SHIMMER_WIDTH) }] },
                        ]}
                    >
                        {SHIMMER_STRIPE_ALPHAS.map((alpha, index) => (
                            <View
                                key={index}
                                testID="project-completed-sweep-shimmer-stripe"
                                style={[localStyles.shimmerStripe, { backgroundColor: hexColorToRGBa(tint, alpha) }]}
                            />
                        ))}
                    </Animated.View>
                    <Animated.View
                        testID="project-completed-sweep-edge"
                        style={[
                            localStyles.edge,
                            { opacity: fade, transform: [{ translateX: travelAcrossRow(progress, EDGE_GLOW_WIDTH) }] },
                        ]}
                    >
                        <View
                            testID="project-completed-sweep-edge-glow"
                            style={[localStyles.edgeGlow, { backgroundColor: hexColorToRGBa(tint, EDGE_GLOW_ALPHA) }]}
                        />
                        <View
                            testID="project-completed-sweep-edge-line"
                            style={[localStyles.edgeLine, { backgroundColor: tint }]}
                        />
                    </Animated.View>
                </>
            )}
            <Animated.View
                testID="project-completed-sweep-accent"
                style={[
                    localStyles.accent,
                    {
                        backgroundColor: tint,
                        opacity: fade,
                        // Draws in with the fill, then thickens once for the confirmation. Two
                        // transforms on one bar rather than two layers, so it can never be caught
                        // half-drawn while it is breathing.
                        transform: [
                            { scaleX: progress },
                            {
                                scaleY: pulseAmount.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, ACCENT_PULSE_SCALE],
                                }),
                            },
                        ],
                    },
                ]}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        pointerEvents: 'none',
        left: 0,
        right: 0,
        // Hugs the 24px content row inside the header's `paddingTop: 25` / `paddingBottom: 6`,
        // leaving the bottom rule visible underneath.
        top: 20,
        bottom: 1,
        borderRadius: 8,
        // Keeps the travelling layers from painting outside the row, and is what parks the edge and
        // the shimmer band out of sight outside their own stages.
        overflow: 'hidden',
    },
    wash: {
        ...StyleSheet.absoluteFillObject,
        transformOrigin: 'left center',
    },
    pulse: {
        ...StyleSheet.absoluteFillObject,
    },
    shimmer: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: SHIMMER_WIDTH,
        flexDirection: 'row',
        alignItems: 'stretch',
    },
    shimmerStripe: {
        flex: 1,
    },
    edge: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: EDGE_GLOW_WIDTH,
        flexDirection: 'row',
        alignItems: 'stretch',
    },
    edgeGlow: {
        flex: 1,
    },
    edgeLine: {
        width: EDGE_WIDTH,
    },
    accent: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: ACCENT_HEIGHT,
        // Grows rightwards with the fill and upwards for the breath, so neither transform can make
        // it drift away from the bottom of the band.
        transformOrigin: 'left bottom',
    },
})
