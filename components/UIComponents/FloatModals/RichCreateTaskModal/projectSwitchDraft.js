import { FEED_PUBLIC_FOR_ALL } from '../../../Feeds/Utils/FeedsConstants'

/**
 * What a draft task may keep when its project changes (PT-4745).
 *
 * The add-task popup now shows the project switcher at EVERY entry point, so a
 * draft that was started inside a goal, a note, a contact or a chat can have its
 * project changed before it is ever written. Before PT-4745 that could only
 * happen from the two All Projects entry points, where the draft is empty and
 * belongs to the logged user — so nothing in it could dangle.
 *
 * It can now. A project id is not a label on a task, it is the Firestore path
 * the task lives under, and several of the draft's fields are ids that are only
 * meaningful UNDER THAT PATH:
 *
 * - `parentGoalId` is `goals/{projectId}/...`. Carried into another project it
 *   points at nothing: the task is created with a goal link that resolves
 *   nowhere, and `RichCreateTaskModal`'s `Backend.watchGoal(projectId, parentGoalId)`
 *   watches a document that does not exist, so the popup's goal chip never
 *   resolves either. `lockKey`/`parentGoalIsPublicFor` are that goal's, so they
 *   go with it.
 * - `userId`/`currentReviewerId`/`observersIds` are project MEMBERS. Assigning a
 *   task to somebody who is not in the target project produces a task nobody can
 *   see in their list. Workstream ids (`WS_…`) are project-scoped too, so the
 *   same applies.
 * - `isPublicFor` on a private task is a list of member ids. Dangling ids there
 *   are the sharpest failure of the set, because the task silently becomes
 *   visible to nobody.
 *
 * Two deliberate rules:
 *
 * 1. The reset is by REPLACEMENT, never by dropping a field. A private draft
 *    stays private (`isPrivate` is never touched) and is narrowed to "visible to
 *    me" in the new project — turning it public would leak a task the user
 *    explicitly marked private, which is far worse than losing the audience.
 * 2. The assignee falls back to the LOGGED USER, not to the board owner the
 *    popup was opened on. The logged user is the one person guaranteed to be a
 *    member of every project the picker can offer, since the picker is built
 *    from their own project list.
 *
 * A membership lookup (`TasksHelper.getUserInProject`) is deliberately NOT used
 * to decide this: per-project user collections are loaded lazily, so a miss
 * there means "not loaded yet" as often as it means "not a member" (see the
 * AT-2386 note on that helper), and a wrong answer either keeps a dangling
 * assignee or silently reassigns a colleague's task. The unconditional rule is
 * predictable and needs no data to be correct.
 *
 * Pure on purpose — the component only decides WHEN a switch happened, this
 * decides what it costs.
 *
 * @param {object} task the draft task
 * @param {string} loggedUserId uid of the logged user
 * @returns {object} a new draft, or the same reference when nothing had to change
 */
export const applyProjectSwitchToDraft = (task, loggedUserId) => {
    if (!task) return task

    const keepsAssignee = !loggedUserId || task.userId === loggedUserId
    const hasObservers = !!task.observersIds && task.observersIds.length > 0
    const hasParentGoal = !!task.parentGoalId
    // A public draft carries no member ids, so there is nothing to narrow.
    const narrowsPrivacy = !!task.isPrivate && !!loggedUserId && !isPrivateToOnly(task.isPublicFor, loggedUserId)

    if (keepsAssignee && !hasObservers && !hasParentGoal && !narrowsPrivacy) return task

    const switched = { ...task }

    if (hasParentGoal) {
        switched.parentGoalId = null
        switched.parentGoalIsPublicFor = null
        switched.lockKey = ''
    }

    if (hasObservers) {
        switched.observersIds = []
        // Both are keyed BY observer id, so they are the same dangling ids in a
        // different shape and must not outlive the list they belong to.
        if (switched.dueDateByObserversIds) switched.dueDateByObserversIds = {}
        if (switched.estimationsByObserverIds) switched.estimationsByObserverIds = {}
    }

    if (!keepsAssignee) {
        switched.userId = loggedUserId
        switched.userIds = [loggedUserId]
        switched.currentReviewerId = loggedUserId
        // `creatorId` follows the assignee here exactly as it does in the
        // popup's own `saveAssignee`, and matches `getNewDefaultTask`'s default.
        switched.creatorId = loggedUserId
        // "Suggested by" only means anything while the task is assigned to
        // somebody else; the draft is the logged user's own again.
        switched.suggestedBy = null
    }

    if (narrowsPrivacy) switched.isPublicFor = [loggedUserId]

    return switched
}

const isPrivateToOnly = (isPublicFor, loggedUserId) =>
    Array.isArray(isPublicFor) &&
    isPublicFor.length === 1 &&
    isPublicFor[0] === loggedUserId &&
    loggedUserId !== FEED_PUBLIC_FOR_ALL

export default applyProjectSwitchToDraft
