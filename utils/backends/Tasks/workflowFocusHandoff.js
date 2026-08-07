/**
 * AT-2193 — client half of the "a workflow step change drops the focus task" rule.
 *
 * `firestore.rules` only allows a client to write its OWN user doc, so this side can only ever
 * release the LOGGED-IN user's focus. Every other focus holder (typically the task owner, while a
 * reviewer is the one moving the task on) is handled by the Admin SDK in
 * functions/Tasks/workflowFocusHandoff.js, which runs off the onUpdateTask trigger.
 *
 * Doing it here as well is what makes the swap feel instant instead of waiting for the trigger to
 * round-trip, and it is the only path that can dispatch the optimistic focus state the task list
 * renders from.
 *
 * Keep the "who loses focus" rule in sync with functions/Tasks/workflowFocusHandoff.js
 * (Cloud Functions cannot import from outside functions/).
 */

import { isTaskOnUserPlate } from './focusTaskEligibility'

/**
 * Whether `focusUserId` should hand their focus task off because `taskId` just moved to another
 * workflow step.
 *
 * `observedFocusTaskIds` is OR-ed rather than read from a single source because the logged user's
 * focus is mirrored in two places that can briefly disagree: the `loggedUser` slice (their own user
 * doc) and the project member list behind TasksHelper.getUserInProject.
 *
 * The "incoming reviewer keeps the task" behaviour is not a special case: it falls out of the one
 * rule shared with the focus pickers — a task may be your focus task exactly while it is on your
 * plate (focusTaskEligibility.js). Expressing it that way is what keeps the release side and the
 * selection side from disagreeing, which is the bug this ticket came back for: releasing focus is
 * pointless if the replacement picked is itself parked in another reviewer's step.
 */
export const shouldReleaseFocusOnWorkflowMove = ({
    taskId,
    focusUserId,
    observedFocusTaskIds = [],
    incomingReviewerId,
} = {}) => {
    if (!taskId || !focusUserId) return false
    if (isTaskOnUserPlate({ currentReviewerId: incomingReviewerId }, focusUserId)) return false
    return observedFocusTaskIds.some(observedId => observedId === taskId)
}
