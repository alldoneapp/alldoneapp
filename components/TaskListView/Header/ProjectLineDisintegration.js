import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../styles/global'
import {
    DUST_MOTES,
    DUST_MOTE_PEAK,
    SPARKS,
    SPARK_END_SCALE,
    SPARK_PEAK,
    SPARK_PEAK_SCALE,
    SPARK_START_SCALE,
} from '../OpenTasksView/projectLineDisintegration'

/**
 * AT-2495 (second pass) — what lifts off a disintegrating PROJECT LINE.
 *
 * The erasure itself is a CSS mask on the row node (`projectLineDisintegration.js`); this is the
 * texture and the flourish on top of it. Without them the mask alone reads as a very soft wipe, and
 * without the mask they read as decoration floating over an intact row — they are one effect and
 * neither half is worth shipping on its own.
 *
 * TWO layers, and they say different things:
 *
 *   • DUST — eighteen small neutral motes, the material the line is made of coming apart. Grey,
 *     never coloured: this is the disintegration, not the celebration.
 *   • SPARKS — nine small four-point twinkles in the project's own colour (every third one gold, so
 *     a pale project colour still reads), which is the "little celebration" the user asked for. They
 *     are struck OFF the same dissolve front the dust comes from, so the celebration is visibly
 *     CAUSED by the line leaving rather than thrown over the top of it.
 *
 * ── WHY THIS IS NOT CONFETTI, AND MUST NOT BECOME IT ──────────────────────────────────────────
 *
 * AT-2492's ranking rule stands: the ALL-PROJECTS empty inbox owns confetti — forty-six pieces,
 * gravity, spin, and a `position: fixed` layer that escapes to the whole viewport so the moment is
 * visible from across a room. Clearing ONE project is the smaller moment and has to stay smaller in
 * KIND, not merely in degree, or the two read as one celebration at two volumes. That is exactly
 * what the first pass of AT-2492 got wrong (a smaller confetti burst) and had to withdraw.
 *
 * So: nothing falls, nothing spins, nothing leaves the row. A spark rises, twinkles once and is
 * gone, inside a `position: absolute` layer bounded to the 56px line. See the celebration section
 * of `projectLineDisintegration.js` for the full list of properties that carry the difference.
 *
 * THREE things about where this sits are load-bearing:
 *
 *   • It is a SIBLING of the masked row, not a child of it. A child would be erased by the very
 *     mask whose edge it is supposed to be shedding — the particles have to outlive the pixels they
 *     came from, which is the whole idea.
 *   • It is absolutely positioned and `pointerEvents: none`, so it cannot change the line's height
 *     or swallow a tap on a header that is still, for another second, a real project line.
 *   • It does NOT clip its own overflow, so a particle may drift a few pixels above the row. Dust
 *     stopping dead at an invisible line is exactly what gives a particle layer away.
 *
 * Reduced motion never reaches here: `useProjectCompletedSweepMotion` stands the whole run down, so
 * there is no decorative layer to suppress and the line simply leaves the way it always did.
 */

const DUST_TONES = [colors.Text03, colors.Grey400, colors.Text02]

/**
 * The highlight worn by every third spark. Gold rather than the app's completion green: green is
 * AT-2404's "this task is done" vocabulary and this is a statement about a project, and gold is the
 * one accent that stays legible next to any project colour — which matters, because the alternative
 * for a pale project is a celebration nobody can see.
 */
const SPARK_HIGHLIGHT = colors.UtilityYellow200

/** How thick a spark's arms are, relative to the star's overall size. */
const SPARK_ARM_RATIO = 0.26
const SPARK_MIN_ARM = 1.4

/**
 * @param {object} props
 * @param {Animated.Value} props.progress 0 -> 1 across the exit, shared with the row's own mask so
 *   a particle can never lift off before or after the front that freed it.
 * @param {number} props.height The line's measured height, frozen when the exit began. The layer
 *   keeps it while the row underneath collapses, rather than collapsing with it.
 * @param {string} props.tint The project's colour, the same one the completed sweep has just
 *   crossed the row in.
 */
export default function ProjectLineDisintegration({ progress, height, tint, motes = DUST_MOTES, sparks = SPARKS }) {
    /**
     * Every window is clamped, so a particle is simply not there before the front reaches it and
     * does not come back after it has gone. That is what lets ONE value drive twenty-seven
     * independent lifetimes without a single extra timer.
     */
    const windowOf = (particle, peakRatio) => (outputRange, inputRange) =>
        progress.interpolate({
            inputRange: inputRange || [
                particle.start,
                particle.start + (particle.end - particle.start) * peakRatio,
                particle.end,
            ],
            outputRange,
            extrapolate: 'clamp',
        })

    return (
        <View style={[localStyles.layer, { height }]} testID="project-line-disintegration">
            {motes.map(mote => {
                const window = windowOf(mote, DUST_MOTE_PEAK)

                return (
                    <Animated.View
                        key={mote.key}
                        testID="project-line-disintegration-mote"
                        style={[
                            localStyles.mote,
                            {
                                left: `${mote.x * 100}%`,
                                top: `${mote.y * 100}%`,
                                width: mote.size,
                                height: mote.size,
                                borderRadius: mote.size / 2,
                                backgroundColor: DUST_TONES[mote.toneIndex % DUST_TONES.length],
                                opacity: window([0, mote.peakOpacity, 0]),
                                transform: [
                                    { translateX: window([0, mote.trail * DUST_MOTE_PEAK, mote.trail]) },
                                    { translateY: window([0, mote.rise * DUST_MOTE_PEAK, mote.rise]) },
                                    // Shrinking as it goes is what stops eighteen identical dots
                                    // reading as a loading indicator.
                                    { scale: window([1, 0.85, 0.3]) },
                                ],
                            },
                        ]}
                    />
                )
            })}
            {sparks.map(spark => {
                const window = windowOf(spark, SPARK_PEAK)
                const color = spark.tinted ? tint : SPARK_HIGHLIGHT
                const arm = Math.max(SPARK_MIN_ARM, spark.size * SPARK_ARM_RATIO)
                const armStyle = { backgroundColor: color, borderRadius: arm / 2 }

                return (
                    <Animated.View
                        key={spark.key}
                        testID="project-line-disintegration-spark"
                        style={[
                            localStyles.spark,
                            {
                                left: `${spark.x * 100}%`,
                                top: `${spark.y * 100}%`,
                                width: spark.size,
                                height: spark.size,
                                // Centred on its own point rather than hung from its top-left, so a
                                // spark grows outward from where the front struck it.
                                marginLeft: -spark.size / 2,
                                marginTop: -spark.size / 2,
                                opacity: window([0, spark.peakOpacity, 0]),
                                transform: [
                                    { translateX: window([0, spark.drift * SPARK_PEAK, spark.drift]) },
                                    { translateY: window([0, spark.rise * SPARK_PEAK, spark.rise]) },
                                    // Grows INTO its brightest frame and then goes — a twinkle,
                                    // where the dust merely shrinks. That difference in shape is
                                    // most of what separates the two layers at this size.
                                    { scale: window([SPARK_START_SCALE, SPARK_PEAK_SCALE, SPARK_END_SCALE]) },
                                ],
                            },
                        ]}
                    >
                        {/* Two crossed bars, not an image or an SVG: a four-point star at 5-9px is
                            two rounded rectangles, and this keeps the whole celebration free of any
                            asset — nothing to license, nothing to load. */}
                        <View
                            testID="project-line-disintegration-spark-arm"
                            style={[
                                localStyles.sparkArmVertical,
                                armStyle,
                                { width: arm, marginLeft: -arm / 2, top: 0, bottom: 0 },
                            ]}
                        />
                        <View
                            testID="project-line-disintegration-spark-arm"
                            style={[
                                localStyles.sparkArmHorizontal,
                                armStyle,
                                { height: arm, marginTop: -arm / 2, left: 0, right: 0 },
                            ]}
                        />
                    </Animated.View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    layer: {
        position: 'absolute',
        // In `style`, not as a prop: react-native-web 0.21 deprecates the prop form and warns.
        pointerEvents: 'none',
        top: 0,
        left: 0,
        right: 0,
        // Above the line it came off. Deliberately a small number: this must never paint over a
        // popover or a modal, and it is gone in 1.2 seconds either way.
        zIndex: 1,
    },
    mote: {
        position: 'absolute',
    },
    spark: {
        position: 'absolute',
    },
    sparkArmVertical: {
        position: 'absolute',
        left: '50%',
    },
    sparkArmHorizontal: {
        position: 'absolute',
        top: '50%',
    },
})
