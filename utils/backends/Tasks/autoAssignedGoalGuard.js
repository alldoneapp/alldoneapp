import { isEqual } from 'lodash'

/**
 * AT-2277 - a task save must never clear goal-routing state it has not seen yet.
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
 * The original guard covered the destructive version of that race: an unseen automatic assignment.
 * There is a quieter version too. The router first writes `status: 'classifying'`, then replaces the
 * whole `goalSuggestion` with a terminal result. A title save made from the intermediate snapshot can
 * put `classifying` back after the function has returned, leaving the list animation running forever.
 * Therefore the goal fields are also kept when the live task has a terminal result from the same
 * routing claim and the payload has only seen the claim phase (or predates the claim entirely).
 *
 * The rule remains deliberately narrow, and it is the *pairing* that makes it safe: `parentGoalId`
 * and `goalSuggestion` are written together by the router, so a payload that disagrees with the live
 * document about the suggestion is by construction stale about the goal as well. Concretely, the
 * goal fields are taken from the live task only when either the original automatic-assignment guard
 * matches:
 *
 *  - the live task carries a goal the router auto-assigned (`goalSuggestion.status ===
 *    'auto_assigned'` and `goalSuggestion.goalId === parentGoalId`),
 *  - the payload would leave the task with no goal at all, and
 *  - the payload has never seen that assignment (its `goalSuggestion` is not the live one).
 *
 * Or the terminal-result guard matches:
 *
 *  - the live suggestion comes from `task_goal_router` and is no longer `classifying`,
 *  - the payload has no suggestion or still says `classifying` for the same claim, and
 *  - the payload is not explicitly selecting a different goal.
 *
 * Everything else is left alone. A user deliberately removing the goal from a view that already
 * shows it carries the live `goalSuggestion`, so the removal goes through. Picking a *different*
 * goal goes through, because the payload is not clearing the goal. A payload that already carries
 * a terminal suggestion also goes through; only a payload that demonstrably predates the live
 * result is repaired.
 */

export const AUTO_ASSIGNED_GOAL_FIELDS = ['parentGoalId', 'parentGoalIsPublicFor', 'lockKey', 'goalSuggestion']

const TASK_GOAL_ROUTING_SOURCE = 'task_goal_router'
const TASK_GOAL_ROUTING_STATUS_CLASSIFYING = 'classifying'

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

/** True when a full-document save would replace a newer terminal router result with an old claim. */
export const hasUnseenSettledGoalRouting = (payloadTask, liveTask) => {
    if (!payloadTask || !liveTask) return false

    const payloadSuggestion = payloadTask.goalSuggestion
    const liveSuggestion = liveTask.goalSuggestion
    if (
        !liveSuggestion ||
        liveSuggestion.source !== TASK_GOAL_ROUTING_SOURCE ||
        !liveSuggestion.status ||
        liveSuggestion.status === TASK_GOAL_ROUTING_STATUS_CLASSIFYING
    ) {
        return false
    }

    // A non-null, different goal is an explicit user choice, not a stale background field.
    if (payloadTask.parentGoalId && payloadTask.parentGoalId !== liveTask.parentGoalId) return false

    // Null means the editor predates the claim. Classifying means it saw the claim but not its result.
    if (payloadSuggestion && payloadSuggestion.status !== TASK_GOAL_ROUTING_STATUS_CLASSIFYING) return false

    const payloadClaimId = payloadSuggestion?.claimId
    const liveClaimId = liveSuggestion.claimId
    if (payloadClaimId && (!liveClaimId || payloadClaimId !== liveClaimId)) return false

    return true
}

/**
 * Returns `payloadTask` with the goal fields restored from `liveTask` when - and only when - the
 * payload would regress routing state it never saw. The payload is returned untouched otherwise,
 * so callers can apply this unconditionally without changing object identity in the common case.
 */
export const preserveAutoAssignedGoal = (payloadTask, liveTask) => {
    if (!clearsUnseenAutoAssignedGoal(payloadTask, liveTask) && !hasUnseenSettledGoalRouting(payloadTask, liveTask)) {
        return payloadTask
    }

    const preserved = { ...payloadTask }
    AUTO_ASSIGNED_GOAL_FIELDS.forEach(field => {
        preserved[field] = liveTask[field]
    })
    return preserved
}

export default preserveAutoAssignedGoal
