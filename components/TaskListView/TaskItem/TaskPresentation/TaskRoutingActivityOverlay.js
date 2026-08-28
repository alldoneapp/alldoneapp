import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { ROUTING_GLOW_DURATION_MS, ROUTING_BURST_DURATION_MS } from './useTaskRoutingActivity'

/**
 * AT-2381 — the motion layer for a task the server is still classifying, and for one it has just
 * changed. Rendered as an absolutely-positioned, `pointerEvents="none"` sibling INSIDE the row's
 * existing `Animated.View`, exactly like `TaskFileDropZone`'s feedback overlay: nothing about the
 * row's height, layout or hit targets changes, so a task being routed stays fully interactive —
 * you can complete it, drag it, open it or edit it while the sparkle is running.
 *
 * Two states, two very different motion budgets:
 *
 *   - Processing is VARIABLE-LENGTH. It normally runs until a snapshot ends it, with a ten-minute
 *     stale-state backstop owned by `useTaskRoutingActivity`. It can be seconds (a small account)
 *     or considerably longer (a cold function plus a 40-project classification). So it is a CSS
 *     animation — `animationKeyframes`, compiled by react-native-web into a real
 *     `@keyframes` rule and composited by the browser. That costs zero JS per frame, which
 *     matters because the thing it is covering is a list that re-renders on every Firestore
 *     snapshot. A JS-driven loop here would be janking against exactly the work it is waiting for.
 *   - Confirmation is a ONE-SHOT of known length, so it uses `Animated` with `useNativeDriver`,
 *     matching `emptyInboxDotMotion` and the rest of the codebase's celebration idiom.
 *
 * Both stand down entirely under `prefers-reduced-motion` — the badge in the trailing tag area
 * still appears, so the INFORMATION survives while the motion does not. That split is the point:
 * this overlay is decoration, and `TaskRoutingTag` is the message.
 */

/**
 * The sweep is deliberately quiet, and the numbers below are the whole of that decision.
 *
 * The first version of this overlay read as an aggressive dark-blue stripe crossing the row, for
 * two compounding reasons that are worth writing down because neither is visible in the source:
 *
 *   1. `hexColorToRGBa(hex, 0)` does NOT return a transparent colour. Its alpha branch is
 *      `if (alpha)`, so a zero alpha is falsy and it falls through to the OPAQUE `rgb(…)` form.
 *      The gradient therefore compiled to
 *      `linear-gradient(90deg, rgb(0,127,255) 0%, rgba(0,127,255,0.12) 50%, rgb(0,127,255) 100%)`
 *      — a solid #007FFF band with a pale stripe down its middle, i.e. the exact inverse of the
 *      intended shimmer. Nothing warns about this: the value is a valid colour, the gradient
 *      renders, and the code reads as if it says "transparent". `sweepStop` below builds the
 *      stops itself so a zero alpha can never silently become opaque again.
 *   2. Even discounting that, `Primary100` (#007FFF) is the app's saturated action blue. A band
 *      of it passing over a title the user is mid-read competes with the text for attention.
 *
 * So the tint is now taken from `UtilityBlue150`, a colour that is already pale before any alpha
 * is applied — the failure mode of a compositing mistake is then a slightly-too-visible pastel
 * rather than a saturated slab. At `SWEEP_PEAK_ALPHA` it composites over a white row to roughly
 * #E3F1FF: lighter than `UtilityBlue112`, the palette's own quietest informational surface, and
 * well under the `UtilityBlue125` flash `useLastAddedTaskColor` already gives a freshly added
 * task. That ordering is the point — routing can last seconds, so it must sit below an
 * affordance that lasts 600ms.
 */
const SWEEP_TINT_COLOR = colors.UtilityBlue150
const SWEEP_PEAK_ALPHA = 0.3

// Wider, slower and linear, all three for the same reason. A narrow fast band reads as a stripe
// travelling across the row; a wide one drifting at constant speed reads as light moving over it.
// `ease-in-out` — what the loading ghosts use — is actively wrong here: it is slow at the ends of
// the travel, which are OFF the row, and fastest across the middle, which is the part the user
// sees. The travel range parks the band fully clear of both edges, so a little under half of each
// cycle leaves the row completely untouched: the rest between passes is what keeps a
// several-second wait from feeling insistent.
const SWEEP_DURATION = '3.2s'
const SWEEP_TIMING = 'linear'
const SWEEP_WIDTH = '55%'
export const SWEEP_FROM = '-190%'
export const SWEEP_TO = '420%'

/**
 * Builds one gradient colour stop. Deliberately does not go through `hexColorToRGBa` — see the
 * note above; `alpha: 0` there means "opaque".
 */
const sweepStop = alpha => {
    const hex = SWEEP_TINT_COLOR.replace('#', '')
    const [r, g, b] = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
    return `rgba(${r},${g},${b},${alpha})`
}

export const SWEEP_TINT = sweepStop(SWEEP_PEAK_ALPHA)
export const SWEEP_TRANSPARENT = sweepStop(0)

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

function ProcessingSweep() {
    return (
        <View style={localStyles.overlay} pointerEvents="none" testID="task-routing-sweep">
            <Animated.View style={localStyles.sweep} />
        </View>
    )
}

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
                    useNativeDriver: true,
                }),
                Animated.timing(glow, {
                    toValue: 0,
                    duration: ROUTING_GLOW_DURATION_MS - 180,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }),
            ]),
            Animated.timing(burst, {
                toValue: 1,
                duration: ROUTING_BURST_DURATION_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
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
 * @param {object} props
 * @param {null | { subject: string }} props.processing
 * @param {null | { subject: string }} props.confirmation
 */
export default function TaskRoutingActivityOverlay({ processing, confirmation }) {
    const reducedMotion = useReducedMotion()

    if (reducedMotion) return null
    if (confirmation) return <ConfirmationGlow />
    if (processing) return <ProcessingSweep />
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
    sweep: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: SWEEP_WIDTH,
        // `backgroundImage` survives react-native-web's style processing verbatim (the mechanism
        // react-native-web-linear-gradient relies on); under plain react-native it is an unknown
        // key and is simply dropped.
        backgroundImage: `linear-gradient(90deg, ${SWEEP_TRANSPARENT} 0%, ${SWEEP_TINT} 50%, ${SWEEP_TRANSPARENT} 100%)`,
        // NOTE: inside `animationKeyframes` the transform MUST be a CSS string. react-native-web
        // does not run keyframe steps through its transform serializer, so the usual
        // `[{ translateX: … }]` array form stringifies to the literal `transform: [object Object]`
        // — a declaration the browser drops silently, leaving a motionless band and no error
        // anywhere. Same trap documented in `ghostAnimation.js`; keep it a string.
        animationKeyframes: [
            {
                '0%': { transform: `translateX(${SWEEP_FROM})` },
                '100%': { transform: `translateX(${SWEEP_TO})` },
            },
        ],
        animationDuration: SWEEP_DURATION,
        animationIterationCount: 'infinite',
        animationTimingFunction: SWEEP_TIMING,
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
