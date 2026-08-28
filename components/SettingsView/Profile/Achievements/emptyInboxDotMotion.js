import { useLayoutEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { translate } from '../../../../i18n/TranslationService'

/**
 * AT-2418 — the motion the Empty inbox card plays when today's green dot is added.
 *
 * What this replaces: a separate banner ("Today counts / +1") that faded in ABOVE the streak grid
 * with a six-dot burst of its own. It was decent motion attached to the wrong element — the thing
 * that actually changes when you reach empty inbox is one 11px square in the grid turning green,
 * and that square simply snapped from grey to green with no motion at all. The banner also pushed
 * the grid down while it was on screen. So the celebration moved onto the dot itself, and the
 * banner is gone.
 *
 * AT-2460 — "the new placement of the green dot should be a bigger deal".
 *
 * The beats below were right and too quiet to find. The whole celebration was ~760ms on an 11px
 * target at the far right of a 53-column grid, and it started at the same instant as the
 * congratulation several blocks above it, so the two competed for the same first half-second and
 * the dot lost. Two things changed, and neither of them makes the dot permanently louder:
 *
 *   • it is STAGED — nothing here starts until the congratulation has had the first half-second to
 *     itself, so the eye arrives at the grid rather than being asked to be in two places at once;
 *   • the dot BALLOONS — it lands, then swells to several times cell size and holds there with a
 *     "Day N" callout before settling into the 11px slot it will occupy for the rest of the year.
 *     A hold is what makes an 11px element findable; scaling it faster would just be a flicker.
 *
 * Six beats, all anchored to that one cell, in the order the eye travels:
 *
 *   • SPOTLIGHT — the achievement card outlines itself in green for the length of the moment, so
 *     there is something to follow from the congratulation down to the grid.
 *   • POP — the green fill scales up from nothing through an overshoot and settles. The grey square
 *     it replaces stays painted underneath, so what you watch is the dot being ADDED to the grid
 *     rather than a dot that was always there flashing.
 *   • HALO + RING + SPARKS — a pale-green bloom, the "acknowledged" ripple and short ticks flying
 *     out, the same vocabulary as the task checkbox (AT-2404 `TaskCompletionCelebration`).
 *   • ZOOM — the dot swells past the grid, holds with its callout, and settles back into the cell.
 *   • STREAK TICK — the "Current streak" number flips to its new value and pops, a beat AFTER the
 *     dot has settled so it reads as a consequence of the dot rather than a co-event.
 *
 * Still ~2.4s and still bounded: every beat is a transform or an overlay, the cell's layout box
 * never changes (the grid measures it to centre itself — AT-2362), and the settle returns the card
 * to something pixel-identical to what a reload paints.
 */

// The congratulation and its confetti own the first half-second. Everything in this file is
// measured from the end of it, so the two halves of the celebration read as one sequence rather
// than as two animations that happen to start together.
export const DOT_START_DELAY_MS = 480
// The pop. Long enough for the overshoot to be legible on an 11px target, short enough that the
// ring is still expanding when it settles.
export const DOT_LAND_MS = 380
// Swell, hold, settle back. The hold is the point of the beat — it is what gives a user time to
// find an 11px cell in a 53-column grid — so this is deliberately the longest single beat here.
export const DOT_ZOOM_MS = 1000
// Halo, ring and sparks share one value so they can never drift apart. Outlives the pop so the cell
// is still rippling once the dot has settled.
export const BURST_DURATION_MS = 900
// The card's green outline. Ends before the run does, so the card is plain again before the last
// beat finishes rather than snapping off at the same instant.
export const SPOTLIGHT_MS = 1900
// The streak number waits for the dot to finish its whole trip — land, swell, settle — before it
// moves, so it reads as the consequence and not as part of the burst.
export const STREAK_TICK_DELAY_MS = DOT_START_DELAY_MS + DOT_LAND_MS + DOT_ZOOM_MS
export const STREAK_TICK_MS = 480
// Everything is over by here. An 80ms buffer past the last beat so the settle cannot clip it.
export const CELEBRATION_TOTAL_MS = STREAK_TICK_DELAY_MS + STREAK_TICK_MS + 80

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * Owns every `Animated.Value` for the celebration, in ONE place, and hands them to the two
 * components that render them (`EmptyInboxTodayDot`, `EmptyInboxStreakValue`). The dot and the
 * streak number are in different subtrees of the card, and the whole point of the sequencing is
 * that they are one event — two independently-driven animations that happen to overlap would read
 * as exactly that.
 *
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play once.
 * @param {number} currentStreak Announced to screen readers; carries no visual role here.
 */
export default function useEmptyInboxDotCelebration(runId, currentStreak) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [celebrating, setCelebrating] = useState(false)

    // Native driver: transform and opacity only.
    const land = useRef(new Animated.Value(1)).current
    // Rests at 0, which every consumer interpolates to "cell size". A cell that is not celebrating
    // therefore renders at exactly its grid size with no special case.
    const zoom = useRef(new Animated.Value(0)).current
    const burst = useRef(new Animated.Value(0)).current
    const spotlight = useRef(new Animated.Value(0)).current
    // NOT native: this one interpolates a colour as well as a scale, and mixing drivers on a single
    // Animated.Value throws at runtime.
    const tick = useRef(new Animated.Value(0)).current

    const settledRunRef = useRef(0)

    useLayoutEffect(() => {
        if (!runId) return undefined

        AccessibilityInfo.announceForAccessibility?.(
            translate('Empty inbox streak day added', { count: currentStreak })
        )
    }, [runId])

    useLayoutEffect(() => {
        // A run is played once. Without this guard the reduced-motion preference resolving mid-run
        // (it arrives from a promise, so it can land after the run has started) would re-enter this
        // effect and replay the whole thing from the top.
        if (!runId || settledRunRef.current === runId) return undefined

        // Reduced motion keeps the INFORMATION and drops the motion: the dot is simply already
        // green and the streak number simply already correct, which is also exactly what a reload
        // renders. There is nothing to animate back down, so there is nothing to schedule either.
        if (!animated) {
            settledRunRef.current = runId
            land.setValue(1)
            zoom.setValue(0)
            burst.setValue(0)
            spotlight.setValue(0)
            tick.setValue(0)
            setCelebrating(false)
            return undefined
        }

        setCelebrating(true)
        land.setValue(0)
        zoom.setValue(0)
        burst.setValue(0)
        spotlight.setValue(0)
        tick.setValue(0)

        const animation = Animated.parallel([
            Animated.sequence([
                // The congratulation goes first. `land` sits at 0 through the delay, i.e. the cell
                // is still the plain grey square it was yesterday — which is exactly right: the
                // dot has not been added yet.
                Animated.delay(DOT_START_DELAY_MS),
                // Linear driver: the pop's shape (overshoot, settle) lives in the interpolation in
                // `EmptyInboxTodayDot`, so it can be re-tuned without touching this sequence.
                Animated.timing(land, {
                    toValue: 1,
                    duration: DOT_LAND_MS,
                    easing: Easing.linear,
                    useNativeDriver: true,
                }),
                // Linear for the same reason: swell / hold / settle is one shape expressed in the
                // consumer's interpolation, so the hold can be lengthened without touching timing.
                Animated.timing(zoom, {
                    toValue: 1,
                    duration: DOT_ZOOM_MS,
                    easing: Easing.linear,
                    useNativeDriver: true,
                }),
            ]),
            Animated.sequence([
                Animated.delay(DOT_START_DELAY_MS),
                Animated.timing(burst, {
                    toValue: 1,
                    duration: BURST_DURATION_MS,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]),
            Animated.sequence([
                Animated.delay(DOT_START_DELAY_MS),
                Animated.timing(spotlight, {
                    toValue: 1,
                    duration: SPOTLIGHT_MS,
                    easing: Easing.linear,
                    useNativeDriver: true,
                }),
            ]),
            Animated.sequence([
                Animated.delay(STREAK_TICK_DELAY_MS),
                Animated.timing(tick, {
                    toValue: 1,
                    duration: STREAK_TICK_MS,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: false,
                }),
            ]),
        ])

        animation.start()

        // A TIMER, not the animation's completion callback. The settle has to happen identically on
        // the animated path, on a renderer whose composite never reports finishing, and on any
        // future path added here — AT-2404 learned this the hard way with a subtask that kept its
        // progress bar forever because one callback never arrived. The cost of being wrong is a
        // ring frozen mid-expansion over the grid.
        const settleTimer = setTimeout(() => {
            settledRunRef.current = runId
            setCelebrating(false)
            land.setValue(1)
            zoom.setValue(0)
            burst.setValue(0)
            spotlight.setValue(0)
            tick.setValue(0)
        }, CELEBRATION_TOTAL_MS)

        return () => {
            clearTimeout(settleTimer)
            animation.stop()
        }
    }, [runId, animated])

    return { land, zoom, burst, spotlight, tick, animated, celebrating }
}
