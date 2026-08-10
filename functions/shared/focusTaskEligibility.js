/**
 * AT-2193 — which tasks may be the focus task at all.
 *
 * The ticket ("when a task goes to a different workflow step it should no longer be the focus
 * task") has two halves. Releasing focus from the users the task left is the obvious half and is
 * handled by functions/Tasks/workflowFocusHandoff.js. This file is the half that was missing: the
 * replacement the release then picks must not itself be a task parked in somebody else's workflow
 * step, otherwise the release just swaps one parked task for another and the user sees exactly the
 * symptom the ticket describes.
 *
 * Observed in production on 2026-08-07 at 14:36:07: the handoff correctly released
 * "suggested by tasks: allow to accept or reject all at once" and immediately handed the user
 * "when an assistant creates a note, make the assistant the owner", a task already sitting in step
 * -Oy32IXs with the AI assistant as its reviewer. Both pickers query only
 * `userId`/`done`/`inDone`/`isSubtask`, so a task the user OWNS but has already handed on is a
 * perfectly valid candidate.
 *
 * The criterion is the app's own notion of "in my open list". From vmInteraction.js:
 * "Open task lists are keyed by `currentReviewerId`". So a task is actionable by a user — and
 * therefore focusable by them — exactly while they are its current reviewer. In the Open step that
 * is the owner (TaskModelBuilder writes `currentReviewerId: currentReviewerId || userId`), which is
 * why this single check covers Open tasks without special-casing them.
 *
 * Using `currentReviewerId` rather than `stepHistory` also keeps the AT-2188 VM interaction hold
 * working: while an agent is asking a question the task stays on its step but the reviewer is
 * temporarily parked on the user who has to answer, so the task correctly counts as theirs.
 *
 * Mirrored for the client in utils/backends/Tasks/focusTaskEligibility.js — Cloud Functions cannot
 * import from outside functions/, so the rule is duplicated rather than shared. Keep them in sync.
 */

/**
 * Whether `task` is currently on `userId`'s plate, i.e. whether they are the one expected to act on
 * it right now.
 *
 * @param {Object} task - task document data
 * @param {string} userId - the user the focus task is being chosen for
 * @returns {boolean}
 */
const isTaskOnUserPlate = (task, userId) => {
    if (!task || !userId) return false

    const reviewerId = task.currentReviewerId

    // Documents written before `currentReviewerId` existed have no holder recorded. Falling back to
    // ownership keeps the picker from starving on old data rather than treating every legacy task
    // as unavailable.
    if (reviewerId === undefined || reviewerId === null || reviewerId === '') return task.userId === userId

    return reviewerId === userId
}

/**
 * Convenience wrapper for the candidate lists the focus pickers build.
 */
const filterTasksOnUserPlate = (tasks, userId) =>
    (Array.isArray(tasks) ? tasks : []).filter(task => isTaskOnUserPlate(task, userId))

module.exports = {
    isTaskOnUserPlate,
    filterTasksOnUserPlate,
}
