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
 * Four beats, all anchored to that one cell, in the order the eye travels:
 *
 *   • POP — the green fill scales up from nothing through an overshoot and settles. The grey square
 *     it replaces stays painted underneath, so what you watch is the dot being ADDED to the grid
 *     rather than a dot that was always there flashing.
 *   • HALO — a soft pale-green bloom expanding out of the cell and fading. Gives the 11px dot some
 *     presence in a 53-column grid without making it bigger.
 *   • RING + SPARKS — the "acknowledged" ripple and six short ticks flying out, the same vocabulary
 *     as the task checkbox (AT-2404 `TaskCompletionCelebration`), scaled down to this cell.
 *   • STREAK TICK — the "Current streak" number flips to its new value and pops, a beat AFTER the
 *     dot lands so it reads as a consequence of the dot rather than a co-event.
 *
 * Deliberately small and deliberately short (~760ms). The grid is a dense field of 371 squares and
 * this is one of them; anything louder reads as a UI error rather than a reward. Same reasoning as
 * AT-2404's "a 24px box cannot strobe a list".
 */

// The pop. Long enough for the overshoot to be legible on an 11px target, short enough that the
// ring is still expanding when it settles.
export const DOT_LAND_MS = 420
// Halo, ring and sparks share one value so they can never drift apart. Outlives the pop so the cell
// is still rippling once the dot has settled.
export const BURST_DURATION_MS = 620
// The streak number waits for the dot to reach full size before it moves.
export const STREAK_TICK_DELAY_MS = 260
export const STREAK_TICK_MS = 420
// Everything is over by here. A 60ms buffer past the last beat so the settle cannot clip it.
export const CELEBRATION_TOTAL_MS = STREAK_TICK_DELAY_MS + STREAK_TICK_MS + 60

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
    const burst = useRef(new Animated.Value(0)).current
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
            burst.setValue(0)
            tick.setValue(0)
            setCelebrating(false)
            return undefined
        }

        setCelebrating(true)
        land.setValue(0)
        burst.setValue(0)
        tick.setValue(0)

        const animation = Animated.parallel([
            // Linear driver: the pop's shape (overshoot, settle) lives in the interpolation in
            // `EmptyInboxTodayDot`, so it can be re-tuned without touching this sequence.
            Animated.timing(land, {
                toValue: 1,
                duration: DOT_LAND_MS,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
            Animated.timing(burst, {
                toValue: 1,
                duration: BURST_DURATION_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
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
            burst.setValue(0)
            tick.setValue(0)
        }, CELEBRATION_TOTAL_MS)

        return () => {
            clearTimeout(settleTimer)
            animation.stop()
        }
    }, [runId, animated])

    return { land, burst, tick, animated, celebrating }
}
