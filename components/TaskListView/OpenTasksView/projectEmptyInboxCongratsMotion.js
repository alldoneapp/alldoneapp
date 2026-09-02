import useEmptyInboxCongratsCelebration from './emptyInboxCongratsMotion'
import { SWEEP_TOTAL_MS } from './projectCompletedSweepMotion'

/**
 * AT-2492 — the small pop the Anna "tasks done" picture makes on the selected-project board when the
 * project was cleared today.
 *
 * It is the SECOND half of the per-project celebration, not the celebration itself: the statement is
 * the completed sweep across the project line (`ProjectCompletedSweep`), which plays on both boards.
 * This is the flourish that rides along on the one board that also happens to be showing a picture.
 * Karsten asked for both kept, and the ranking still holds because the sweep is the thing you notice
 * and the picture merely arrives with it rather than being there already.
 *
 * The first pass of AT-2492 threw a confetti burst here instead. That is gone — confetti belongs to
 * the all-projects empty-inbox moment, and borrowing it at a smaller size meant the two celebrations
 * could only differ in degree. What is left is a 380ms opacity-and-scale settle, sharing the sweep's
 * run id so the two beats are visibly one event.
 *
 * Reusing `useEmptyInboxCongratsCelebration` rather than writing a third animation hook is
 * deliberate, and its own docstring says why: the settle-on-a-timer rule, the play-once guard and
 * the reduced-motion branch are the parts that were expensive to get right. Its `confetti` value is
 * simply not consumed here.
 */

// A settle, not a bounce: the picture is a decoration on a board that has just been swept, not an
// arrival that needs announcing.
export const PROJECT_ENTRANCE_MS = 380
/**
 * Held for exactly as long as the sweep, so `celebrating` — and therefore the animated wrapper
 * around the picture — is torn down at the same moment the line stops being coloured. Derived rather
 * than hand-tuned so the two can never drift apart.
 */
export const PROJECT_CONGRATS_TOTAL_MS = SWEEP_TOTAL_MS

const PROJECT_TIMING = {
    entranceMs: PROJECT_ENTRANCE_MS,
    // Nothing reads the confetti value on this path; it is pinned to the entrance so the hook is
    // never left running an animation whose output is discarded.
    confettiMs: PROJECT_ENTRANCE_MS,
    totalMs: PROJECT_CONGRATS_TOTAL_MS,
}

/**
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play once.
 * @returns {{entrance: Animated.Value, animated: boolean, celebrating: boolean}}
 */
export default function useProjectEmptyInboxCongratsCelebration(runId) {
    return useEmptyInboxCongratsCelebration(runId, PROJECT_TIMING)
}
