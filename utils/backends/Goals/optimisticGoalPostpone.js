/**
 * AT-2160 — optimistic goal postpone.
 *
 * "Auto postpone" on a goal is the one postpone in the app that writes nothing locally: it hands
 * the whole change to `postponeGoalWithUndoSecondGen`, which needs a server transaction to record
 * the undo entry and to cascade the new date onto the goal's open tasks. Nothing in the list can
 * move until that round trip lands and the Firestore listener echoes it back, so the row just sits
 * there — for a cold function, seconds.
 *
 * The write stays on the server (that is what keeps undo and the cascade correct). What changes is
 * that the client records the in-flight postpone here, and the two components that place a goal in
 * a day bucket — ParentGoalSection and EmptyGoal — drop the row for as long as it is pending. The
 * auto-postpone ladder never picks a date inside today (its shortest step is +3 days), so a goal
 * that postpones successfully always leaves today's list: hiding it is what the confirmed data will
 * say a moment later, not a guess.
 *
 * Lifecycle, deliberately kept to two exits so a row can never get stuck hidden and never flickers:
 *  - the server rejects  -> cleared immediately, the row comes straight back
 *  - anything else       -> the entry ages out after PENDING_TTL_MS
 *
 * There is intentionally NO "clear once the snapshot confirms it". Clearing on confirmation means
 * un-hiding the row in the same commit that the fresh data arrives in, and the watcher only drops
 * the goal from the bucket a tick later — which is exactly the one-frame flash this is meant to
 * avoid. Once the postpone lands the goal is gone from the list anyway, so a stale entry is inert.
 */

// Generous enough to cover a cold Cloud Function start plus the listener echo, short enough that a
// dropped request only costs the user a few seconds before the goal reappears.
export const OPTIMISTIC_GOAL_POSTPONE_TTL_MS = 15000

export const getOptimisticGoalPostponeKey = (projectId, goalId) => `${projectId}_${goalId}`

export const isOptimisticGoalPostponePending = (entry, now = Date.now()) => {
    if (!entry) return false
    const startedAt = Number(entry.startedAt)
    if (!Number.isFinite(startedAt)) return false
    // A clock jump backwards must not extend the hide indefinitely.
    const age = now - startedAt
    return age >= 0 && age < OPTIMISTIC_GOAL_POSTPONE_TTL_MS
}
