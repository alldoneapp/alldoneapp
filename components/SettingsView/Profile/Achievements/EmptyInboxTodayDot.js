import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'

/**
 * AT-2418 — today's cell in the Empty inbox streak grid, while it is being added.
 *
 * Renders in place of the plain `<View>` the other 370 cells use and keeps EXACTLY its layout box
 * (`CELL_SIZE` square plus the trailing `CELL_GAP`), so the grid geometry — which `AchievementsArea`
 * measures to centre itself, see AT-2362 — is untouched whether this cell is celebrating or not.
 * Everything that moves is either a transform or an absolutely-positioned overlay.
 *
 * Three things here are load-bearing:
 *
 *   • The GREY base stays painted under the green fill. The green is what scales in, so the eye
 *     sees a grey square becoming a green one — the dot being added — instead of a green square
 *     appearing out of the background. Remove the base and the pop reads as a glitch.
 *   • The overlays sit OUTSIDE the scaled fill. A ring nested inside the thing that is scaling from
 *     0 would be squashed to nothing exactly when it is supposed to be expanding (the same trap
 *     AT-2404 documents for the progress bar's leading edge).
 *   • `zIndex: 1` on the root. Every react-native-web View lands at `zIndex: 0`, so the halo and
 *     ring — which overflow this cell by design — would otherwise paint under the neighbouring
 *     week columns that come after it in document order.
 */

const SPARK_COUNT = 6
const SPARK_LENGTH = 4
const SPARK_THICKNESS = 2
// Roughly one cell of travel. Small on purpose: this is an 11px target inside a dense grid.
const SPARK_TRAVEL = 9

/**
 * @param {object} props
 * @param {object} props.celebration The value bundle from `useEmptyInboxDotCelebration`.
 * @param {number} props.size The grid's `CELL_SIZE`.
 * @param {number} props.gap The grid's `CELL_GAP`, paid as this cell's bottom margin.
 * @param {number} props.radius The grid's cell corner radius.
 * @param {string} props.accessibilityLabel Same label the plain achieved cell carries.
 */
export default function EmptyInboxTodayDot({ celebration, size, gap, radius, accessibilityLabel }) {
    const { land, burst, animated, celebrating } = celebration
    const showsBurst = animated && celebrating

    return (
        <View
            testID="empty-inbox-today-dot"
            accessible
            accessibilityLabel={accessibilityLabel}
            style={[localStyles.cell, { width: size, height: size, marginBottom: gap, borderRadius: radius }]}
        >
            <View testID="empty-inbox-dot-base" style={[localStyles.base, { borderRadius: radius }]} />

            {showsBurst && (
                <>
                    <Animated.View
                        testID="empty-inbox-dot-halo"
                        style={[
                            localStyles.halo,
                            {
                                borderRadius: size / 2,
                                opacity: burst.interpolate({
                                    inputRange: [0, 0.15, 1],
                                    outputRange: [0, 0.5, 0],
                                }),
                                transform: [
                                    { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.8, 3.2] }) },
                                ],
                            },
                        ]}
                    />
                    <Animated.View
                        testID="empty-inbox-dot-ring"
                        style={[
                            localStyles.ring,
                            {
                                borderRadius: size / 2,
                                opacity: burst.interpolate({
                                    inputRange: [0, 0.12, 1],
                                    outputRange: [0, 0.6, 0],
                                }),
                                transform: [
                                    { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.6] }) },
                                ],
                            },
                        ]}
                    />
                    {Array.from({ length: SPARK_COUNT }, (_unused, index) => (
                        <View
                            key={index}
                            // The rotation is on a static wrapper and the travel on the animated
                            // child, so one shared value throws all six outward along their own
                            // axes with no per-spark interpolation.
                            style={[
                                localStyles.sparkAxis,
                                { transform: [{ rotate: `${(360 / SPARK_COUNT) * index}deg` }] },
                            ]}
                        >
                            <Animated.View
                                testID="empty-inbox-dot-spark"
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
                                                    outputRange: [-(size / 2 + 1), -(size / 2 + SPARK_TRAVEL)],
                                                }),
                                            },
                                            {
                                                // Tapers as it flies, so the ticks read as sparks
                                                // rather than as six bars sliding outward.
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
                testID="empty-inbox-dot-fill"
                style={[
                    localStyles.fill,
                    {
                        borderRadius: radius,
                        opacity: land.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
                        transform: [
                            {
                                // The overshoot is the whole personality of the beat: past full
                                // size, back under it, then settle. `land` rests at 1, so a cell
                                // that is not celebrating renders this at exactly scale 1 and is
                                // pixel-identical to the plain achieved cell.
                                scale: land.interpolate({
                                    inputRange: [0, 0.4, 0.7, 1],
                                    outputRange: [0, 1.45, 0.92, 1],
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
    cell: {
        alignItems: 'center',
        justifyContent: 'center',
        // See the header note: RNW gives every View `zIndex: 0`, which would let the later week
        // columns paint over this cell's overflowing halo and ring.
        zIndex: 1,
    },
    base: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.Grey200,
    },
    halo: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        backgroundColor: colors.UtilityGreen150,
    },
    ring: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        borderWidth: 1.5,
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
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.UtilityGreen200,
    },
})
