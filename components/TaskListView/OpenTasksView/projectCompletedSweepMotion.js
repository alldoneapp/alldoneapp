import { useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2492 (second pass) — the motion behind the "completed sweep" a project line plays when that
 * project's today list has just been cleared.
 *
 * THE FIRST PASS threw a confetti burst over the Anna "tasks done" picture. That was replaced for
 * two reasons, and only the first is aesthetic. Confetti belongs to the all-projects empty-inbox
 * moment (AT-2445) and reusing it — even at a smaller tuning — meant the two celebrations could only
 * ever differ in DEGREE, which is exactly the ambiguity the task asks to remove. The second reason
 * is structural: the picture only exists on the selected-project board, so a celebration living on
 * it could never fire in All Projects, which is where clearing a project usually happens.
 *
 * The project LINE exists in both views and is the same 56px `ProjectHeader` row in each, so moving
 * the celebration onto it is what makes one implementation serve both boards.
 *
 * ── ONE VALUE, TWO PHASES ────────────────────────────────────────────────────────────────────────
 *
 * `progress` drives the travel and `fade` drives the exit, and they are strictly SEQUENTIAL
 * (`Animated.sequence`) rather than parallel. That ordering is the whole reason the sweep reads as a
 * completion rather than a shimmer: the edge has to reach the end of the row before anything starts
 * disappearing, or the user sees a highlight fading out somewhere in the middle of the line and the
 * "it got all the way there" statement is lost.
 *
 * Both the wash and the leading edge derive from the SAME `progress` value — the AT-2404 rule, where
 * the task-row wash and its progress bar share one `Animated.Value` precisely so the wash's edge IS
 * the bar's edge. Two values, however carefully tuned, read as two animations that happen to
 * overlap.
 *
 * `Easing.out(Easing.cubic)` on the travel: a confident start and a soft landing. Linear reads
 * mechanical on a single short run, and ease-in would make the row look like it hesitated.
 */

/** The edge crossing the row. Long enough to read as a direction, short enough to never be waited on. */
export const SWEEP_TRAVEL_MS = 620
/** The wash and edge going away once the edge has landed. */
export const SWEEP_FADE_MS = 240
export const SWEEP_TOTAL_MS = SWEEP_TRAVEL_MS + SWEEP_FADE_MS
/**
 * How long `useProjectCompletedSweep` keeps a project line on the board after the board has decided
 * to drop it. Deliberately longer than the run itself: the line must still be there for the last
 * frame, and the two timers are started from different components (this one from the overlay inside
 * `ProjectHeader`, the hold from `OpenTasksByProject`), so they cannot be assumed to fire in order.
 * `projectCompletedSweepMotion.test.js` pins the inequality from this side.
 */
export const PROJECT_LINE_EXIT_HOLD_MS = SWEEP_TOTAL_MS + 120

// A small tail after the run so the settle cannot clip the final frame of the fade.
const SETTLE_BUFFER_MS = 60

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play exactly once.
 * @returns {{progress: Animated.Value, fade: Animated.Value, sweeping: boolean, animated: boolean}}
 *   `sweeping` is the single condition for rendering the overlay: it is false under reduced motion,
 *   false under jest, and false whenever there is nothing to celebrate. A sweep carries no
 *   information a static frame could preserve — the empty list and the project leaving the board
 *   already say the project is done — so standing down means rendering nothing at all rather than
 *   leaving a coloured bar behind.
 */
export default function useProjectCompletedSweepMotion(runId) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [sweeping, setSweeping] = useState(false)
    const progress = useRef(new Animated.Value(0)).current
    const fade = useRef(new Animated.Value(1)).current
    // Play-once, keyed on the run rather than on a boolean: a re-render (and this row re-renders on
    // every task write in the project) must not restart a sweep that is already halfway across.
    const playedRunRef = useRef(0)

    useEffect(() => {
        if (!runId || runId === playedRunRef.current) return undefined
        playedRunRef.current = runId
        if (!animated) return undefined

        progress.setValue(0)
        fade.setValue(1)
        setSweeping(true)

        const animation = Animated.sequence([
            Animated.timing(progress, {
                toValue: 1,
                duration: SWEEP_TRAVEL_MS,
                easing: Easing.out(Easing.cubic),
                // The wash animates `scaleX` and the edge `translateX`, both of which the native
                // driver could take — but `backgroundColor` and the layout measurement below cannot,
                // and mixing drivers across one overlay is what makes two halves of it drift.
                useNativeDriver: false,
            }),
            Animated.timing(fade, {
                toValue: 0,
                duration: SWEEP_FADE_MS,
                easing: Easing.linear,
                useNativeDriver: false,
            }),
        ])
        animation.start()

        // A timer, not the animation's completion callback: this has to unmount the overlay
        // identically on any renderer whose composite never reports finishing. A project line left
        // with a coloured bar across it forever is a far worse failure than a sweep that ends a
        // frame early.
        const settleTimer = setTimeout(() => {
            setSweeping(false)
            progress.setValue(0)
            fade.setValue(1)
        }, SWEEP_TOTAL_MS + SETTLE_BUFFER_MS)

        return () => {
            clearTimeout(settleTimer)
            animation.stop()
        }
    }, [runId, animated, progress, fade])

    return { progress, fade, sweeping: sweeping && animated, animated }
}
