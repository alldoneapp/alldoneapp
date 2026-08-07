/**
 * AT-2191 — keeps the optimistic focus task correct when the user postpones the focus task several
 * times in a row, faster than the backend can confirm any of it.
 *
 * The focus task is mirrored in two places that disagree for a whole round trip: the CONFIRMED
 * value (`users/{uid}.inFocusTaskId`, reaching Redux as `loggedUser` and as the project member
 * record behind TasksHelper.getUserInProject) and the OPTIMISTIC slice the task list actually
 * renders from (`optimisticFocus*` in redux/store.js). Everything below exists because of that gap.
 *
 * Two distinct defects live here:
 *
 * 1. "Is this the focus task?" has to consult BOTH mirrors. Asking only the confirmed one means the
 *    second postpone of a burst compares the newly (optimistically) focused task against the task
 *    postponed FIRST, concludes it is not the focus task, and skips the swap altogether — no new
 *    optimistic focus, no backend search. That is the reported bug.
 *
 * 2. The backend searches started by each postpone overlap, and the older one must not win.
 *    findAndSetNewFocusedTask ends in setNewFocusedTaskBatch, which re-dates the task it picks to
 *    `now` (setTaskDueDate with fromSetTaskFocus=true). A search started by postpone #1 that lands
 *    after postpone #2 would therefore UN-POSTPONE the task the user just pushed away and re-focus
 *    it, and would then clear an optimistic state that no longer belongs to it. Handoffs are
 *    numbered so a superseded one aborts instead of writing.
 *
 * Kept in its own module — like workflowFocusHandoff.js does for AT-2193 — so the rules are unit
 * testable without standing up Firestore or the Redux store.
 */

/** Highest handoff number issued so far. Only the highest one is allowed to write. */
let latestHandoffId = 0

/** Handoffs that have been issued but have not settled yet. */
const openHandoffIds = new Set()

/**
 * Tasks pushed out of "today" (or completed) while a handoff was open.
 *
 * Both candidate sources lag the write that released them: Redux `openTasksMap` waits for the
 * Firestore listener, and even Firestore's own query in findAndSetNewFocusedTask can be served
 * before the local mutation is visible. Without this set, postpone #3 of a burst can hand focus
 * straight back to the task postponed in step #1, which is still `dueDate <= endOfToday` as far as
 * either source can tell.
 */
const releasedTaskIds = new Set()

/**
 * Safety valve. The set is normally emptied the moment the last open handoff settles; this only
 * matters if one somehow never does, so that a leak degrades into "slightly stale exclusions"
 * rather than "this task can never be focused again".
 */
const MAX_RELEASED_TASK_IDS = 50

/**
 * Matching valve for the handoffs themselves. A caller whose commit throws between opening a
 * handoff and settling it leaves it open forever, and the exclusions only drop when the LAST one
 * settles — so one leak would keep a task unfocusable for the rest of the session. An open handoff
 * this far behind the newest is therefore treated as abandoned, which heals the leak after a
 * handful of later postponements.
 */
const MAX_HANDOFF_LAG = 20

/**
 * Open a handoff for a task that is losing focus, and return its number. Pass the released task id
 * so later picks in the same burst cannot choose it again.
 */
export const startFocusHandoff = releasedTaskId => {
    latestHandoffId += 1
    openHandoffIds.add(latestHandoffId)

    const abandonedBefore = latestHandoffId - MAX_HANDOFF_LAG
    openHandoffIds.forEach(handoffId => {
        if (handoffId <= abandonedBefore) openHandoffIds.delete(handoffId)
    })

    if (releasedTaskId) {
        releasedTaskIds.add(releasedTaskId)
        while (releasedTaskIds.size > MAX_RELEASED_TASK_IDS) {
            releasedTaskIds.delete(releasedTaskIds.values().next().value)
        }
    }

    return latestHandoffId
}

/**
 * Invalidate every in-flight handoff without opening one. Used when something else becomes the
 * authoritative focus writer — a manual focus toggle — so a postpone's late backend search cannot
 * overwrite the choice the user just made by hand.
 */
export const supersedeFocusHandoffs = () => {
    latestHandoffId += 1
    return latestHandoffId
}

/**
 * Whether a newer handoff has taken over, i.e. this one must not write.
 *
 * Deliberately permissive for anything that is not a tracked handoff id: a caller that opted out of
 * the sequencing keeps its previous behaviour instead of silently never writing.
 */
export const isFocusHandoffSuperseded = handoffId => Number.isInteger(handoffId) && handoffId !== latestHandoffId

/** Settle a handoff. Idempotent. The released-task exclusions drop when the last one settles. */
export const finishFocusHandoff = handoffId => {
    if (!openHandoffIds.delete(handoffId)) return
    if (openHandoffIds.size === 0) releasedTaskIds.clear()
}

/** Whether a task was released by a still-unsettled handoff and must not be picked as focus. */
export const isFocusTaskReleased = taskId => !!taskId && releasedTaskIds.has(taskId)

/**
 * The full exclusion set for a focus search: everything released by the current burst, plus the one
 * task the caller already knew to exclude.
 */
export const buildFocusCandidateExclusions = excludeTaskId => {
    const exclusions = new Set(releasedTaskIds)
    if (excludeTaskId) exclusions.add(excludeTaskId)
    return exclusions
}

/** Normalizes the optimistic focus slice into the shape isTaskHoldingFocus expects. */
export const readOptimisticFocus = (state = {}) => ({
    active: !!state.optimisticFocusActive,
    taskId: state.optimisticFocusTaskId || null,
    projectId: state.optimisticFocusTaskProjectId || null,
    userId: state.optimisticFocusUserId || null,
})

/**
 * Whether `taskId` is the focus task as far as the user can tell — confirmed by the backend OR
 * optimistically shown in the list right now.
 *
 * The optimistic side is matched strictly on project and focus holder when both are known, so a
 * swap happening in one project cannot make an unrelated task elsewhere look focused. A missing
 * `projectId`/`userId` on either side is treated as "unknown, do not use to reject", which keeps
 * older dispatches that predate those fields working.
 */
export const isTaskHoldingFocus = ({ taskId, projectId, focusUserId, confirmedFocusTaskId, optimisticFocus } = {}) => {
    if (!taskId) return false
    if (confirmedFocusTaskId && confirmedFocusTaskId === taskId) return true

    if (!optimisticFocus || !optimisticFocus.active) return false
    if (optimisticFocus.taskId !== taskId) return false
    if (optimisticFocus.projectId && projectId && optimisticFocus.projectId !== projectId) return false
    if (optimisticFocus.userId && focusUserId && optimisticFocus.userId !== focusUserId) return false

    return true
}

/** Test seam — module state is intentionally process-wide at runtime. */
export const resetFocusHandoffTracking = () => {
    latestHandoffId = 0
    openHandoffIds.clear()
    releasedTaskIds.clear()
}
