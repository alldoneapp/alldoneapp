/**
 * AT-2507 — "the task I just ticked was the LAST one this goal had for today", told by the row that
 * was ticked to the goal section that renders above it.
 *
 * ── WHY A SIGNAL AND NOT A STORE READ ────────────────────────────────────────────────────────────
 *
 * The two celebrations one and two scopes up (AT-2445 all-projects, AT-2492 per-project) both watch
 * a COUNT fall to zero and infer the achievement from it. That is not available here, for two
 * independent reasons.
 *
 * There is no per-goal, per-day count in redux at all — the only day-scoped per-goal number in the
 * app is `taskList.length` on the `[goalId, tasks]` tuple `MainSection` maps over, and it is not a
 * slice anybody can subscribe to on its own. And more decisively, the component that would watch it
 * is the one that disappears: when the last task of a goal leaves the day, `generateOpenTasksArray`
 * stops emitting that goal's tuple entirely (`openTasks.js`, `deleteTask` drops the bucket once it
 * is empty), so `MainSection` unmounts `ParentGoalSection` and — when the goal is still active for
 * today — mounts an `EmptyGoal` under the same key. The observer would have to survive its own
 * removal to see the event it is watching for. AT-2492 solves exactly that with a probe and a hold
 * because it had no alternative; here there is one.
 *
 * The alternative is that a count reaching zero is an INFERENCE while a completion is a FACT. The
 * row knows it is being completed, and it knows a full second before the write goes out — AT-2404
 * holds the Firestore write for `COMPLETION_HOLD_MS` (1070ms) so the row can play its collapse. So
 * the goal section is told at the moment of the tick, while it is still comfortably mounted, and
 * the whole probe/hold/late-arrival machinery AT-2492 needs is simply not required.
 *
 * It also makes the trigger HONEST in a way a count cannot be. "The list is empty" is not "the work
 * was done" — the lesson AT-2492's header spells out. A goal's today bucket also empties when its
 * last task is dragged to tomorrow, deleted, reassigned, or has its goal changed, and a
 * count-watcher would congratulate the user for every one of them. Only a genuine completion is
 * published here, so those cases stay exactly as silent as they are today.
 *
 * ── WHAT IS PUBLISHED, AND WHAT IS NOT ───────────────────────────────────────────────────────────
 *
 * Published from `TaskPresentation` — the ONE row implementation behind every surface that renders
 * a task line — rather than from `CheckBoxWrapper`, because the checkbox is not the only way a row
 * is completed: `taskCompletionHandoff.js` runs the same motion from the long-press popup
 * (`WorkflowModal`, `FollowUpModal`, `SuggestedModal`). Both go through the row's single
 * `beginCompletionMotion`, so wrapping it there covers both and cannot be forgotten by one of them.
 *
 * Three kinds of tick deliberately publish NOTHING, and each of them would otherwise celebrate
 * something that did not happen:
 *
 *   • a WORKFLOW hand-off (`isCompletion: false`). The row leaves the list and gets the exit, but
 *     the task is not done — it was passed to the next reviewer. Same flag, same meaning, as the one
 *     that decides whether the row itself is swept to 100% and tinted green.
 *   • a SUBTASK, and anything else that keeps its row (`rowRemainsAfterCompletion`). A completed
 *     subtask stays exactly where it is, greyed — `setTaskStatus` keeps its `inDone` at its parent's
 *     value and no subtask query filters on `done` — so it does not empty the goal's bucket and its
 *     parent is still open work.
 *   • a task with no `parentGoalId`. It lives in the general-tasks block, which has no goal row and
 *     therefore nothing to celebrate on.
 *
 * ── LIFETIME ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Deliberately no timestamps, no TTL and no consume-once bookkeeping, unlike the
 * `markEmailLabelPickerInteraction` guard this superficially resembles. A subscriber is a goal
 * section that is mounted for exactly as long as it has tasks on screen, it accumulates the ids it
 * has been told about in its own ref, and that ref dies with it. There is no shared state here to
 * go stale, so there is nothing to expire — and a stamp that expired on a timer would silently
 * break the ordinary case of finishing a goal's three tasks over the course of a morning.
 */

/** @type {Set<Function>} */
const listeners = new Set()

/**
 * @param {Function} listener Called with `{ projectId, goalId, taskId }` for every genuine
 *   completion of a list-leaving task that belongs to a goal.
 * @returns {Function} unsubscribe. Idempotent, so a double-invoked effect cleanup is harmless.
 */
export const subscribeToGoalTaskCompletions = listener => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/**
 * @param {object} event
 * @param {string} event.projectId
 * @param {string} event.goalId
 * @param {string} event.taskId
 */
export const publishGoalTaskCompletion = ({ projectId, goalId, taskId } = {}) => {
    if (!projectId || !goalId || !taskId) return
    const event = { projectId, goalId, taskId }
    /**
     * A copy, because a listener is free to unsubscribe from inside its own callback — a goal
     * section that decides this was the last task may well be about to tear down — and mutating the
     * set mid-iteration would skip whichever listener happened to come next.
     *
     * A throwing listener must not take the completion down with it: the caller is
     * `beginCompletionMotion`, and the number it returns is how long the row's Firestore write is
     * held. An exception escaping here would abort that call, so the task would never be written.
     */
    Array.from(listeners).forEach(listener => {
        try {
            listener(event)
        } catch (error) {
            console.warn('[goal completion] listener failed', error)
        }
    })
}

/** Test seam. Never call from app code — a stray reset would silently deafen every mounted goal. */
export const resetGoalTaskCompletionListeners = () => {
    listeners.clear()
}
