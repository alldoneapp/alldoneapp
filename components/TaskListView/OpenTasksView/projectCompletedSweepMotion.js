import { useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2492 — the motion behind the "completed sweep" a project line plays when that project's today
 * list has just been cleared.
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
 * ── THE THIRD PASS: FOUR STAGES, ~2.8s ───────────────────────────────────────────────────────────
 *
 * The second pass shipped as a single 860ms pass (620 travel + 240 fade) and reached production, and
 * Karsten's verdict was that it works but is over before it registers: "make it more celebratory and
 * maybe up to 3 seconds long". A single gesture cannot be stretched to three seconds — a 2.5s fill
 * across a 900px row reads as a stuck progress bar, not as a celebration — so the extra time buys
 * STAGES rather than a slower sweep. Each one is a separate statement, and they run strictly in
 * sequence so the row is never doing two things at once:
 *
 *   1. FILL     (820ms) — the project's colour crosses the row behind a bright leading edge, and a
 *                         2px accent bar draws in along the bottom of the band. This is the second
 *                         pass's sweep, ~30% slower and brighter, and it is still the sentence:
 *                         "this project got all the way there".
 *   2. SHIMMER  (760ms) — a brighter band of the same colour glides across the now-filled row, like
 *                         light passing over coloured glass. It is what makes the row read as
 *                         FINISHED rather than merely tinted, and it is the beat the previous pass
 *                         had no room for.
 *   3. PULSE    (540ms) — the whole band brightens once and eases back while the accent bar
 *                         thickens: one breath, the confirmation. Deliberately AFTER the shimmer,
 *                         never overlapping it — a confirmation that lands on top of the thing it is
 *                         confirming reads as a wobble.
 *   4. SETTLE   (660ms) — everything fades out together, slowly enough to read as a settle rather
 *                         than a cut. The second pass's 240ms exit was the part that made the whole
 *                         thing feel clipped.
 *
 * ── WHY SEQUENTIAL, AND WHY FOUR VALUES ──────────────────────────────────────────────────────────
 *
 * `Animated.sequence`, not `parallel`. The ordering is the whole reason the run reads as a
 * completion: the edge has to reach the end of the row before anything else starts, or the user sees
 * a highlight fading somewhere in the middle of the line and the "it got all the way there"
 * statement is lost. Each stage's value is therefore also a clean gate for the layer it drives —
 * `pulse` sits at 0 for the whole of stages 1 and 2, so the glow it drives is invisible until its
 * turn without any extra bookkeeping.
 *
 * Within a stage everything derives from ONE value, the AT-2404 rule: the wash and the leading edge
 * both read `progress`, precisely so the wash's edge IS the bright edge. Two values, however
 * carefully tuned, read as two animations that happen to overlap.
 *
 * The shape of each beat lives in the interpolations that consume these values (see
 * `ProjectCompletedSweep`), not here — `pulse` in particular is a normalised CLOCK, not an
 * amplitude, so the breath can be re-shaped without touching this sequence. Same convention as
 * AT-2404's task-completion pulse.
 *
 * Easings, in the order they run: `out(cubic)` on the fill — a confident start and a soft landing;
 * linear reads mechanical on a short run and ease-in makes the row look like it hesitated.
 * `inOut(quad)` on the shimmer, because a glide with hard ends is a wipe. Linear clocks for the
 * pulse and the fade, whose shapes are in the interpolations.
 */

/** The colour crossing the row. Long enough to read as a direction, short enough to never be waited on. */
export const SWEEP_FILL_MS = 820
/** The brighter band gliding over the filled row. */
export const SWEEP_SHIMMER_MS = 760
/** One breath of the whole band: the confirmation. */
export const SWEEP_PULSE_MS = 540
/** Everything going away. Slow on purpose — this is the beat that makes the run feel finished. */
export const SWEEP_SETTLE_MS = 660

export const SWEEP_TOTAL_MS = SWEEP_FILL_MS + SWEEP_SHIMMER_MS + SWEEP_PULSE_MS + SWEEP_SETTLE_MS

/**
 * How long `useProjectCompletedSweep` keeps a project line on the board after the board has decided
 * to drop it. Deliberately longer than the run itself: the line must still be there for the last
 * frame, and the two timers are started from different components (this one from the overlay inside
 * `ProjectHeader`, the hold from `OpenTasksByProject`), so they cannot be assumed to fire in order.
 * `useProjectCompletedSweep.test.js` pins the inequality from the other side.
 *
 * It is derived rather than hand-tuned, which is what makes the third pass's longer run safe: a
 * cleared project in All Projects now lingers for ~2.9s instead of ~1s before its block is dropped.
 * That is the deliberate cost of putting a three-second celebration ON the row — the row has to
 * survive its own celebration — and it is bounded by exactly this timer, so the worst case for any
 * bug above is a project line that leaves the board three seconds late rather than never.
 */
export const PROJECT_LINE_EXIT_HOLD_MS = SWEEP_TOTAL_MS + 120

// A small tail after the run so the settle cannot clip the final frame of the fade.
const SETTLE_BUFFER_MS = 60

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play exactly once.
 * @returns {{progress: Animated.Value, shimmer: Animated.Value, pulse: Animated.Value,
 *   fade: Animated.Value, sweeping: boolean, animated: boolean}}
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
    const shimmer = useRef(new Animated.Value(0)).current
    const pulse = useRef(new Animated.Value(0)).current
    const fade = useRef(new Animated.Value(1)).current
    // Play-once, keyed on the run rather than on a boolean: a re-render (and this row re-renders on
    // every task write in the project) must not restart a sweep that is already halfway across.
    const playedRunRef = useRef(0)

    useEffect(() => {
        if (!runId || runId === playedRunRef.current) return undefined
        /**
         * The `animated` check comes BEFORE the run is marked played, and the order is the bug it
         * fixes: marking first meant a run that arrived while motion was unavailable was consumed
         * permanently, so it could never play even once motion became available. That is reachable
         * on an ordinary load — `useReducedMotion` answers asynchronously, and react-native-web
         * resolves the preference to `true` whenever `window.matchMedia` is missing — and it fails
         * silently, because a swallowed run looks exactly like a run that was never requested.
         */
        if (!animated) return undefined
        playedRunRef.current = runId

        progress.setValue(0)
        shimmer.setValue(0)
        pulse.setValue(0)
        fade.setValue(1)
        setSweeping(true)

        const animation = Animated.sequence([
            Animated.timing(progress, {
                toValue: 1,
                duration: SWEEP_FILL_MS,
                easing: Easing.out(Easing.cubic),
                // The wash animates `scaleX` and the edge `translateX`, both of which the native
                // driver could take — but `backgroundColor` and the layout measurement below cannot,
                // and mixing drivers across one overlay is what makes two halves of it drift.
                useNativeDriver: false,
            }),
            Animated.timing(shimmer, {
                toValue: 1,
                duration: SWEEP_SHIMMER_MS,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: false,
            }),
            Animated.timing(pulse, {
                toValue: 1,
                duration: SWEEP_PULSE_MS,
                // A linear clock: the breath's shape is in the interpolations that read it, so it
                // can be re-shaped without touching this sequence (the AT-2404 convention).
                easing: Easing.linear,
                useNativeDriver: false,
            }),
            Animated.timing(fade, {
                toValue: 0,
                duration: SWEEP_SETTLE_MS,
                easing: Easing.in(Easing.quad),
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
            shimmer.setValue(0)
            pulse.setValue(0)
            fade.setValue(1)
        }, SWEEP_TOTAL_MS + SETTLE_BUFFER_MS)

        return () => {
            clearTimeout(settleTimer)
            animation.stop()
        }
    }, [runId, animated, progress, shimmer, pulse, fade])

    return { progress, shimmer, pulse, fade, sweeping: sweeping && animated, animated }
}
