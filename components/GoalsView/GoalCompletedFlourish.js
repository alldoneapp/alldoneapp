import React from 'react'
import { Animated, StyleSheet } from 'react-native'

import { colors, hexColorToRGBa } from '../styles/global'
import useGoalCompletedFlourishMotion from '../TaskListView/OpenTasksView/goalCompletedFlourishMotion'

/**
 * AT-2507 — what the goal row DRAWS when the last of its tasks for the day is completed.
 *
 * The timings, the beats and the argument for keeping this the smallest celebration in the app live
 * in `goalCompletedFlourishMotion.js`. What each beat paints is here, and the layers map onto the
 * beats one for one:
 *
 *   1. FILL  `progress` → the bar's `scaleX`, and the wash's `opacity`.
 *   2. PULSE `pulse`    → the bar's `scaleY` and the wash's brightness.
 *   3. FADE  `fade`     → both layers' `opacity`.
 *
 * ── WHY THE GOAL'S OWN ACCENT COLOUR ─────────────────────────────────────────────────────────────
 *
 * `accentColor` is the very colour the row's real `GoalProgressBar` is already painted in — the
 * goal's star colour when it is highlighted, otherwise the project's `PROJECT_ITEM_ACTIVE`. Green
 * was declined for the same reason it was declined for the project line (AT-2492): green is this
 * app's statement about a TASK being done, and it lands on the task row a beat earlier. Reusing it
 * here would make the two moments read as one, and the goal's own colour says "this goal" without
 * borrowing the row-level vocabulary of the thing that just happened inside it.
 *
 * ── WHY A SEPARATE BAR AND NOT THE REAL PROGRESS BAR ─────────────────────────────────────────────
 *
 * The obvious idea — glide the row's existing `GoalProgressBar` to 100% — is a lie, and a visible
 * one. That bar shows the GOAL's overall progress, and finishing everything a goal had scheduled
 * for TODAY very rarely finishes the goal. Worse, a cleared goal usually stays on the board (as an
 * `EmptyGoal` with its add-task line), so the bar would snap back to its true width a second later:
 * the user would watch it claim 100% and then take it back. This is a transient overlay instead,
 * drawn along the card's bottom edge, and the real progress bar underneath is never touched.
 *
 * ── GEOMETRY ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Absolutely positioned and pointer-transparent, so it adds nothing to layout and can never
 * intercept a tap on the goal name, its tags or its swipe. It matches the card's own `borderRadius:
 * 4` and clips, so the bar cannot paint outside the rounded corners.
 *
 * Two things are load-bearing and easy to break: the bar needs `transformOrigin` pinned to its left
 * edge (react-native-web 0.21 forwards it to CSS `transform-origin`) or it grows out of its own
 * middle and stops reading as progress at all — the AT-2404 lesson, available to make again here —
 * and the thickening `scaleY` needs the same origin pinned to the BOTTOM, or the bar drifts off the
 * card's edge as it breathes.
 */

/** Slim on purpose: this is a hint at the bottom of a card, not a control. */
const BAR_HEIGHT = 2
/** 2px → 4px and back. Visible on a bar this thin without the card's content appearing to move. */
const BAR_PULSE_SCALE = 2
/**
 * The wash's PEAK tint, reached at the top of the breath. Low enough that a saturated project
 * colour does not turn the card into a coloured block — the goal name has to stay comfortably
 * readable through it — and high enough that a pale one still reads as a tint.
 */
const WASH_ALPHA = 0.12
/**
 * Where the fill leaves the wash, as a fraction of that peak. The remainder is the breath's, and
 * that split is the point: an earlier version had the fill take the wash all the way to opacity 1
 * and the breath ADD to it, which the browser simply clamps — so the confirmation was a no-op on
 * this layer and only the bar carried it. Verified frame by frame in `browser-tests/at2507`, which
 * is the only place a clamped opacity is observable at all.
 */
const WASH_FILL_OPACITY = 0.75

/**
 * The run is owned HERE rather than by the row, unlike `ProjectCompletedSweep` where `ProjectHeader`
 * holds it. Two reasons: nothing else on a goal row needs the animated values (the project's run
 * also drives a mask applied to the whole row, which a child cannot apply to its parent), and
 * `GoalItemPresentation` is a class component, so a hook cannot live there at all.
 *
 * @param {number} props.completedRunId 0 for an ordinary row — which is every goal row on the goals
 *   board, in every non-today date section, and on anyone else's board.
 * @param {string} props.accentColor The goal row's own accent — the colour its real progress bar
 *   uses. Already resolved by `GoalItemPresentation`, so this component never touches redux and a
 *   board holding dozens of goal rows pays nothing for it.
 */
export default function GoalCompletedFlourish({ completedRunId, accentColor }) {
    const { progress, pulse, fade, flourishing } = useGoalCompletedFlourishMotion(completedRunId)

    if (!flourishing) return null

    // A goal whose colour has not resolved yet still gets a legible flourish rather than a crash
    // inside `hexColorToRGBa`.
    const tint = accentColor || colors.Primary100

    /**
     * The breath. `pulse` is a normalised clock (0 → 1 over the beat) and this is where its SHAPE
     * lives, so the confirmation can be re-tuned without touching the sequence — the AT-2404
     * convention. Both ends map to 0, which is also what keeps it invisible during the fill (where
     * `pulse` is still 0) and leaves nothing behind afterwards.
     */
    const pulseAmount = pulse.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 1, 0], extrapolate: 'clamp' })

    return (
        <Animated.View testID="goal-completed-flourish" style={[localStyles.overlay, { opacity: fade }]}>
            <Animated.View
                testID="goal-completed-flourish-wash"
                style={[
                    localStyles.wash,
                    {
                        backgroundColor: hexColorToRGBa(tint, WASH_ALPHA),
                        // Fades in WITH the bar rather than being scaled by it: a wash that grew
                        // from the left would be a second, blunter copy of the bar's own gesture.
                        // The fill stops short of full so the breath has somewhere to go — see
                        // `WASH_FILL_OPACITY`. The two terms sum to exactly 1 at the peak, so this
                        // can never saturate and lose the confirmation.
                        opacity: Animated.add(
                            progress.interpolate({ inputRange: [0, 1], outputRange: [0, WASH_FILL_OPACITY] }),
                            pulseAmount.interpolate({ inputRange: [0, 1], outputRange: [0, 1 - WASH_FILL_OPACITY] })
                        ),
                    },
                ]}
            />
            <Animated.View
                testID="goal-completed-flourish-bar"
                style={[
                    localStyles.bar,
                    {
                        backgroundColor: tint,
                        // Draws in with the fill, then thickens once for the confirmation. Two
                        // transforms on one bar rather than two layers, so it can never be caught
                        // half-drawn while it is breathing.
                        transform: [
                            { scaleX: progress },
                            {
                                scaleY: pulseAmount.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, BAR_PULSE_SCALE],
                                }),
                            },
                        ],
                    },
                ]}
            />
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        pointerEvents: 'none',
        // Matches the card's own `borderInside` radius, and clips the bar to it.
        borderRadius: 4,
        overflow: 'hidden',
    },
    wash: {
        ...StyleSheet.absoluteFillObject,
    },
    bar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: BAR_HEIGHT,
        // Grows rightwards with the fill and upwards for the breath, so neither transform can make
        // it drift away from the bottom edge of the card.
        transformOrigin: 'left bottom',
    },
})
