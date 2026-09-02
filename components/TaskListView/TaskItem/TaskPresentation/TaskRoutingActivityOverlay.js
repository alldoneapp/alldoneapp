import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { ROUTING_GLOW_DURATION_MS, ROUTING_BURST_DURATION_MS } from './useTaskRoutingActivity'

/**
 * AT-2381 — the motion layer for a task the server has just re-homed. Rendered as an
 * absolutely-positioned, `pointerEvents="none"` sibling INSIDE the row's existing `Animated.View`,
 * exactly like `TaskFileDropZone`'s feedback overlay: nothing about the row's height, layout or hit
 * targets changes, so a task being routed stays fully interactive — you can complete it, drag it,
 * open it or edit it while the confirmation plays.
 *
 * AT-2453 follow-up — this layer used to have a SECOND state: a pale band that swept across the row
 * for as long as the classifier was deciding. It is gone, and the deletion is the point rather than
 * a simplification. The confirmation is a one-shot of known length (~1.8s) that marks a thing which
 * actually happened; the sweep was an INDEFINITE loop — normally seconds, but bounded only by
 * `useTaskRoutingActivity`'s ten-minute stale-state backstop — running across the title of the task
 * the user had just typed and was most likely still reading. Motion at the row level is a claim on
 * attention, and "we are thinking" does not earn one every time a task is created. The state it
 * reported is not lost: `TaskRoutingTag` now says `project?` / `goal?` in the trailing tag area,
 * which is more specific than the sweep ever was and costs the row nothing.
 *
 * What remains is a ONE-SHOT, so it uses `Animated` with `useNativeDriver`, matching
 * `emptyInboxDotMotion` and the rest of the codebase's celebration idiom. It stands down entirely
 * under `prefers-reduced-motion` — the badge in the trailing tag area still appears, so the
 * INFORMATION survives while the motion does not. That split is the point: this overlay is
 * decoration, and `TaskRoutingTag` is the message.
 */

// Radiates from the row's leading edge, just right of the checkbox. AT-2453 moved the badge itself
// into the trailing tag area and deliberately left this where it is: the burst is a one-shot
// celebration for the WHOLE row (it plays over the row-wide green glow, not over the chip), and
// anchoring it to the right-hand tags would fire it into the crowded corner the tags already
// occupy, where the dots have nowhere to travel and read as clipped rather than as a burst.
const BURST_DOTS = [
    { x: -9, y: -13, size: 4, color: colors.UtilityGreen200 },
    { x: 10, y: -15, size: 3, color: colors.UtilityBlue200 },
    { x: 20, y: -3, size: 4, color: colors.UtilityGreen150 },
    { x: 15, y: 12, size: 3, color: colors.UtilityBlue150 },
    { x: -7, y: 14, size: 3.5, color: colors.UtilityGreen200 },
    { x: -18, y: 2, size: 3, color: colors.UtilityGreen125 },
]

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

function ConfirmationGlow() {
    const glow = useRef(new Animated.Value(0)).current
    const burst = useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (animationsAreDisabled()) {
            glow.setValue(0)
            burst.setValue(0)
            return undefined
        }

        glow.setValue(0)
        burst.setValue(0)

        const animation = Animated.parallel([
            // Rises fast and falls slowly. A symmetric fade reads as a flicker; an asymmetric one
            // reads as something landing and settling, which is what actually happened.
            Animated.sequence([
                Animated.timing(glow, {
                    toValue: 1,
                    duration: 180,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: false,
                }),
                Animated.timing(glow, {
                    toValue: 0,
                    duration: ROUTING_GLOW_DURATION_MS - 180,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: false,
                }),
            ]),
            Animated.timing(burst, {
                toValue: 1,
                duration: ROUTING_BURST_DURATION_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }),
        ])

        animation.start()
        return () => animation.stop()
    }, [glow, burst])

    const dotOpacity = burst.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 0.75, 0] })

    return (
        <View style={localStyles.overlay} pointerEvents="none" testID="task-routing-glow">
            <Animated.View style={[localStyles.glow, { opacity: glow }]} />
            <View style={localStyles.burstOrigin}>
                {BURST_DOTS.map((dot, index) => {
                    const translateX = burst.interpolate({ inputRange: [0, 1], outputRange: [0, dot.x] })
                    const translateY = burst.interpolate({ inputRange: [0, 1], outputRange: [0, dot.y] })
                    const scale = burst.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.3, 1, 0.45] })

                    return (
                        <Animated.View
                            key={index}
                            style={[
                                localStyles.burstDot,
                                {
                                    width: dot.size,
                                    height: dot.size,
                                    borderRadius: dot.size / 2,
                                    backgroundColor: dot.color,
                                    opacity: dotOpacity,
                                    transform: [{ translateX }, { translateY }, { scale }],
                                },
                            ]}
                        />
                    )
                })}
            </View>
        </View>
    )
}

/**
 * Reads the reduced-motion preference itself rather than taking it as a prop. `useReducedMotion`
 * costs a `matchMedia` listener per call, and the task row only mounts this component when there
 * is actually something to animate — so the subscription exists for the handful of rows being
 * routed rather than for every row in the list.
 *
 * Takes only `confirmation` since AT-2453: there is no longer any in-progress motion for it to
 * render, and the row mounts it only when a confirmation exists.
 *
 * @param {object} props
 * @param {null | { subject: string }} props.confirmation
 */
export default function TaskRoutingActivityOverlay({ confirmation }) {
    const reducedMotion = useReducedMotion()

    if (reducedMotion) return null
    if (confirmation) return <ConfirmationGlow />
    return null
}

const localStyles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        // Matches `taskPresentationLayout.taskRow`'s radius so neither the sweep nor the glow
        // squares off the row's rounded corners.
        borderRadius: 4,
        overflow: 'hidden',
    },
    glow: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
    },
    burstOrigin: {
        position: 'absolute',
        // Sits over the row's leading edge, just right of the checkbox. See BURST_DOTS above for
        // why this stayed put when the badge moved to the trailing tags.
        left: 34,
        top: '50%',
        width: 0,
        height: 0,
    },
    burstDot: {
        position: 'absolute',
    },
})
