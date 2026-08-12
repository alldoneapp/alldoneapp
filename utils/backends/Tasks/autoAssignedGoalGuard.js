import { isEqual } from 'lodash'

/**
 * AT-2277 - a task save must never clear a goal it has not seen yet.
 *
 * The goal router (`functions/Tasks/taskGoalRouting.js`) assigns a goal to a freshly created task
 * from the backend: one transaction writes `parentGoalId` + `parentGoalIsPublicFor` + `lockKey` +
 * `goalSuggestion` AND the "Added <task> to <goal>" undo record. That is why the Undo toast is
 * proof the assignment really happened - it cannot be written without it.
 *
 * The client then takes it away again. `updateTask` persists the *whole* task document, and every
 * editor saves from an in-memory copy it took when it opened. A copy taken before the router's
 * write still says "no goal", so the save writes `parentGoalId: null` over the assignment seconds
 * after it landed - leaving exactly the state seen in production: `goalSuggestion.status ===
 * 'auto_assigned'` naming a goal, and no `parentGoalId`. The user saw the Undo message and the task
 * never joined the goal.
 *
 * AT-2267 already fixed the one editor it could reach (`EditTask` via `mergeBackgroundTaskUpdates`),
 * but only for an editor opened on an *existing* task: the "add a task and keep typing" flow starts
 * with no opened-task baseline, and the other save paths never had the fix at all. So the rule
 * belongs at the write choke point, where every editor funnels through.
 *
 * The rule is deliberately narrow, and it is the *pairing* that makes it safe: `parentGoalId` and
 * `goalSuggestion` are written together by the router, so a payload that disagrees with the live
 * document about the suggestion is by construction stale about the goal as well. Concretely, the
 * goal fields are taken from the live task only when ALL of the following hold:
 *
 *  - the live task carries a goal the router auto-assigned (`goalSuggestion.status ===
 *    'auto_assigned'` and `goalSuggestion.goalId === parentGoalId`),
 *  - the payload would leave the task with no goal at all, and
 *  - the payload has never seen that assignment (its `goalSuggestion` is not the live one).
 *
 * Everything else is left alone. A user deliberately removing the goal from a view that already
 * shows it carries the live `goalSuggestion`, so the removal goes through. Picking a *different*
 * goal goes through, because the payload is not clearing the goal. Once the goal is gone (or the
 * suggestion was accepted, dismissed, superseded or undone) the live task no longer matches
 * `isRouterAssignedGoal`, so the guard switches itself off and can never resurrect a goal.
 */

export const AUTO_ASSIGNED_GOAL_FIELDS = ['parentGoalId', 'parentGoalIsPublicFor', 'lockKey', 'goalSuggestion']

/** The live task holds a goal that the goal router assigned on its own. */
export const isRouterAssignedGoal = liveTask =>
    !!liveTask?.parentGoalId &&
    liveTask.goalSuggestion?.status === 'auto_assigned' &&
    liveTask.goalSuggestion?.goalId === liveTask.parentGoalId

/**
 * Whether the payload was built from a snapshot that already contained the router's assignment.
 *
 * `claimId` identifies one routing run, so it is the cheapest reliable marker; a payload that
 * simply agrees with the live `goalSuggestion` counts too, which keeps the check working for
 * legacy documents written before `claimId` existed.
 */
export const payloadSawAssignment = (payloadTask, liveTask) => {
    const live = liveTask?.goalSuggestion
    const payload = payloadTask?.goalSuggestion
    if (!live || !payload) return false
    if (live.claimId || payload.claimId) return live.claimId === payload.claimId && payload.status === live.status
    return isEqual(payload, live)
}

/** True when saving `payloadTask` would silently drop a goal the router just assigned. */
export const clearsUnseenAutoAssignedGoal = (payloadTask, liveTask) =>
    !!payloadTask &&
    !payloadTask.parentGoalId &&
    isRouterAssignedGoal(liveTask) &&
    !payloadSawAssignment(payloadTask, liveTask)

/**
 * Returns `payloadTask` with the goal fields restored from `liveTask` when - and only when - the
 * payload would have dropped a goal it never saw. The payload is returned untouched otherwise, so
 * callers can apply this unconditionally without changing object identity in the common case.
 */
export const preserveAutoAssignedGoal = (payloadTask, liveTask) => {
    if (!clearsUnseenAutoAssignedGoal(payloadTask, liveTask)) return payloadTask

    const preserved = { ...payloadTask }
    AUTO_ASSIGNED_GOAL_FIELDS.forEach(field => {
        preserved[field] = liveTask[field]
    })
    return preserved
}

export default preserveAutoAssignedGoal
