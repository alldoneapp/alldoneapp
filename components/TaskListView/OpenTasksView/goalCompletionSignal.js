/**
 * AT-2507 / AT-2565 — "the task I just completed or postponed was the LAST one this goal had for
 * today", told by the row that is leaving to the goal section that renders above it.
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
 * The alternative is that a count reaching zero is an INFERENCE while a user-facing task exit is a
 * FACT. A completing row knows before its held write goes out; a postponing row reports after its
 * short exit and immediately before its write. In both cases the goal section is still mounted, so
 * the whole probe/hold/late-arrival machinery AT-2492 needs is simply not required.
 *
 * It also makes the trigger HONEST in a way a count cannot be. A goal's today bucket empties when
 * its last task is dragged, deleted, reassigned, or re-goaled as well. Only a genuine completion or
 * a user-facing postpone out of Today is published here, so those other removals stay exactly as
 * silent as they are today. The goal's own list membership still decides whether it disappears;
 * this signal changes only whether that already-decided departure is animated.
 *
 * ── WHAT IS PUBLISHED, AND WHAT IS NOT ───────────────────────────────────────────────────────────
 *
 * Published from `TaskPresentation` — the ONE row implementation behind every surface that renders
 * a task line — rather than from `CheckBoxWrapper`, because the checkbox is not the only way a row
 * is completed: `taskCompletionHandoff.js` runs the same motion from the long-press popup
 * (`WorkflowModal`, `FollowUpModal`, `SuggestedModal`). Both go through the row's single
 * `beginCompletionMotion`, so wrapping it there covers both and cannot be forgotten by one of them.
 *
 * Completion still stands down for three kinds of tick, and each of them would otherwise animate
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
 * break the ordinary case of finishing or postponing a goal's tasks over time.
 */

/** @type {Set<Function>} */
const listeners = new Set()

/**
 * @param {Function} listener Called with `{ projectId, goalId, taskId, reason }` for every genuine
 *   completion or user-facing postpone of a list-leaving task that belongs to a goal.
 * @returns {Function} unsubscribe. Idempotent, so a double-invoked effect cleanup is harmless.
 */
export const subscribeToGoalTaskExits = listener => {
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
const publishGoalTaskExit = ({ projectId, goalId, taskId } = {}, reason) => {
    if (!projectId || !goalId || !taskId) return
    const event = { projectId, goalId, taskId, reason }
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
            console.warn('[goal task exit] listener failed', error)
        }
    })
}

export const publishGoalTaskCompletion = event => publishGoalTaskExit(event, 'completion')

/**
 * AT-2565 — a task postponed out of Today may take the goal shown only because of that task with
 * it. The task-postpone coordinator publishes at the UI boundary that already proved the mounted
 * row is leaving; the goal section still has to independently disappear from its live lists before
 * it is held for animation.
 */
export const publishGoalTaskPostpone = event => publishGoalTaskExit(event, 'postpone')

/** Backwards-compatible names for the completion-only callers and harnesses introduced first. */
export const subscribeToGoalTaskCompletions = subscribeToGoalTaskExits

/** Test seam. Never call from app code — a stray reset would silently deafen every mounted goal. */
export const resetGoalTaskExitListeners = () => {
    listeners.clear()
}

export const resetGoalTaskCompletionListeners = resetGoalTaskExitListeners
