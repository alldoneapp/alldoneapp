import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import Icon from '../../../../Icon'
import { colors } from '../../../../styles/global'

/**
 * AT-2404 — what the checkbox does when you tick a task.
 *
 * The first pass of this feature animated the title and the row and left the checkbox alone, so the
 * one element the user actually touched simply flipped from a white square to a flat grey one. That
 * is where the eye is at t=0, and it was the flattest thing on screen.
 *
 * Three layers, all anchored to the checkbox and all `pointerEvents="none"`:
 *
 *   • FILL — a green tile with a white check laid OVER the real checkbox. Deliberately an overlay
 *     rather than a restyle of `CheckBox`: the persistent done state (grey `Text03`) is used by done
 *     lists, the Done tab and every already-completed subtask, and it is not this animation's to
 *     change. An overlay means there is nothing to unwind — it fades out on a retained row and is
 *     simply gone with the row on a collapsing one.
 *   • RING — the checkbox outline expanding away and fading, the standard "acknowledged" ripple.
 *   • SPARKS — six short ticks flying out radially. This is the celebratory beat, and it is
 *     deliberately SMALL and LOCAL: eight-ish pixels of travel around a 24px box. The predecessor
 *     here was a random 300px Giphy GIF portalled over the middle of the screen on every single
 *     completion, which is precisely the gimmick to avoid — a burst you can see while clearing a
 *     list of fifteen tasks has to live inside the row.
 *
 * Reduced motion (and jest) render the FILL only: it is the layer that carries information ("this
 * is done"), while the ring and the sparks are pure motion and carry none.
 */

const SPARK_COUNT = 6
const SPARK_LENGTH = 5
const SPARK_THICKNESS = 2
// How far a spark's tail ends up from the checkbox edge. Small on purpose — see above.
const SPARK_TRAVEL = 11

export const CHECKBOX_SIZE = 24
export const SUBTASK_CHECKBOX_SIZE = 20

/**
 * @param {object} props
 * @param {Animated.Value} props.punch 1 → 0.84 → overshoot → 1. Applied by the CALLER to the real
 *   checkbox, not here; exported through the same object so the two can never be wired up apart.
 * @param {Animated.Value} props.burst 0 → 1 over the burst duration. Drives ring and sparks.
 * @param {Animated.Value} props.opacity 0 → 1, and back to 0 when a retained row releases. Shared
 *   with the row wash and the strike so every green thing arrives and leaves as one event.
 * @param {boolean} props.animated False under `prefers-reduced-motion` and under jest.
 * @param {boolean} props.isSubtask Subtask checkboxes are 20px, not 24px.
 */
export default function TaskCompletionCelebration({ punch, burst, opacity, animated, isSubtask }) {
    const size = isSubtask ? SUBTASK_CHECKBOX_SIZE : CHECKBOX_SIZE
    const radius = size / 2

    return (
        <View
            testID="task-completion-celebration"
            style={[localStyles.container, { width: size, height: size }]}
            pointerEvents="none"
        >
            {animated && (
                <>
                    <Animated.View
                        testID="task-completion-ring"
                        style={[
                            localStyles.ring,
                            {
                                width: size,
                                height: size,
                                borderRadius: radius,
                                opacity: burst.interpolate({
                                    inputRange: [0, 0.12, 1],
                                    outputRange: [0, 0.55, 0],
                                }),
                                transform: [
                                    {
                                        scale: burst.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.6, 2.35],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    />
                    {Array.from({ length: SPARK_COUNT }, (_unused, index) => (
                        <View
                            key={index}
                            // The rotation lives on a static wrapper and the travel on the animated
                            // child, so one shared value throws all six outward along their own
                            // axes without needing a per-spark interpolation.
                            style={[
                                localStyles.sparkAxis,
                                { transform: [{ rotate: `${(360 / SPARK_COUNT) * index}deg` }] },
                            ]}
                        >
                            <Animated.View
                                testID="task-completion-spark"
                                style={[
                                    localStyles.spark,
                                    {
                                        opacity: burst.interpolate({
                                            inputRange: [0, 0.15, 0.55, 1],
                                            outputRange: [0, 1, 0.9, 0],
                                        }),
                                        transform: [
                                            {
                                                translateY: burst.interpolate({
                                                    inputRange: [0, 1],
                                                    outputRange: [-(radius + 1), -(radius + SPARK_TRAVEL)],
                                                }),
                                            },
                                            {
                                                // Tapers as it flies, so the ticks read as sparks
                                                // rather than as six little bars sliding outward.
                                                scaleY: burst.interpolate({
                                                    inputRange: [0, 0.5, 1],
                                                    outputRange: [0.7, 1, 0.35],
                                                }),
                                            },
                                        ],
                                    },
                                ]}
                            />
                        </View>
                    ))}
                </>
            )}
            <Animated.View
                testID="task-completion-checkbox-fill"
                style={[
                    localStyles.fill,
                    {
                        width: size,
                        height: size,
                        opacity,
                        transform: [{ scale: punch }],
                    },
                ]}
            >
                <Icon size={isSubtask ? 14 : 16} name="check" color="white" />
            </Animated.View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    // Sits exactly on top of the checkbox, which is the first child of the same TouchableOpacity.
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ring: {
        position: 'absolute',
        borderWidth: 2,
        borderColor: colors.UtilityGreen200,
    },
    sparkAxis: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    spark: {
        width: SPARK_THICKNESS,
        height: SPARK_LENGTH,
        borderRadius: SPARK_THICKNESS / 2,
        backgroundColor: colors.UtilityGreen200,
    },
    fill: {
        position: 'absolute',
        borderRadius: 4,
        // The saturated brand green, not the pale wash the row gets: this is a 24px target and it
        // has to carry the moment, while the row tint has to survive fifteen of them in a row.
        backgroundColor: colors.UtilityGreen200,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
