import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'
import { DISINTEGRATION_DURATION_MS, createProjectLineExitStyle } from './projectLineDisintegration'

/**
 * AT-2492 — the motion behind the "completed sweep" a project line plays when that project's today
 * list has just been cleared, and (AT-2495, second pass) the disintegration it leaves the board on.
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
 * ── THE STAGES ───────────────────────────────────────────────────────────────────────────────────
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
 *
 * ── STAGE 4 IS TWO DIFFERENT STAGES, AND WHICH ONE RUNS IS DECIDED LATE (AT-2495) ────────────────
 *
 *   4a. SETTLE       (660ms) — everything fades out together, slowly enough to read as a settle
 *                              rather than a cut. This is what a line that is STAYING does: on the
 *                              selected-project board the header is not going anywhere, so the run
 *                              has to hand the row back exactly as it found it.
 *   4b. DISINTEGRATE (1200ms) — the line comes apart right to left into dust and sparks and its
 *                              height closes behind it. This is what a line that is LEAVING does,
 *                              which in practice means All Projects, where clearing a project drops
 *                              its whole block from the board. Geometry in
 *                              `projectLineDisintegration.js`.
 *
 * The settle is not skipped so much as SUBSUMED: the dissolve erases the row's own pixels, and the
 * sweep overlay is a child of that row, so the coloured wash and the accent bar are carried off by
 * the same front. Fading them out first and then dissolving an already-plain row would spend 660ms
 * throwing away the thing that makes the exit worth watching.
 *
 * WHICH branch runs is read at the moment stage 4 begins, from a ref, and not when the run starts —
 * and that is the one piece of timing here that is load-bearing rather than aesthetic. The two facts
 * arrive from two different Firestore listeners: the count that triggers the celebration
 * (`sidebarNumbers`) and the flag that hides the block (`thereAreNotTasksInFirstDay`, threaded down
 * as `lineWillLeave`). They land in whatever order the network gives them, and the celebration is
 * usually first. Deciding at `start()` would therefore have picked the SETTLE for the ordinary case
 * and silently lost the disintegration — the same class of race `PROJECT_SWEEP_PROBE_MS` exists to
 * absorb, and it fails invisibly, because a settle is a perfectly plausible-looking animation. By
 * deciding 2.1 seconds in, the branch has three times the probe's window to be sure.
 *
 * ── WHY SEQUENTIAL, AND WHY A VALUE PER STAGE ────────────────────────────────────────────────────
 *
 * `Animated.sequence`, not `parallel`. The ordering is the whole reason the run reads as a
 * completion: the edge has to reach the end of the row before anything else starts, or the user sees
 * a highlight fading somewhere in the middle of the line and the "it got all the way there"
 * statement is lost. Each stage's value is therefore also a clean gate for the layer it drives —
 * `pulse` sits at 0 for the whole of stages 1 and 2, so the glow it drives is invisible until its
 * turn without any extra bookkeeping.
 *
 * Within a stage everything derives from ONE value, the AT-2404 rule: the wash and the leading edge
 * both read `progress`, precisely so the wash's edge IS the bright edge; and the dissolve front, the
 * dust that lifts off it and the height that closes behind it all read `disintegrate`. Two values,
 * however carefully tuned, read as two animations that happen to overlap.
 *
 * The shape of each beat lives in the interpolations that consume these values (see
 * `ProjectCompletedSweep` and `projectLineDisintegration`), not here — `pulse` in particular is a
 * normalised CLOCK, not an amplitude, so the breath can be re-shaped without touching this sequence.
 * Same convention as AT-2404's task-completion pulse.
 *
 * Easings, in the order they run: `out(cubic)` on the fill — a confident start and a soft landing;
 * linear reads mechanical on a short run and ease-in makes the row look like it hesitated.
 * `inOut(quad)` on the shimmer, because a glide with hard ends is a wipe. Linear clocks for the
 * pulse and the fade, whose shapes are in the interpolations. And LINEAR on the dissolve, which is
 * the one easing here that must not be "improved": the front is a physical thing crossing the row at
 * a speed the eye tracks, and an eased front accelerates away and then appears to stall against the
 * left-hand edge, which reads as the animation hitching rather than as the row coming apart.
 */

/** The colour crossing the row. Long enough to read as a direction, short enough to never be waited on. */
export const SWEEP_FILL_MS = 820
/** The brighter band gliding over the filled row. */
export const SWEEP_SHIMMER_MS = 760
/** One breath of the whole band: the confirmation. */
export const SWEEP_PULSE_MS = 540
/** Everything going away, for a line that is staying put. */
export const SWEEP_SETTLE_MS = 660

/** Stages 1-3: everything that happens before stage 4 branches. */
export const SWEEP_LEAD_MS = SWEEP_FILL_MS + SWEEP_SHIMMER_MS + SWEEP_PULSE_MS

/** The run for a line that stays on the board (the selected-project header). */
export const SWEEP_TOTAL_MS = SWEEP_LEAD_MS + SWEEP_SETTLE_MS
/** The run for a line that is leaving it (All Projects). */
export const SWEEP_EXIT_TOTAL_MS = SWEEP_LEAD_MS + DISINTEGRATION_DURATION_MS

/**
 * How long `useProjectCompletedSweep` keeps a project line on the board after the board has decided
 * to drop it. Deliberately longer than the run itself: the line must still be there for the last
 * frame, and the two timers are started from different components (this one from the overlay inside
 * `ProjectHeader`, the hold from `OpenTasksByProject`), so they cannot be assumed to fire in order.
 * `useProjectCompletedSweep.test.js` pins the inequality from the other side.
 *
 * It is derived from the LEAVING run rather than hand-tuned, which is what makes the disintegration
 * safe: a cleared project in All Projects lingers for ~3.2s before its block is dropped. That is the
 * deliberate cost of putting a celebration and an exit ON the row — the row has to survive both —
 * and it is bounded by exactly this timer, so the worst case for any bug above is a project line
 * that leaves the board three seconds late rather than never. It delays no Firestore write: the
 * write that emptied the project happened when its last task was ticked.
 */
export const PROJECT_LINE_EXIT_HOLD_MS = SWEEP_EXIT_TOTAL_MS + 120

// A small tail after the run so the settle cannot clip the final frame of the fade.
const SETTLE_BUFFER_MS = 60

/**
 * How long after the board should have dropped a disintegrated line we put it back rather than leave
 * an invisible hole where a project used to be.
 *
 * The exit deliberately does NOT reset itself: a row that popped back to full height for a frame
 * before its block was dropped would flash, which is worse than the exit it is ending. So the row
 * stays erased and collapsed, and the board unmounting it is what ends the run. This is the backstop
 * for the case where that never happens — the hold miscomputed, the board kept the block, a
 * re-render resurrected it. A project line that reappears a moment after leaving is a cosmetic
 * oddity; a 56px invisible gap that a user can neither see nor click is a bug they have to reload to
 * clear.
 */
const EXIT_RECOVERY_MS = PROJECT_LINE_EXIT_HOLD_MS + 400

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play exactly once.
 * @param {boolean} lineWillLeave Is the board about to drop this project's block? Read at stage 4
 *   (see the header), never at `start()`.
 * @returns {{progress: Animated.Value, shimmer: Animated.Value, pulse: Animated.Value,
 *   fade: Animated.Value, disintegrate: Animated.Value, sweeping: boolean, exiting: boolean,
 *   animated: boolean}}
 *   `sweeping` is the single condition for rendering the sweep overlay and `exiting` the single
 *   condition for masking the row and shedding particles. Both are false under reduced motion, false
 *   under jest, and false whenever there is nothing to celebrate. A sweep carries no information a
 *   static frame could preserve — the empty list and the project leaving the board already say the
 *   project is done — so standing down means rendering nothing at all rather than leaving a coloured
 *   bar behind, and a line that cannot disintegrate simply leaves the way it always did.
 */
export default function useProjectCompletedSweepMotion(runId, lineWillLeave = false) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [sweeping, setSweeping] = useState(false)
    const [exiting, setExiting] = useState(false)
    const progress = useRef(new Animated.Value(0)).current
    const shimmer = useRef(new Animated.Value(0)).current
    const pulse = useRef(new Animated.Value(0)).current
    const fade = useRef(new Animated.Value(1)).current
    const disintegrate = useRef(new Animated.Value(0)).current
    // Play-once, keyed on the run rather than on a boolean: a re-render (and this row re-renders on
    // every task write in the project) must not restart a sweep that is already halfway across.
    const playedRunRef = useRef(0)

    /**
     * Refreshed after every commit rather than during render, so stage 4 reads the freshest answer
     * available at the moment it has to choose (see the header). An effect with no dependency array
     * is the cheapest correct way to do that.
     */
    const lineWillLeaveRef = useRef(lineWillLeave)
    useEffect(() => {
        lineWillLeaveRef.current = lineWillLeave
    })

    const resetRun = useCallback(() => {
        setSweeping(false)
        setExiting(false)
        progress.setValue(0)
        shimmer.setValue(0)
        pulse.setValue(0)
        fade.setValue(1)
        disintegrate.setValue(0)
    }, [progress, shimmer, pulse, fade, disintegrate])

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
        disintegrate.setValue(0)
        setSweeping(true)
        setExiting(false)

        const lead = Animated.sequence([
            Animated.timing(progress, {
                toValue: 1,
                duration: SWEEP_FILL_MS,
                easing: Easing.out(Easing.cubic),
                // The wash animates `scaleX` and the edge `translateX`, both of which the native
                // driver could take — but `backgroundColor`, the layout measurement below and the
                // exit's `height`/`maskPosition` cannot, and mixing drivers across one overlay is
                // what makes two halves of it drift.
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
        ])
        lead.start()

        /**
         * Stage 4 is chained by a TIMER rather than by the sequence's completion callback, for the
         * same reason the teardown below is: this has to branch identically on any renderer whose
         * composite never reports finishing. A few milliseconds of overlap or gap against the pulse
         * is invisible; a stage that never runs because a callback never arrived would leave a
         * coloured bar across the row forever.
         */
        let finalAnimation = null
        const timers = []
        timers.push(
            setTimeout(() => {
                if (lineWillLeaveRef.current) {
                    setExiting(true)
                    finalAnimation = Animated.timing(disintegrate, {
                        toValue: 1,
                        duration: DISINTEGRATION_DURATION_MS,
                        easing: Easing.linear,
                        useNativeDriver: false,
                    })
                    /**
                     * No teardown for the leaving branch — see `EXIT_RECOVERY_MS`. The row is
                     * erased and flat when this finishes and the board is a heartbeat away from
                     * unmounting it; resetting would flash it back into view first.
                     */
                    timers.push(setTimeout(resetRun, EXIT_RECOVERY_MS - SWEEP_LEAD_MS))
                } else {
                    finalAnimation = Animated.timing(fade, {
                        toValue: 0,
                        duration: SWEEP_SETTLE_MS,
                        easing: Easing.in(Easing.quad),
                        useNativeDriver: false,
                    })
                    timers.push(setTimeout(resetRun, SWEEP_SETTLE_MS + SETTLE_BUFFER_MS))
                }
                finalAnimation.start()
            }, SWEEP_LEAD_MS)
        )

        return () => {
            timers.forEach(clearTimeout)
            lead.stop()
            if (finalAnimation) finalAnimation.stop()
        }
    }, [runId, animated, progress, shimmer, pulse, fade, disintegrate, resetRun])

    /**
     * The line is staying after all. A new task landing in the project during the ~1.2s exit flips
     * `thereAreNotTasksInFirstDay` back, the board keeps the block — and without this the header
     * would be left masked to nothing and collapsed to zero height: present, unclickable and
     * invisible until something remounted it.
     */
    useEffect(() => {
        if (exiting && !lineWillLeave) resetRun()
    }, [exiting, lineWillLeave, resetRun])

    return {
        progress,
        shimmer,
        pulse,
        fade,
        disintegrate,
        sweeping: sweeping && animated,
        exiting: exiting && animated,
        animated,
    }
}

/**
 * AT-2495 — the style the leaving project line wears, and the measurement it needs first.
 *
 * Split out of `ProjectHeader` so the component that draws the row and the browser harness that
 * screenshots it cannot wire the exit differently. Everything fiddly about it is here:
 *
 *   • the height is FROZEN when the exit begins. The exit style animates `height`, so a live
 *     measurement would feed the collapse back into itself, and the particle layer has to keep the
 *     full height while the row underneath closes — dust that collapsed with the row would be
 *     clipped off mid-flight.
 *   • the freeze is a render-phase state adjustment (React's documented "adjust state when a prop
 *     changes" shape, guarded so it cannot loop) rather than an effect, because the mask has to be
 *     on the row in the SAME commit that starts the exit or the first frames are simply dropped.
 *   • the style is memoised rather than merely conditional: a project header re-renders on every
 *     task write in its project, and rebuilding the interpolations would detach and reattach live
 *     animated nodes mid-exit.
 *
 * @param {{disintegrate: Animated.Value, exiting: boolean}} motion From the hook above.
 * @returns {{exitStyle: object|undefined, exitHeight: number, onLineLayout: Function}}
 *   `exitStyle` is `undefined` for every row that is not leaving — which is every row on every
 *   other board, and every row under reduced motion — so an ordinary header carries no mask (and
 *   therefore no compositing layer) and is never pinned to a measured height.
 */
export function useProjectLineExit({ disintegrate, exiting }) {
    const measuredHeightRef = useRef(0)
    const [exitHeight, setExitHeight] = useState(0)

    const onLineLayout = useCallback(
        event => {
            const { height } = event.nativeEvent.layout
            // Ignored once the exit owns the height, so the collapse cannot overwrite the value it
            // is collapsing from.
            if (!exiting && height > 0) measuredHeightRef.current = height
        },
        [exiting]
    )

    if (exiting && exitHeight === 0 && measuredHeightRef.current > 0) setExitHeight(measuredHeightRef.current)
    else if (!exiting && exitHeight !== 0) setExitHeight(0)

    const exitStyle = useMemo(
        () => (exiting && exitHeight > 0 ? createProjectLineExitStyle(disintegrate, exitHeight) : undefined),
        [exiting, exitHeight, disintegrate]
    )

    return { exitStyle, exitHeight, onLineLayout }
}
