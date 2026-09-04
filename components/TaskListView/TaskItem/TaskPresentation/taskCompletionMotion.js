import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2404 — the motion a task row plays when it is checked off.
 *
 * FIRST PASS (MR !436) shipped a strike-through, a faint green tint and a collapse in a 700ms hold.
 * SECOND PASS (MR !438) added the beats at the point of contact — the checkbox punch, the ring and
 * sparks, the green fill — because the flattest thing on screen had been the one element the user
 * actually touched.
 *
 * THIS PASS changes the MESSAGE of the title beat. A dark line drawn through a title is the visual
 * language of deletion; "you finished this" is a different statement, and the natural way to say it
 * is a PROGRESS BAR reaching 100%. So the strike is gone and a slim bright-green bar now fills left
 * to right across the title in 450ms, with a glowing leading edge and a small confirmation pulse
 * when it lands. See `TitleContainer/TaskCompletionProgress.js` for the geometry.
 *
 * The beats, in the order the eye travels: the point of contact first, then the title, then the row.
 *
 *   1. PUNCH (t=0) — the checkbox squashes to 0.84 and springs back through an overshoot. It is a
 *      spring rather than a keyframed timing precisely because the overshoot is the part that reads
 *      as "it responded to me"; a linear pop reads as a glitch.
 *   2. BURST (t=0, 560ms) — a ring expands out of the checkbox and six short sparks fly out with
 *      it. Deliberately anchored TO THE CHECKBOX and clipped to the row's own neighbourhood: no
 *      portal, no full-screen confetti, no cloud round trip. (The random full-screen Giphy overlay
 *      that used to fire here is exactly the gimmick this replaces — and AT-2495 removed the last
 *      of it, because the paths it was still wired to had been dispatching an action the reducer
 *      turned into `undefined`, so it rendered nothing at all.)
 *   3. GREEN (t=0) — the checkbox fills with `UtilityGreen200` and a white check, over the top of
 *      the real checkbox rather than by restyling it. Nothing about the persistent done state
 *      changes, so there is no colour to unwind later.
 *   4. SWEEP + WASH (t=70, 450ms) — the progress bar fills across the title, and the green row wash
 *      sweeps WITH it from the same `scaleX` value and the same `transformOrigin: 'left center'`.
 *      One value, so the wash edge tracks the bar's leading edge instead of the two drifting.
 *   5. PULSE (t=520, 150ms) — 100%. The finished bar thickens briefly and settles, and the head
 *      blooms out. Strictly AFTER the fill (same `Animated.sequence`), because a confirmation that
 *      can overlap the thing it is confirming is just a wobble.
 *   6. EXIT (t=670, 320ms) — height to 0, opacity to 0, and a 6px lift, so the row leaves upward
 *      into the gap it is closing rather than just being deleted.
 *
 * ~990ms of motion inside a 1070ms hold. The sweep itself is the "super quick" 450ms that was
 * asked for; the extra 70ms over the previous pass is the confirmation pulse, which has to finish
 * before the row is allowed to start leaving. Undo is untouched: a 10s bar over 7-day retention
 * (`utils/undo/`), entirely independent of this.
 *
 * ── THE EXIT IS DELIBERATELY THIS AND NOT A DISINTEGRATION (AT-2495) ──────────────────────────
 *
 * Beat 6 was briefly replaced by a 1.2-second right-to-left dust disintegration and put back. The
 * ask it was built for ("make it look like the line disappears the way Thanos snaps his fingers")
 * turned out to be about the PROJECT line, not the task row, and the difference is not a matter of
 * taste: a task is completed dozens of times an hour, often in bursts while a list is cleared, so
 * its exit has to be short, quiet and repeatable — the same argument that keeps the row wash at
 * `UtilityGreen125` 0.55 while the 24px checkbox gets the saturated colour and the sparks. A
 * cinematic exit is affordable exactly once per project per day, which is where it now lives:
 * `components/TaskListView/OpenTasksView/projectLineDisintegration.js`.
 *
 * The other half of AT-2495 stayed: the completion motion still plays when a task is finished from
 * the long-press checkbox popup, through `taskCompletionHandoff.js`. Only the shape of beat 6 was
 * reverted, so the hold is 1070ms again rather than 1950ms.
 *
 * ── SUBTASKS DO NOT COLLAPSE ──────────────────────────────────────────────────────────────────
 *
 * A top-level task disappears from an open list when it is completed — not because anything here
 * removes it, but because the Firestore `inDone == false` query stops matching it. A SUBTASK does
 * not: it stays in its parent's list, checked and dimmed, and can be reopened from exactly where it
 * sits. So the collapse — which is only ever a cover for a removal that is about to happen anyway —
 * is wrong for a subtask, and the first pass got this wrong in the worst possible way: the row
 * animated its height to 0 and `collapsing` never went back to false, so a completed subtask was
 * left in the list as an invisible zero-height row that only came back on a remount.
 *
 * `retainRow` is therefore a property of the ROW, resolved once in `TaskPresentation` from
 * `task.isSubtask`, NOT a per-call argument from the checkbox. That is deliberate: `TaskPresentation`
 * is shared by every context that renders a task line (open lists, MyDay, Goal DV, TDV subtasks,
 * inline subtask lists, backlinks, the comment popup, drag mode), so gating at the row means a
 * caller cannot forget and collapse a subtask by accident. A retained row plays beats 1–5, then
 * RELEASES them (the bar, the head and the wash fade out and the state clears) so what is left
 * behind is the ordinary done-subtask appearance — which is also what a reload shows, so nothing is
 * inconsistent between a subtask you just completed and one that was already done.
 */

// Spring, not timing: the overshoot on the way back is what makes it feel like a button.
export const CHECKBOX_PUNCH_DIP = 0.84
export const CHECKBOX_PUNCH_DIP_MS = 90
// Ring + sparks. Outlives the sweep so the row is still sparkling while the bar reaches 100%.
export const BURST_DURATION_MS = 560
// Everything green (checkbox fill, row wash, progress bar) shares this fade so they arrive as one
// event.
export const FLOURISH_FADE_IN_MS = 140
// Lets the punch land first — the sweep reads as a consequence of the tap rather than a co-event.
export const PROGRESS_DELAY_MS = 70
/**
 * The 0 → 100% fill. "Super quick" is the requirement, and 450ms is the fastest a sweep can be while
 * still being legible as a DIRECTION on a long wrapped title: much under ~350ms and the eye only
 * registers the end state, at which point the bar might as well have appeared all at once and the
 * progress metaphor is lost.
 */
export const PROGRESS_DURATION_MS = 450
// The confirmation at 100%. Deliberately short — it is punctuation, not a beat of its own.
export const PROGRESS_PULSE_MS = 150
export const COLLAPSE_DELAY_MS = 670
export const COLLAPSE_DURATION_MS = 320
// 670 + 320 = 990ms of motion, then ~80ms of buffer before the write.
export const COMPLETION_HOLD_MS = 1070

// Retained rows (subtasks): no collapse, so the flourish is wound back down instead.
export const RELEASE_DELAY_MS = 690
export const RELEASE_DURATION_MS = 260
/**
 * Shorter than `COMPLETION_HOLD_MS` because nothing is waiting on the row to disappear — the write
 * only has to land after the burst and the sweep have been seen, and the row is still there
 * afterwards either way. Long enough that the done styling does not arrive mid-sweep.
 */
export const RETAINED_HOLD_MS = 690

/**
 * `prefers-reduced-motion` and jest both get the same STATIC frame: the green checkbox fill and a
 * progress bar already at 100%. The information survives, the motion does not — the same split
 * `TaskRoutingActivityOverlay` already draws between its overlay (decoration) and `TaskRoutingTag`
 * (the message). No ring, no sparks, no pulse, no collapse: those are pure motion and carry nothing.
 *
 * The hold still exists so the frame is perceptible before the row leaves; it is just short enough
 * not to read as lag. Zero would mean a reduced-motion user sees no completion feedback at all.
 */
export const REDUCED_MOTION_HOLD_MS = 300
// A retained row has to put itself back even with motion switched off, or a full green bar sits
// under a done subtask forever and disagrees with what a reload renders.
export const REDUCED_MOTION_RELEASE_MS = 450

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * Does this row stay on screen after its task is completed?
 *
 * The collapse is only ever a cover for a removal that is about to happen anyway, so it is correct
 * exactly when the completed task stops matching the query the list is built from. That is true for
 * a top-level task (`inDone` flips) and FALSE in two cases:
 *
 *   • A SUBTASK. `setTaskStatus` keeps a subtask's `inDone` at the parent's value and never stamps
 *     `completed`, and no subtask query filters on `done` — a checked-off subtask stays exactly
 *     where it is, greyed, ready to be reopened. Both `isSubtask` and `parentId` are checked
 *     because every path that creates a subtask writes both (`mapTaskData`, `DragHelper`,
 *     `EditTask`), and the rest of `TaskPresentation` already trusts `parentId` for this question.
 *   • The COMMENT POPUP header, which renders a task row inside a modal. There is no list to leave.
 *
 * A pure function, exported, because it is the one rule that must hold across every context that
 * renders a task line — open lists, MyDay, Goal DV, pending, done, backlinks, drag mode, the inline
 * subtask list under a row, the TDV Subtasks tab and the comment popup — all of which funnel
 * through the single shared `TaskPresentation`.
 */
export const rowRemainsAfterCompletion = (task, { inCommentPopup = false } = {}) =>
    !!task?.isSubtask || !!task?.parentId || !!inCommentPopup

/**
 * Owned by `TaskPresentation` (the row) but triggered from `CheckBoxWrapper` (the checkbox, several
 * levels down), so `begin` is threaded down as a prop rather than shared through redux or a module
 * store. A redux slice keyed by task id would re-render every mounted row on every completion —
 * exactly the fan-out AT-2336 exists to prevent — for state that only ever concerns one row and
 * lives for a second.
 *
 * `begin` RETURNS the number of ms the caller should wait before writing. That keeps every timing
 * decision — reduced motion, and the shorter retained-row hold — inside this module:
 * `CheckBoxWrapper` never has to ask what kind of row it is in, it just waits for however long it
 * is told.
 *
 * @param {object} options
 * @param {boolean} options.retainRow True when the row stays in its list after completion (a
 *   subtask, or a task rendered inside the comment popup). Suppresses the collapse entirely and
 *   switches the tail of the sequence to a release. Resolved from the row, never from the caller.
 * @param {boolean} options.isDone The task's persisted done state, watched only for the done → open
 *   transition: reopening a subtask must wipe any completion styling that is still on screen.
 */
/**
 * @param {object} [options]
 * @param {boolean} [options.retainRow] The subtask guarantee — see `rowRemainsAfterCompletion`.
 * @param {boolean} [options.isDone] The task's persisted done flag, watched for the reopen reset.
 * @param {Function} [options.onCompletionStart] AT-2507 — called once, synchronously, when a
 *   GENUINE completion of a row that is LEAVING the list begins. Not called for a workflow
 *   hand-off and not called for a retained row, because neither empties the list the row is in.
 *   Must have a stable identity (the caller's own `useCallback`), since it is a dependency of
 *   `begin` and therefore of the `completionMotion` handoff object.
 */
export default function useTaskCompletionMotion({ retainRow = false, isDone = false, onCompletionStart } = {}) {
    const reducedMotion = useReducedMotion()

    const [completion, setCompletion] = useState(null)
    const [collapsing, setCollapsing] = useState(false)

    // Native driver: transform and opacity only, and never shared with the height pair below.
    // Mixing drivers on one Animated.Value throws at runtime.
    const punch = useRef(new Animated.Value(1)).current
    const burst = useRef(new Animated.Value(0)).current
    // The 0 → 100% sweep. Drives the title's progress bar AND the row wash, so the wash's leading
    // edge is the bar's leading edge.
    const sweep = useRef(new Animated.Value(0)).current
    // A CLOCK for the confirmation at 100%, not an amplitude: it runs 0 → 1 once the sweep has
    // landed, and the bump shape (thicken, settle, bloom the head out) lives in the interpolations
    // in `TaskCompletionProgress`. Keeping it normalised here is what lets that component change the
    // shape of the confirmation without touching the sequence.
    const pulse = useRef(new Animated.Value(0)).current
    const flourish = useRef(new Animated.Value(0)).current
    // Non-native: `height` cannot be driven natively, and the row's opacity rides with it on the
    // same node so both stay on the same driver.
    const rowOpacity = useRef(new Animated.Value(1)).current
    const rowHeight = useRef(new Animated.Value(0)).current

    const rowHeightRef = useRef(0)
    const animationRef = useRef(null)
    const releaseTimeoutRef = useRef(null)
    const isUnmountedRef = useRef(false)

    // The row is *expected* to unmount shortly after the motion finishes — that is the snapshot
    // arriving and dropping the completed task from the list. But it can also unmount early (a
    // project switch, a filter change, a re-sort), and an animation left running against a detached
    // node is exactly the "post-unmount update" the surrounding component already guards timeouts
    // against. Stopping is cheap and makes the teardown symmetric.
    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            animationRef.current?.stop()
            animationRef.current = null
            if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current)
            releaseTimeoutRef.current = null
        }
    }, [])

    // Last known laid-out height of the whole row. Read only at the moment a completion starts, so
    // the per-layout write costs nothing.
    const onRowLayout = useCallback(event => {
        const measured = event?.nativeEvent?.layout?.height
        if (measured) rowHeightRef.current = measured
    }, [])

    const reset = useCallback(() => {
        animationRef.current?.stop()
        animationRef.current = null
        if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current)
        releaseTimeoutRef.current = null
        punch.setValue(1)
        burst.setValue(0)
        sweep.setValue(0)
        pulse.setValue(0)
        flourish.setValue(0)
        rowOpacity.setValue(1)
        rowHeight.setValue(0)
        setCollapsing(false)
        setCompletion(null)
    }, [punch, burst, sweep, pulse, flourish, rowOpacity, rowHeight])

    /**
     * Reopening a completed subtask has to hand back a completely ordinary row. The release at the
     * end of the sequence normally does that already, but not on every path — a row that was
     * remounted mid-flourish, or one whose release never ran because motion is disabled under jest,
     * would otherwise keep a filled progress bar under a task that is open again. Watching the
     * persisted flag closes all of them at once, and only ever fires on the done → open edge, so an
     * ordinary row pays a single ref comparison per render.
     */
    const wasDoneRef = useRef(isDone)
    useEffect(() => {
        if (wasDoneRef.current && !isDone) reset()
        wasDoneRef.current = isDone
    }, [isDone, reset])

    /**
     * Clearing the completion state at the end of a RETAINED row's sequence is a timer rather than
     * the animation's own completion callback, and deliberately so: it has to fire identically on
     * the animated path, the reduced-motion path and any renderer whose `Animated` composite never
     * reports finishing. A subtask that kept its progress bar because one callback did not arrive is the
     * exact failure this whole branch exists to remove.
     */
    const scheduleRelease = useCallback(
        delayMs => {
            releaseTimeoutRef.current = setTimeout(() => {
                releaseTimeoutRef.current = null
                if (!isUnmountedRef.current) reset()
            }, delayMs)
        },
        [reset]
    )

    /**
     * @param {object} options
     * @param {boolean} options.isCompletion Whether the task is genuinely being COMPLETED. False
     *   when the checkbox advances a WORKFLOW task to its next step: the row is leaving this list,
     *   but the task is not done, so it gets neither the progress sweep, the green wash nor the
     *   checkbox celebration — it just exits. It would otherwise be told it had finished something
     *   it has only handed on.
     * @returns {number} ms to wait before persisting.
     */
    const begin = useCallback(
        ({ isCompletion = true } = {}) => {
            /**
             * A run that draws nothing AND collapses nothing has nothing to wait for, so holding
             * the write would be pure latency. That is exactly a workflow step advance on a
             * RETAINED row: the comment-popup header has no list to leave (no collapse) and the
             * task is not done (no sweep, no wash, no checkbox burst). Answering 0 here is what
             * keeps `CommentPopupWorkflowControls`' forward/backward buttons as immediate as they
             * are today, while its "Done" still gets the full run.
             */
            if (!isCompletion && retainRow) return 0

            /**
             * AT-2507 — announced HERE rather than at the checkbox because this is the one funnel
             * every completion passes through (the checkbox, and `taskCompletionHandoff` for the
             * long-press popup), and because the two conditions that make a completion worth
             * announcing to the goal above the row are both already resolved at this point:
             * `isCompletion` (a workflow hand-off is not a completion) and `retainRow` (a subtask
             * keeps its row and so empties nothing). The caller supplies the announcement itself,
             * so this module stays ignorant of goals and projects.
             *
             * Before the reduced-motion branch below on purpose: whether the ROW draws anything
             * says nothing about whether the goal section should be told the work is finished, and
             * the goal's own celebration makes its own reduced-motion decision.
             */
            if (isCompletion && !retainRow && typeof onCompletionStart === 'function') onCompletionStart()

            const staticOnly = reducedMotion || animationsAreDisabled()
            setCompletion({ isCompletion, animated: !staticOnly })

            if (releaseTimeoutRef.current) {
                clearTimeout(releaseTimeoutRef.current)
                releaseTimeoutRef.current = null
            }

            if (staticOnly) {
                punch.setValue(1)
                burst.setValue(0)
                // The bar is simply already at 100%. `pulse` stays at rest: the confirmation is a
                // motion, and its resting frame (a full bar with its leading edge lit) is exactly
                // the static statement wanted here.
                sweep.setValue(1)
                pulse.setValue(0)
                flourish.setValue(1)
                // A retained row must put itself back even with motion switched off, or the static
                // bar sits under a done subtask forever and disagrees with what a reload renders.
                if (retainRow) scheduleRelease(REDUCED_MOTION_RELEASE_MS)
                return REDUCED_MOTION_HOLD_MS
            }

            const measuredHeight = rowHeightRef.current
            punch.setValue(1)
            burst.setValue(0)
            sweep.setValue(0)
            pulse.setValue(0)
            flourish.setValue(0)
            rowOpacity.setValue(1)

            const beats = [
                // Beat 1 — the point of contact. Dip fast, then spring back through an overshoot.
                Animated.sequence([
                    Animated.timing(punch, {
                        toValue: CHECKBOX_PUNCH_DIP,
                        duration: CHECKBOX_PUNCH_DIP_MS,
                        easing: Easing.out(Easing.quad),
                        useNativeDriver: false,
                    }),
                    Animated.spring(punch, {
                        toValue: 1,
                        friction: 3.6,
                        tension: 180,
                        useNativeDriver: false,
                    }),
                ]),
                // Beat 2 — ring and sparks out of the checkbox.
                Animated.timing(burst, {
                    toValue: 1,
                    duration: BURST_DURATION_MS,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: false,
                }),
                // Beat 3 — everything green arrives together.
                Animated.timing(flourish, {
                    toValue: 1,
                    duration: FLOURISH_FADE_IN_MS,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: false,
                }),
                // Beats 4 and 5 — the 0 → 100% sweep and then, strictly afterwards, the
                // confirmation. One sequence rather than two parallel entries with a hand-computed
                // delay: a confirmation that can start before the thing it confirms has finished is
                // a wobble, and a delay tuned against a duration drifts the moment either changes.
                Animated.sequence([
                    Animated.delay(PROGRESS_DELAY_MS),
                    Animated.timing(sweep, {
                        toValue: 1,
                        duration: PROGRESS_DURATION_MS,
                        // Off the mark immediately, holding speed through the middle and settling
                        // onto 100% — a bar being filled, rather than one sliding in at a constant
                        // rate (mechanical) or dawdling towards the end (`Easing.out` alone, which
                        // spends most of a 450ms budget barely moving).
                        easing: Easing.bezier(0.22, 0.75, 0.25, 1),
                        useNativeDriver: false,
                    }),
                    Animated.timing(pulse, {
                        toValue: 1,
                        duration: PROGRESS_PULSE_MS,
                        easing: Easing.out(Easing.quad),
                        useNativeDriver: false,
                    }),
                ]),
            ]

            if (retainRow) {
                // Beat 6a — put the row back. The task stays in the list as an ordinary done row,
                // so everything this animation added has to come off again.
                beats.push(
                    Animated.sequence([
                        Animated.delay(RELEASE_DELAY_MS),
                        Animated.timing(flourish, {
                            toValue: 0,
                            duration: RELEASE_DURATION_MS,
                            easing: Easing.in(Easing.quad),
                            useNativeDriver: false,
                        }),
                    ])
                )
            } else if (measuredHeight > 0) {
                // Beat 6b — the exit. A row that has never been laid out (measured height 0) still
                // sweeps and sparkles; it just cannot collapse, because animating to 0 from an
                // unknown start would jump.
                rowHeight.setValue(measuredHeight)
                setCollapsing(true)
                beats.push(
                    Animated.sequence([
                        Animated.delay(COLLAPSE_DELAY_MS),
                        Animated.parallel([
                            Animated.timing(rowHeight, {
                                toValue: 0,
                                duration: COLLAPSE_DURATION_MS,
                                easing: Easing.in(Easing.cubic),
                                useNativeDriver: false,
                            }),
                            Animated.timing(rowOpacity, {
                                toValue: 0,
                                // Beats the height so the row is invisible before it is flat —
                                // fading and shrinking at the same rate reads as a squash.
                                duration: COLLAPSE_DURATION_MS - 80,
                                easing: Easing.in(Easing.quad),
                                useNativeDriver: false,
                            }),
                        ]),
                    ])
                )
            }

            const animation = Animated.parallel(beats)
            animationRef.current = animation
            animation.start()

            // Only the retained path has anything to clear. A collapsing row is about to be
            // unmounted by the snapshot, and resetting its state first would flash it back in.
            if (retainRow) scheduleRelease(RELEASE_DELAY_MS + RELEASE_DURATION_MS)

            return retainRow ? RETAINED_HOLD_MS : COMPLETION_HOLD_MS
        },
        [
            reducedMotion,
            retainRow,
            onCompletionStart,
            punch,
            burst,
            sweep,
            pulse,
            flourish,
            rowOpacity,
            rowHeight,
            scheduleRelease,
        ]
    )

    // Only applied while collapsing. Left off otherwise so the row is never pinned to a stale
    // measured height during ordinary renders — and never applied at all on a retained row, which
    // is the whole subtask guarantee.
    const rowStyle = collapsing
        ? {
              height: rowHeight,
              opacity: rowOpacity,
              overflow: 'hidden',
              // Leaves upward into the gap it is closing. Same non-native driver as the pair above,
              // so it can share their node.
              transform: [
                  {
                      translateY: rowOpacity.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
                  },
              ],
          }
        : undefined

    /**
     * AT-2495 — the same `begin`/`cancel` pair, bundled once with a stable identity so it can be
     * threaded to the surfaces that complete a task from OUTSIDE the row (the long-press checkbox
     * popup, the comment-popup workflow controls). Built here rather than at each consumer so
     * there is exactly one object per row to pass around, and so a `React.memo`'d consumer is not
     * re-rendered by a fresh literal on every parent render. See `taskCompletionHandoff.js` for
     * how it is used.
     */
    const completionMotion = useMemo(() => ({ begin, cancel: reset }), [begin, reset])

    // Null for the overwhelming majority of rows, so none of the completion layers is even mounted
    // until the row is actually being completed. All three are gated on `isCompletion`, because a
    // workflow step advance is not a completion and must not be congratulated as one.
    const isCompletionRun = !!completion?.isCompletion

    return {
        onRowLayout,
        rowStyle,
        beginCompletionMotion: begin,
        cancelCompletionMotion: reset,
        completionMotion,
        completionProgress: isCompletionRun
            ? { progress: sweep, pulse, opacity: flourish, animated: completion.animated }
            : null,
        completionWash: isCompletionRun ? { progress: sweep, opacity: flourish, animated: completion.animated } : null,
        completionCelebration: isCompletionRun
            ? { punch, burst, opacity: flourish, animated: completion.animated }
            : null,
        isCompleting: !!completion,
    }
}
