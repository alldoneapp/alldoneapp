import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2507 — how a goal section LEAVES today's list once the last task under it has been completed.
 *
 * ── IT IS AN EXIT, NOT A CELEBRATION ─────────────────────────────────────────────────────────────
 *
 * The reported problem was that the goal "just pops away", and the answer chosen for it was the
 * quietest one available: no flourish, no colour, no confetti — the block simply stops being there
 * gracefully instead of being deleted between two frames. That is a deliberate ranking decision and
 * it should be preserved. The app already congratulates the user twice within a second at this
 * moment: the task row sweeps green (AT-2404) and, if that task was also the project's last, the
 * project line runs its four-stage coloured sweep and comes apart (AT-2492 / AT-2495). A third
 * celebration wedged between them would not read as a third achievement, it would read as noise. So
 * the goal tier is the ABSENCE of a celebration — it is the one that removes a jarring frame rather
 * than adding a happy one.
 *
 * Practical consequence worth keeping: nothing here is tinted, and no layer is added to the goal
 * row. The whole effect is applied to the section's existing wrapper.
 *
 * ── THE TWO BEATS ────────────────────────────────────────────────────────────────────────────────
 *
 *   1. FADE     (0 → 1180ms, `Easing.in(quad)`) — the block dims. Quadratic-in, so it lingers at
 *                full strength for a beat and then goes: a linear fade over this long reads as the
 *                UI slowly losing its mind, while an ease-out is gone before the eye arrives.
 *                A small upward `translateY` rides the same value, so the block drifts into the gap
 *                it is closing rather than being deleted in place. That lift is derived from the
 *                opacity rather than animated separately — the AT-2404 rule that one gesture should
 *                come from one value.
 *   2. COLLAPSE (380ms → 1400ms, `Easing.inOut(cubic)`) — the height closes, pulling everything
 *                below it up. Deliberately STARTED LATE and FINISHED LAST.
 *
 * The overlap is the whole design, and both halves of it are load-bearing:
 *
 *   • the collapse starts late so the eye reads "this is going" (a fade) before the layout underneath
 *     starts moving. Starting them together makes the list jump while the user is still looking at
 *     the block, which is a busier version of the pop it replaces.
 *   • the fade FINISHES 220ms BEFORE the collapse, so the block is invisible before it is flat.
 *     Fading and shrinking at the same rate reads as a squash — the same lesson AT-2404 records for
 *     the task row's own 320ms exit, scaled up here.
 *
 * ── WHY 1.4 SECONDS IS AFFORDABLE HERE AND NOT ON A TASK ROW ─────────────────────────────────────
 *
 * A task is completed dozens of times an hour, often in bursts while a list is cleared, so its exit
 * has to be short, quiet and repeatable (320ms). A goal section leaves today's list at most a
 * handful of times a day, and only ever because everything scheduled under it is finished. Nothing
 * waits on this either: the Firestore write went out long before — see `useGoalSectionExit` for why
 * the block is still on screen at all — so the only cost is that the gap below the goal closes
 * about a second later than it used to.
 */

/** The block dims. */
export const GOAL_EXIT_FADE_MS = 1180
/** How long the layout underneath is left alone before it starts moving. */
export const GOAL_EXIT_COLLAPSE_DELAY_MS = 380
/** The height closing. */
export const GOAL_EXIT_COLLAPSE_MS = 1020

export const GOAL_SECTION_EXIT_TOTAL_MS = GOAL_EXIT_COLLAPSE_DELAY_MS + GOAL_EXIT_COLLAPSE_MS

/** How far the block drifts up as it goes. Small: this is a departure, not a throw. */
const LIFT_PX = 10

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {number} exitRunId 0 for an ordinary section, otherwise the exit to play exactly once.
 * @returns {{onSectionLayout: Function, sectionStyle: object|undefined, exiting: boolean}}
 *   `sectionStyle` is `undefined` for every section that is not leaving — which is every section on
 *   every other board and every section under reduced motion — so an ordinary goal block carries no
 *   animated wrapper, no `overflow: hidden`, no pinned height and no `pointerEvents` override. It
 *   also carries the input block, rather than that being a separate prop, so there is exactly one
 *   thing for the section to apply and no way to apply half of it.
 */
export default function useGoalSectionExitMotion(exitRunId) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [exiting, setExiting] = useState(false)
    const [exitHeight, setExitHeight] = useState(0)
    const opacity = useRef(new Animated.Value(1)).current
    const height = useRef(new Animated.Value(0)).current

    const measuredHeightRef = useRef(0)
    // Read by the layout handler, which must not be re-created when `exiting` flips: it is passed
    // to `onLayout`, and react-native-web's `useElementLayout` decides ONCE, on mount, whether to
    // observe the node (the AT-2454 lesson). A handler swapped mid-life would simply stop being
    // called.
    const exitingRef = useRef(false)
    const playedRunRef = useRef(0)

    const onSectionLayout = useCallback(event => {
        const measured = event?.nativeEvent?.layout?.height
        // Ignored once the exit owns the height, so the collapse cannot overwrite the value it is
        // collapsing from.
        if (measured > 0 && !exitingRef.current) measuredHeightRef.current = measured
    }, [])

    useEffect(() => {
        if (!exitRunId || exitRunId === playedRunRef.current) return undefined
        /**
         * The `animated` check comes BEFORE the run is marked played, the AT-2492 ordering: marking
         * first meant a run that arrived while motion was unavailable was consumed permanently.
         * `useReducedMotion` answers asynchronously and react-native-web resolves the preference to
         * `true` whenever `window.matchMedia` is missing, so this is reachable on an ordinary load.
         */
        if (!animated) return undefined
        playedRunRef.current = exitRunId

        const measured = measuredHeightRef.current
        exitingRef.current = true
        opacity.setValue(1)
        height.setValue(measured)
        setExitHeight(measured)
        setExiting(true)

        const beats = [
            Animated.timing(opacity, {
                toValue: 0,
                duration: GOAL_EXIT_FADE_MS,
                easing: Easing.in(Easing.quad),
                // `height` cannot be driven natively and the two must stay on one driver, or the
                // fade and the collapse drift apart on exactly the frames where they overlap.
                useNativeDriver: false,
            }),
        ]
        /**
         * A section that has never been laid out (measured height 0) still fades; it just cannot
         * collapse, because animating to 0 from an unknown start would jump. Same carve-out as
         * AT-2404's row exit, and it is what keeps a block that failed to measure from sitting
         * there at full height for the whole hold.
         */
        if (measured > 0) {
            beats.push(
                Animated.sequence([
                    Animated.delay(GOAL_EXIT_COLLAPSE_DELAY_MS),
                    Animated.timing(height, {
                        toValue: 0,
                        duration: GOAL_EXIT_COLLAPSE_MS,
                        easing: Easing.inOut(Easing.cubic),
                        useNativeDriver: false,
                    }),
                ])
            )
        }

        const animation = Animated.parallel(beats)
        animation.start()

        return () => animation.stop()
    }, [exitRunId, animated, opacity, height])

    /**
     * Deliberately NOT reset when the run ends. The section is unmounted by `MainSection` a beat
     * later — that is the whole point of the hold — and putting the block back to full height and
     * full opacity first would flash it into view for a frame before it disappeared, which is worse
     * than the pop this replaces. `useGoalSectionExit` owns the timer that ends the hold, and it is
     * bounded, so a run whose section is somehow never dropped is bounded too.
     */
    const sectionStyle = useMemo(() => {
        if (!exiting) return undefined
        const style = {
            opacity,
            overflow: 'hidden',
            // A block on its way out must not accept a tap: everything in it — the goal row, the
            // add-task line — is about to cease to exist, and it is fading under the pointer. In
            // `style` and not as a prop: react-native-web 0.21 deprecates the prop form and warns.
            pointerEvents: 'none',
            transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [-LIFT_PX, 0] }) }],
        }
        // Only pinned once there is a real measurement to pin it to. `minHeight` has to be cleared
        // with it: a locked goal's section carries a 258-344px floor, and `height` and `minHeight`
        // are independent properties — the floor would win and stop the collapse dead.
        return exitHeight > 0 ? { ...style, height, minHeight: 0 } : style
    }, [exiting, exitHeight, opacity, height])

    return { onSectionLayout, sectionStyle, exiting }
}
