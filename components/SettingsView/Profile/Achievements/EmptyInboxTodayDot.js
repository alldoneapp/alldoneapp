import React from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'

/**
 * AT-2418 / AT-2460 — today's cell in the Empty inbox streak grid, while it is being added.
 *
 * Renders in place of the plain `<View>` the other 370 cells use and keeps EXACTLY its layout box
 * (`CELL_SIZE` square plus the trailing `CELL_GAP`), so the grid geometry — which `AchievementsArea`
 * measures to centre itself, see AT-2362 — is untouched whether this cell is celebrating or not.
 * Everything that moves is either a transform or an absolutely-positioned overlay. That invariant
 * is what let AT-2460 make the dot several times its own size without touching the grid at all.
 *
 * Five things here are load-bearing:
 *
 *   • The GREY base stays painted under the green fill. The green is what scales in, so the eye
 *     sees a grey square becoming a green one — the dot being added — instead of a green square
 *     appearing out of the background. Remove the base and the pop reads as a glitch.
 *   • The overlays sit OUTSIDE the scaled fill. A ring nested inside the thing that is scaling from
 *     0 would be squashed to nothing exactly when it is supposed to be expanding (the same trap
 *     AT-2404 documents for the progress bar's leading edge).
 *   • The fill's scale is `land × zoom` (AT-2460). Both rest at their identity — `land` at 1 and
 *     `zoom` at 0, which interpolates to 1 — so a settled cell is still pixel-identical to a plain
 *     achieved one, with no branch anywhere to keep in sync.
 *   • The callout is anchored to the cell's RIGHT edge, not centred on it. Today is the last
 *     achieved column of the grid, so a right-aligned label always hangs back over the grid it
 *     belongs to; a centred one would overhang the card on a narrow screen.
 *   • `zIndex: 1` on the root. Every react-native-web View lands at `zIndex: 0`, so the halo, ring
 *     and swollen dot — which overflow this cell by design — would otherwise paint under the
 *     neighbouring week columns that come after it in document order.
 */

const SPARK_COUNT = 8
const SPARK_LENGTH = 5
const SPARK_THICKNESS = 2
// Well past the cell, because the swollen dot is too. A spark that stops inside the dot it came
// out of is invisible.
const SPARK_TRAVEL = 20
// How many cell widths the dot swells to at the top of its hold. 11px × 4.2 ≈ 46px — big enough to
// be found from the congratulation above it, small enough to stay inside the card's padding.
const ZOOM_SCALE = 4.2
// Clear of the swollen dot (half of 46px) plus a little air.
const CALLOUT_BOTTOM = 32

const CLAMP = { extrapolate: 'clamp' }

/**
 * @param {object} props
 * @param {object} props.celebration The value bundle from `useEmptyInboxDotCelebration`.
 * @param {number} props.size The grid's `CELL_SIZE`.
 * @param {number} props.gap The grid's `CELL_GAP`, paid as this cell's bottom margin.
 * @param {number} props.radius The grid's cell corner radius.
 * @param {string} props.accessibilityLabel Same label the plain achieved cell carries.
 * @param {string} [props.streakLabel] AT-2460 — the short "Day N" badge shown while the dot is
 *   swollen. Absent means no callout, which is what the reduced-motion and settled states render.
 */
export default function EmptyInboxTodayDot({ celebration, size, gap, radius, accessibilityLabel, streakLabel }) {
    const { land, zoom, burst, animated, celebrating } = celebration
    const showsBurst = animated && celebrating

    // `zoom` is optional so that a caller holding an older bundle (or a test double) still renders a
    // correct, unswollen dot rather than crashing on an interpolation of `undefined`.
    const zoomScale = zoom
        ? zoom.interpolate({ inputRange: [0, 0.22, 0.62, 1], outputRange: [1, ZOOM_SCALE, ZOOM_SCALE, 1], ...CLAMP })
        : 1
    const fillScale = land.interpolate({ inputRange: [0, 0.4, 0.7, 1], outputRange: [0, 1.45, 0.92, 1] })

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
                    {/* AT-2460: a soft glow that grows and shrinks WITH the dot, so the swollen dot
                        sits in its own light rather than on the card's flat white. Driven by `zoom`
                        and not by `burst`, which is over long before the hold ends. */}
                    {zoom && (
                        <Animated.View
                            testID="empty-inbox-dot-glow"
                            style={[
                                localStyles.glow,
                                {
                                    borderRadius: size,
                                    opacity: zoom.interpolate({
                                        inputRange: [0, 0.2, 0.62, 1],
                                        outputRange: [0, 0.45, 0.32, 0],
                                        ...CLAMP,
                                    }),
                                    transform: [
                                        {
                                            scale: zoom.interpolate({
                                                inputRange: [0, 0.22, 0.62, 1],
                                                outputRange: [1, ZOOM_SCALE * 1.9, ZOOM_SCALE * 2.1, 1.2],
                                                ...CLAMP,
                                            }),
                                        },
                                    ],
                                },
                            ]}
                        />
                    )}
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
                                    { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.8, 6.4] }) },
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
                                    { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 5.4] }) },
                                ],
                            },
                        ]}
                    />
                    {Array.from({ length: SPARK_COUNT }, (_unused, index) => (
                        <View
                            key={index}
                            // The rotation is on a static wrapper and the travel on the animated
                            // child, so one shared value throws all of them outward along their own
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
                                                // rather than as bars sliding outward.
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
                                // The overshoot is the personality of the landing: past full size,
                                // back under it, then settle. Multiplied by the zoom, which swells
                                // the settled dot out of the grid and puts it back. Both factors
                                // rest at 1, so a cell that is not celebrating renders at exactly
                                // scale 1 and is pixel-identical to the plain achieved cell.
                                scale: zoom ? Animated.multiply(fillScale, zoomScale) : fillScale,
                            },
                        ],
                    },
                ]}
            />

            {/* Last, so it paints over the dot it labels. AT-2460: the streak number in the card
                says the same thing a beat later, and the callout is what ties the two together —
                without it the dot is a shape that grew and the number is a value that changed. */}
            {showsBurst && streakLabel && zoom && (
                <Animated.View
                    testID="empty-inbox-dot-callout"
                    style={[
                        localStyles.calloutAnchor,
                        {
                            bottom: CALLOUT_BOTTOM,
                            opacity: zoom.interpolate({
                                inputRange: [0, 0.2, 0.62, 0.88],
                                outputRange: [0, 1, 1, 0],
                                ...CLAMP,
                            }),
                            transform: [
                                {
                                    translateY: zoom.interpolate({
                                        inputRange: [0, 0.28],
                                        outputRange: [8, 0],
                                        ...CLAMP,
                                    }),
                                },
                            ],
                        },
                    ]}
                >
                    <View style={localStyles.callout}>
                        <Text numberOfLines={1} style={localStyles.calloutText}>
                            {streakLabel}
                        </Text>
                    </View>
                </Animated.View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    cell: {
        alignItems: 'center',
        justifyContent: 'center',
        // See the header note: RNW gives every View `zIndex: 0`, which would let the later week
        // columns paint over this cell's overflowing halo, ring and swollen dot.
        zIndex: 1,
    },
    base: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.Grey200,
    },
    glow: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        backgroundColor: colors.UtilityGreen125,
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
    // A wide, zero-height anchor pinned to this cell's right edge: the pill inside it is laid out
    // right-to-left from the dot, so it can never overhang the card however narrow the grid is.
    calloutAnchor: {
        position: 'absolute',
        right: 0,
        left: -180,
        alignItems: 'flex-end',
        // In style, not as a prop: react-native-web 0.21 deprecates `props.pointerEvents`.
        pointerEvents: 'none',
    },
    callout: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: colors.UtilityGreen200,
    },
    calloutText: {
        ...styles.caption1,
        color: '#FFFFFF',
        lineHeight: 16,
    },
})
