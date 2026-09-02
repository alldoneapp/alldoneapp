import useEmptyInboxCongratsCelebration from './emptyInboxCongratsMotion'

/**
 * AT-2492 — the smaller sibling of the all-projects congrats motion.
 *
 * "Celebrate it already a little, but not as much as when we achieve empty inbox across all
 * projects" is a statement about RANKING, so the two celebrations have to be legible as the same
 * vocabulary at two volumes — not as two unrelated effects. Hence the same motion module, the same
 * confetti component and the same once-per-day rule, at a smaller tuning:
 *
 *   • ~1.4s against the all-projects ~3s;
 *   • the burst only, at 10 pieces and 0.62x throw, against 16 pieces plus a 30-piece fall across
 *     the whole viewport (`variant="burst"` in `EmptyInboxConfetti`);
 *   • no headline, no achievement card, no green dot, no streak — clearing one project is not an
 *     achievement, it is a good moment.
 *
 * The page-wide fall is the line between them and is deliberately a difference in KIND. Clearing one
 * project puts a flourish over the block you are looking at; clearing every project changes the
 * whole screen. Tuning piece counts alone would have left the two reading as "the same celebration,
 * slightly weaker", which is precisely the ambiguity this task asks to remove.
 */

// The picture's pop-in. Shorter than the all-projects headline (520ms): it is a decoration on an
// element that is already on screen, not an arrival.
export const PROJECT_ENTRANCE_MS = 380
// The whole burst. Long enough to read as thrown and fall away, short enough that a user clearing
// several projects in a row is never waiting on it.
export const PROJECT_CONFETTI_MS = 1400
// Plus a buffer so the settle cannot clip the last frame.
export const PROJECT_CONGRATS_TOTAL_MS = PROJECT_CONFETTI_MS + 100

const PROJECT_TIMING = {
    entranceMs: PROJECT_ENTRANCE_MS,
    confettiMs: PROJECT_CONFETTI_MS,
    totalMs: PROJECT_CONGRATS_TOTAL_MS,
}

/**
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play once.
 * @returns {{entrance: Animated.Value, confetti: Animated.Value, animated: boolean, celebrating: boolean}}
 */
export default function useProjectEmptyInboxCongratsCelebration(runId) {
    return useEmptyInboxCongratsCelebration(runId, PROJECT_TIMING)
}
