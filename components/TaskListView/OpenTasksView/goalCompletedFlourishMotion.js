import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2507 — the motion a GOAL row plays when the last of its tasks for the day is completed.
 *
 * This is the smallest of the app's four completion celebrations, and the ranking between them is
 * carried by KIND, not by degree — the AT-2492 lesson, which is the one thing to preserve if any of
 * this is ever retuned:
 *
 *   • ALL PROJECTS empty inbox — a headline pops in with a confetti burst thrown from behind it, on
 *     a `position: fixed` layer that escapes to the viewport. ~3.0s.
 *   • ONE PROJECT cleared — the project line fills with the project's colour behind a travelling
 *     edge, a band of light glides over it, it breathes once, and then it comes apart into dust and
 *     sparks as it leaves the board. Four stages, ~2.8s, the whole 56px row.
 *   • ONE GOAL cleared (here) — a slim bar draws itself along the bottom edge of the goal card and
 *     the card breathes once, in the goal's own accent colour. Two beats, ~0.9s, nothing outside the
 *     card, and above all NO PARTICLES OF ANY KIND. That last part is the rule, not a tuning choice:
 *     the moment a goal sheds sparks it is competing with the project line, and clearing a goal
 *     happens several times a day where clearing a project happens once.
 *   • ONE TASK ticked — a green bar through the title, a burst at the checkbox, and the row leaves.
 *
 * The family resemblance to the task tier is deliberate: a bar reaching 100% is this app's sentence
 * for "finished", and reusing it one scope up is what makes the goal beat legible in under a second
 * without inventing a new vocabulary. What separates them is the colour (the goal's own accent, not
 * the green that means "this task is done") and the place (along the card's edge, not through text).
 *
 * ── THE ONE PIECE OF TIMING THAT IS LOAD-BEARING ─────────────────────────────────────────────────
 *
 * `GOAL_FLOURISH_TOTAL_MS` must stay comfortably under AT-2404's `COMPLETION_HOLD_MS` (1070ms).
 *
 * That is not a taste judgement about pacing — it is what makes this whole feature possible without
 * AT-2492's probe-and-hold machinery. The task row holds its Firestore write for the length of its
 * own collapse, so the goal section is guaranteed to still be mounted for that long after the last
 * tick. Finish inside that window and the celebration is always seen in full; overrun it and the
 * snapshot arrives mid-run, `MainSection` unmounts the section (`ParentGoalSection` is replaced by
 * an `EmptyGoal` under the same key when the goal is still active today, or by nothing at all when
 * it is not), and the run is cut off with no way to resume it. `goalCompletedFlourishMotion.test.js`
 * pins the inequality from both sides.
 *
 * ── THE BEATS ────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. FILL  (500ms) — the bar draws left to right along the bottom edge of the card, and a soft
 *                      wash of the same colour fades in behind it. `Easing.out(cubic)`: a confident
 *                      start and a soft landing, the same easing the project fill uses.
 *   2. PULSE (160ms) — the bar thickens and settles while the wash brightens once. The
 *                      confirmation, strictly AFTER the fill in the same `Animated.sequence`,
 *                      because a confirmation that overlaps the thing it confirms is a wobble.
 *   3. FADE  (240ms) — everything goes. The row must be handed back EXACTLY as it was found: unlike
 *                      the project line, a cleared goal frequently STAYS on the board (as an
 *                      `EmptyGoal` with its add-task line), so anything left behind here would be a
 *                      permanent decoration on a perfectly ordinary row.
 *
 * As in AT-2404 and AT-2492, `pulse` is a normalised CLOCK rather than an amplitude — the shape of
 * the breath lives in the interpolations in `GoalCompletedFlourish`, so it can be re-tuned without
 * touching this sequence.
 */

/** The bar drawing itself along the bottom edge of the card. */
export const GOAL_FLOURISH_FILL_MS = 500
/** One breath: the confirmation. */
export const GOAL_FLOURISH_PULSE_MS = 160
/** Handing the row back exactly as it was found. */
export const GOAL_FLOURISH_FADE_MS = 240

export const GOAL_FLOURISH_TOTAL_MS = GOAL_FLOURISH_FILL_MS + GOAL_FLOURISH_PULSE_MS + GOAL_FLOURISH_FADE_MS

/**
 * A small tail after the fade so the teardown cannot clip the last frame, and so a row whose
 * renderer never reports the animation finishing is still handed back.
 */
const CLEAR_BUFFER_MS = 80

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play exactly once.
 * @returns {{progress: Animated.Value, pulse: Animated.Value, fade: Animated.Value,
 *   flourishing: boolean}}
 *   `flourishing` is the single condition for rendering the overlay: false under reduced motion,
 *   false under jest, false when there is nothing to celebrate, and false again the moment the run
 *   is over. A flourish carries no information a static frame could preserve — the empty goal
 *   section says the work is done on its own — so standing down means drawing nothing at all
 *   rather than leaving a bar behind on the card.
 */
export default function useGoalCompletedFlourishMotion(runId) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [flourishing, setFlourishing] = useState(false)
    const progress = useRef(new Animated.Value(0)).current
    const pulse = useRef(new Animated.Value(0)).current
    const fade = useRef(new Animated.Value(1)).current
    // Play-once, keyed on the run rather than on a boolean: a goal row re-renders on every task
    // write in its project, and a re-render must not restart a flourish that is already halfway.
    const playedRunRef = useRef(0)

    const resetRun = useCallback(() => {
        setFlourishing(false)
        progress.setValue(0)
        pulse.setValue(0)
        fade.setValue(1)
    }, [progress, pulse, fade])

    useEffect(() => {
        if (!runId || runId === playedRunRef.current) return undefined
        /**
         * The `animated` check comes BEFORE the run is marked played, and the order is the bug it
         * fixes one scope up (AT-2492): marking first meant a run that arrived while motion was
         * unavailable was consumed permanently and could never play once motion became available.
         * `useReducedMotion` answers asynchronously, and react-native-web resolves the preference to
         * `true` whenever `window.matchMedia` is missing, so this is reachable on an ordinary load.
         */
        if (!animated) return undefined
        playedRunRef.current = runId

        progress.setValue(0)
        pulse.setValue(0)
        fade.setValue(1)
        setFlourishing(true)

        const run = Animated.sequence([
            Animated.timing(progress, {
                toValue: 1,
                duration: GOAL_FLOURISH_FILL_MS,
                easing: Easing.out(Easing.cubic),
                // The bar animates `scaleX` and the wash `opacity`, which the native driver could
                // take — but the wash's `backgroundColor` cannot, and mixing drivers across one
                // overlay is what makes two halves of it drift.
                useNativeDriver: false,
            }),
            Animated.timing(pulse, {
                toValue: 1,
                duration: GOAL_FLOURISH_PULSE_MS,
                // A linear clock; the breath's shape is in the interpolations that read it.
                easing: Easing.linear,
                useNativeDriver: false,
            }),
            Animated.timing(fade, {
                toValue: 0,
                duration: GOAL_FLOURISH_FADE_MS,
                easing: Easing.in(Easing.quad),
                useNativeDriver: false,
            }),
        ])
        run.start()

        /**
         * The teardown is a TIMER rather than the sequence's completion callback, the AT-2404
         * convention: it has to fire identically on the animated path and on any renderer whose
         * composite never reports finishing. A goal row left wearing a bar because one callback
         * never arrived is exactly the failure this branch exists to remove — and unlike the
         * project line, this row usually STAYS on the board, so the decoration would be permanent.
         */
        const clearTimer = setTimeout(resetRun, GOAL_FLOURISH_TOTAL_MS + CLEAR_BUFFER_MS)

        return () => {
            clearTimeout(clearTimer)
            run.stop()
        }
    }, [runId, animated, progress, pulse, fade, resetRun])

    return { progress, pulse, fade, flourishing: flourishing && animated }
}
