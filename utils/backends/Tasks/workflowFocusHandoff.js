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

/**
 * Whether `focusUserId` should hand their focus task off because `taskId` just moved to another
 * workflow step.
 *
 * `observedFocusTaskIds` is OR-ed rather than read from a single source because the logged user's
 * focus is mirrored in two places that can briefly disagree: the `loggedUser` slice (their own user
 * doc) and the project member list behind TasksHelper.getUserInProject.
 *
 * A user who is the step's INCOMING reviewer keeps the task: it just landed on their plate, which
 * is the opposite of it leaving. This is also what stops a backward move to Open from un-focusing
 * the owner it was just handed back to.
 */
export const shouldReleaseFocusOnWorkflowMove = ({
    taskId,
    focusUserId,
    observedFocusTaskIds = [],
    incomingReviewerId,
} = {}) => {
    if (!taskId || !focusUserId) return false
    if (focusUserId === incomingReviewerId) return false
    return observedFocusTaskIds.some(observedId => observedId === taskId)
}
