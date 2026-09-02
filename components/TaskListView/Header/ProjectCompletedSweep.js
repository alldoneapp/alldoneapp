import React, { useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors, hexColorToRGBa } from '../../styles/global'
import useProjectCompletedSweepMotion from '../OpenTasksView/projectCompletedSweepMotion'

/**
 * AT-2492 (second pass) — the "completed sweep": a brief left-to-right pass of the project's own
 * colour across its header row when that project's today list has just been cleared.
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
 * The cost is that project colours vary in weight, and a pale one has to survive. Hence the two
 * layers rather than one flat tint: a low-alpha WASH carries the fill and a full-strength EDGE
 * carries the motion, so even a colour that almost disappears at 16% alpha still shows a crisp
 * 3px line travelling the row.
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
 *   • the wash needs `transformOrigin: 'left center'` (react-native-web 0.21 forwards it to CSS
 *     `transform-origin`) or it expands from its own middle and stops reading as a direction at all;
 *   • the leading EDGE must sit OUTSIDE the scaled wash and travel by `translateX`, or `scaleX`
 *     squashes it to nothing along with everything else — the whole point of an edge is that it
 *     keeps its shape while the fill behind it grows (the AT-2404 lesson, same mistake available
 *     here);
 *   • the edge's travel is measured (`onLayout`), because `translateX` takes pixels: a percentage
 *     would resolve against the edge's OWN width, not the row's, and park it 44px in.
 */

// The bright line at the front of the sweep.
const EDGE_WIDTH = 3
// A soft ramp behind it, so the edge reads as a glow rather than as a hard divider sliding past.
const EDGE_GLOW_WIDTH = 44
// Low enough that a saturated project colour does not turn the row into a coloured block, high
// enough that a pale one is still visible as a fill.
const WASH_ALPHA = 0.16
const EDGE_GLOW_ALPHA = 0.3

/**
 * @param {number} props.runId 0 for "nothing to celebrate", otherwise the run to play once.
 * @param {string} props.projectId Used only to resolve the project's colour. A primitive is selected
 *   out of `loggedUserProjectsMap` rather than the project object (let alone the map) — the AT-2336
 *   rule: selecting the object would hand every project header a fresh identity on every per-project
 *   write, and this component is mounted once per project on a board that can hold 78 of them.
 */
export default function ProjectCompletedSweep({ runId, projectId }) {
    const projectColor = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.color)
    const { progress, fade, sweeping } = useProjectCompletedSweepMotion(runId)
    const [rowWidth, setRowWidth] = useState(0)

    if (!sweeping) return null

    // A project with no colour yet (mid-load, or a malformed document) still gets a legible sweep
    // rather than a crash inside `hexColorToRGBa`.
    const tint = projectColor || colors.Primary100

    // From fully off the left edge to fully past the right one, so the row is never left with a
    // stray bright line parked at either end.
    const edgeTravel = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-EDGE_GLOW_WIDTH, rowWidth],
        extrapolate: 'clamp',
    })

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
            {/* Held back for the single frame before `onLayout` lands: with `rowWidth` still 0 the
                edge would travel to 0 instead of across the row, which reads as a flicker at the
                left margin. The wash is already drawing, so nothing is missing meanwhile. */}
            {rowWidth > 0 && (
                <Animated.View
                    testID="project-completed-sweep-edge"
                    style={[localStyles.edge, { opacity: fade, transform: [{ translateX: edgeTravel }] }]}
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
            )}
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
        // Keeps the travelling edge from painting outside the row once it reaches the end.
        overflow: 'hidden',
    },
    wash: {
        ...StyleSheet.absoluteFillObject,
        transformOrigin: 'left center',
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
})
