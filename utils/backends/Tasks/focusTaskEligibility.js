/**
 * AT-2193 — client mirror of functions/shared/focusTaskEligibility.js.
 *
 * A task may only be somebody's focus task while it is actually on their plate. Open task lists are
 * keyed by `currentReviewerId`, so that field is the app's own definition of "mine to act on right
 * now", and it is what both focus pickers must respect: releasing a focus task on a workflow move
 * is pointless if the replacement picked is itself parked in another reviewer's step.
 *
 * Cloud Functions cannot import from outside functions/, so this rule is duplicated rather than
 * shared. Keep it in sync with functions/shared/focusTaskEligibility.js.
 */

/**
 * Whether `task` is currently on `userId`'s plate, i.e. whether they are the one expected to act on
 * it right now.
 */
export const isTaskOnUserPlate = (task, userId) => {
    if (!task || !userId) return false

    const reviewerId = task.currentReviewerId

    // Legacy documents written before `currentReviewerId` existed record no holder; fall back to
    // ownership so the picker does not starve on old data.
    if (reviewerId === undefined || reviewerId === null || reviewerId === '') return task.userId === userId

    return reviewerId === userId
}

/**
 * Convenience wrapper for the candidate lists the focus pickers build.
 */
export const filterTasksOnUserPlate = (tasks, userId) =>
    (Array.isArray(tasks) ? tasks : []).filter(task => isTaskOnUserPlate(task, userId))
