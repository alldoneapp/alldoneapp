import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { DUST_MOTES, DUST_MOTE_PEAK } from './taskRowDisintegration'

/**
 * AT-2495 — the dust that lifts off a disintegrating task row.
 *
 * The erasure itself is a CSS mask on the row node (`taskRowDisintegration.js`); this is the texture
 * on top of it. Without the dust the mask alone reads as a very soft wipe, and without the mask the
 * dust alone reads as decoration floating over an intact row — they are one effect and neither
 * half is worth shipping on its own.
 *
 * THREE things about where this sits are load-bearing:
 *
 *   • It is a SIBLING of the masked row, not a child of it. A child would be erased by the very
 *     mask whose edge it is supposed to be shedding — the dust has to outlive the pixels it came
 *     from, which is the whole idea.
 *   • It is absolutely positioned and `pointerEvents="none"`, so it cannot change the row's height
 *     or swallow a tap on a row that is still, for another second, a real task.
 *   • It does NOT clip its own overflow, so a mote may drift a few pixels above the row. Dust
 *     stopping dead at an invisible line is exactly what gives a particle layer away.
 *
 * Reduced motion never reaches here: `useTaskCompletionMotion` shows a static frame and skips the
 * exit entirely, so there is no decorative layer to suppress.
 *
 * Neutral greys, never the completion green. This layer plays for a workflow step advance too —
 * a task handed to the next reviewer, which leaves the list without being finished — and green is
 * the vocabulary the rest of the sequence reserves for "done".
 */

const DUST_TONES = [colors.Text03, colors.Grey400, colors.Text02]

/**
 * @param {object} props
 * @param {Animated.Value} props.progress 0 -> 1 across the exit, shared with the row's own mask so
 *   a mote can never lift off before or after the front that freed it.
 * @param {number} props.height The row's measured height, frozen when the exit began. The layer
 *   keeps it while the row underneath collapses, rather than collapsing with it.
 */
export default function TaskDisintegration({ progress, height, motes = DUST_MOTES }) {
    return (
        <View style={[localStyles.layer, { height }]} pointerEvents="none" testID="task-disintegration">
            {motes.map(mote => {
                const peak = mote.start + (mote.end - mote.start) * DUST_MOTE_PEAK
                // Every window is clamped, so a mote is simply not there before the front reaches
                // it and does not come back after it has gone. That is what lets one value drive
                // eighteen independent lifetimes.
                const window = (outputRange, inputRange = [mote.start, peak, mote.end]) =>
                    progress.interpolate({ inputRange, outputRange, extrapolate: 'clamp' })

                return (
                    <Animated.View
                        key={mote.key}
                        testID="task-disintegration-mote"
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
        </View>
    )
}

const localStyles = StyleSheet.create({
    layer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        // Above the row it came off, below the file-drop feedback overlay (z-index 10) so a drag
        // in progress still wins.
        zIndex: 1,
    },
    mote: {
        position: 'absolute',
    },
})
