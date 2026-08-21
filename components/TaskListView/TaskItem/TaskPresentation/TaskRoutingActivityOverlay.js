import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import { colors, hexColorToRGBa } from '../../../styles/global'
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
 *   - Processing is INDEFINITE. It runs until a snapshot ends it, which can be seconds (a small
 *     account) or considerably longer (a cold function plus a 40-project classification). So it
 *     is a CSS animation — `animationKeyframes`, compiled by react-native-web into a real
 *     `@keyframes` rule and composited by the browser. That costs zero JS per frame, which
 *     matters because the thing it is covering is a list that re-renders on every Firestore
 *     snapshot. A JS-driven loop here would be janking against exactly the work it is waiting for.
 *   - Confirmation is a ONE-SHOT of known length, so it uses `Animated` with `useNativeDriver`,
 *     matching `EmptyInboxDayCelebration` and the rest of the codebase's celebration idiom.
 *
 * Both stand down entirely under `prefers-reduced-motion` — the badge in the leading slot still
 * appears, so the INFORMATION survives while the motion does not. That split is the point: this
 * overlay is decoration, and `TaskRoutingTag` is the message.
 */

// Slower than the ghost shimmer (1.4s). A loading ghost is covering nothing and wants to look
// busy; this band sweeps across a task the user can read and act on, so it has to stay in the
// background of attention rather than pull at it.
const SWEEP_DURATION = '2.2s'
const SWEEP_WIDTH = '45%'
const SWEEP_FROM = '-160%'
const SWEEP_TO = '360%'

// A tint rather than the ghost's near-opaque white: it passes over live text, and washing the
// title out mid-read would be worse than showing nothing.
const SWEEP_TINT = hexColorToRGBa(colors.Primary100, 0.12)
const SWEEP_TRANSPARENT = hexColorToRGBa(colors.Primary100, 0)

// Placed to radiate from the leading slot, where the sparkle badge sits — so the burst reads as
// coming FROM the badge that was just spinning rather than from nowhere.
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
        animationTimingFunction: 'ease-in-out',
    },
    glow: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
    },
    burstOrigin: {
        position: 'absolute',
        // Sits over the leading slot, just right of the checkbox.
        left: 34,
        top: '50%',
        width: 0,
        height: 0,
    },
    burstDot: {
        position: 'absolute',
    },
})
