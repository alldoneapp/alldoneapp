/**
 * AT-2193 — a task that moves to a different workflow step must stop being anybody's focus task,
 * exactly like a postponed task.
 *
 * Why this lives in the onUpdateTask trigger rather than next to each move:
 *
 *  1. Focus lives on `users/{uid}.inFocusTaskId`, and `firestore.rules` only lets a client write
 *     its OWN user doc (`allow update: if request.auth.uid == userId`). A workflow move is very
 *     often performed by someone who is not the focus holder — a reviewer hands the task on while
 *     the owner still has it focused — so the client physically cannot clear the other user's
 *     focus. Only the Admin SDK can.
 *  2. There are five separate producers of a step change (three client functions in
 *     tasksFirestore.js plus advanceTaskFromWorkflowStep / finalizeWorkflowAiRun for AI steps).
 *     The trigger is the one place all of them funnel through, so the behaviour cannot drift.
 *
 * The client still performs its own handoff for the logged-in user so the UI updates instantly;
 * this trigger is the authoritative catch-all for everyone else.
 */

const admin = require('firebase-admin')

const { OPEN_STEP, DONE_STEP, WORKSTREAM_ID_PREFIX } = require('../Utils/HelperFunctionsCloud')
const { isTaskOnUserPlate } = require('../shared/focusTaskEligibility')

// Sentinels that occupy the same fields as a real uid but are not users.
const NON_USER_REVIEWER_IDS = [OPEN_STEP, DONE_STEP, 'Open', 'Done']

/**
 * The task's current workflow step.
 *
 * `stepHistory` alone is not enough: moving a task to Done (moveTasksFromOpen / the Done branch of
 * buildWorkflowStepAdvanceUpdate) sets `done` without pushing onto stepHistory, so a completion
 * would otherwise read as "no step change".
 *
 * Deliberately ignores `currentReviewerId`: resolveVmInteractionWorkflowHold (vmInteraction.js)
 * parks that field on a different user while a VM agent asks the user a question, WITHOUT moving
 * the step (AT-2188). It is not a step change, and other step-based callers must not read it as one.
 * The focus handoff looks at the reviewer separately (hasFocusHolderChanged, AT-3124), where the
 * plate rule makes the asked user keep the task and only the user it leaves lose it.
 */
const resolveWorkflowStepId = task => {
    if (!task) return null
    if (task.done === true) return DONE_STEP
    const stepHistory = Array.isArray(task.stepHistory) ? task.stepHistory : []
    return stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : OPEN_STEP
}

const hasWorkflowStepChanged = (oldTask, newTask) => resolveWorkflowStepId(oldTask) !== resolveWorkflowStepId(newTask)

// Legacy documents store "no reviewer" as missing, null or '' interchangeably; none of those is a
// change of hands.
const normalizeHolderId = value => (value === undefined || value === null || value === '' ? null : value)

/**
 * AT-3124 — whether the write can have moved the task off somebody's plate.
 *
 * A workflow step change is the obvious case, but not the only one. Open task lists are keyed by
 * `currentReviewerId`, and that field also changes WITHOUT a step change:
 *  - a VM reviewer hold (vmWorkflowHold.js) hands the task to the user an agent asked a question
 *    (or whose run failed), and gives it back to the assistant when the question is answered or a
 *    retry starts;
 *  - reassigning the task (setTaskAssignee) gives it to a new owner and reviewer.
 *
 * Observed in production on 2026-11-21: a VM agent's question put AT-3123 on Karsten's plate, the
 * focus picker then (correctly) chose it as his next focus task, and when he answered, the hold gave
 * the task back to the assistant. The step had not changed, so nobody released the focus, and he
 * was left focusing a task his list no longer showed.
 *
 * Gating on these fields (rather than on everything) is what keeps renames, descriptions, comment
 * stamps and other unrelated writes from touching anybody's focus. Who actually loses focus is
 * still decided by the plate rule in getWorkflowFocusHandoffCandidates.
 */
const hasFocusHolderChanged = (oldTask = {}, newTask = {}) =>
    hasWorkflowStepChanged(oldTask, newTask) ||
    normalizeHolderId(oldTask.currentReviewerId) !== normalizeHolderId(newTask.currentReviewerId) ||
    normalizeHolderId(oldTask.userId) !== normalizeHolderId(newTask.userId)

const isRealUserId = candidate =>
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    !candidate.startsWith(WORKSTREAM_ID_PREFIX) &&
    !NON_USER_REVIEWER_IDS.includes(candidate)

/**
 * Everyone who could have been focusing the task before it moved and for whom it is no longer
 * actionable.
 *
 * AT-2193 follow-up: this used to skip `newTask.currentReviewerId` as a deliberate, hand-reasoned
 * exception ("the task landing on your plate is the opposite of it leaving"). That exception was
 * suspected of violating the ticket's literal wording, so it has been re-derived rather than kept
 * on a hunch: the rule is now the SAME predicate the focus pickers use — a task may be your focus
 * task exactly while it is on your plate (shared/focusTaskEligibility.js). Release focus from every
 * user the task is no longer actionable for. The incoming reviewer keeping it is now a consequence
 * of that one rule instead of a special case, so the release side and the selection side cannot
 * drift apart: whoever keeps the task focused here is precisely whoever the picker would have been
 * allowed to hand it to anyway.
 *
 * Returns [] when neither the step, the current reviewer nor the owner changed, which is what keeps
 * unrelated task updates (renames, descriptions, estimations, assistant comments) from touching
 * anybody's focus.
 *
 * AT-3124: a reviewer-only change (a VM hold starting or ending) or an owner change counts too. The
 * user a VM hold hands the task to keeps it (it is on their plate now); the user it is handed back
 * away from loses it. Assistants have no user document with a focus task, so the assistant side of
 * a hold is a no-op in releaseFocusTaskForUser.
 */
const getWorkflowFocusHandoffCandidates = (oldTask = {}, newTask = {}) => {
    // Subtasks mirror their parent's stepHistory (updateSubtasksState), so acting on them would
    // repeat the parent's handoff once per subtask.
    if (newTask.parentId) return []
    if (!hasFocusHolderChanged(oldTask, newTask)) return []

    const previousUserIds = Array.isArray(oldTask.userIds) ? oldTask.userIds : []
    // Also consider the destination's participants: a user can have focused the task while only
    // being a later step's reviewer, in which case they never appear in the old task's userIds.
    const nextUserIds = Array.isArray(newTask.userIds) ? newTask.userIds : []

    const candidates = [oldTask.userId, newTask.userId, oldTask.currentReviewerId, ...previousUserIds, ...nextUserIds]

    const handoffUserIds = []
    for (const candidate of candidates) {
        if (!isRealUserId(candidate)) continue
        // Still theirs to act on — the one rule, shared with the pickers.
        if (isTaskOnUserPlate(newTask, candidate)) continue
        if (handoffUserIds.includes(candidate)) continue
        handoffUserIds.push(candidate)
    }
    return handoffUserIds
}

/**
 * Postpone semantics: hand the user their next focus task rather than leaving them with none.
 * findAndSetNewFocusTask returns null when it finds no replacement, and unlike the client it does
 * NOT clear in that case, so clearFocusTask is the explicit fallback that makes the guarantee in
 * the ticket ("it should no longer be the focus task") hold either way.
 *
 * clearFocusTask re-checks that the user's focus is still this task, so a user who moved on
 * between our read and this write is left alone.
 */
const releaseFocusTaskForUser = async (userId, projectId, taskId, task, deps) => {
    const { focusTaskService, database } = deps

    const userSnapshot = await database.doc(`users/${userId}`).get()
    if (!userSnapshot.exists) return false

    const userData = userSnapshot.data() || {}
    if (userData.inFocusTaskId !== taskId) return false

    let timezoneOffset = null
    try {
        const { resolveTimezoneContext, getMomentInTimezone } = require('./autoPostponeTasksCloud')
        timezoneOffset = getMomentInTimezone(Date.now(), resolveTimezoneContext(userData)).utcOffset()
    } catch (error) {
        // Falls back to UTC, matching FocusTaskService's own default.
        console.warn('[workflowFocusHandoff] Could not resolve timezone, using UTC', { userId })
    }

    // AT-2251: `taskId` is passed to keep the task that just left focus OUT of the candidate list —
    // it is not a request for variety, and since this ticket it no longer reads as one. The
    // `expectedCurrentFocusTaskId` guard makes the write conditional on the focus still being that
    // task at commit time: selection costs many round trips, and the client runs its own handoff for
    // the acting user in parallel, so without it this trigger routinely landed second and replaced
    // the task the user was already looking at.
    const replacement = await focusTaskService.findAndSetNewFocusTask(
        userId,
        projectId,
        task.parentGoalId || null,
        taskId,
        timezoneOffset,
        null,
        { expectedCurrentFocusTaskId: taskId }
    )

    if (!replacement) await focusTaskService.clearFocusTask(userId, taskId)

    console.log('[workflowFocusHandoff] Released focus task after it left the user (step, reviewer or owner)', {
        userId,
        projectId,
        taskId,
        replacementTaskId: replacement ? replacement.id : null,
    })
    return true
}

/**
 * Entry point wired into onUpdateTask. Best-effort by design: the task has already moved, so a
 * focus failure must never make the move itself look like it failed.
 */
const releaseFocusTaskOnWorkflowStepChange = async (projectId, taskId, oldTask, newTask, deps = {}) => {
    const handoffUserIds = getWorkflowFocusHandoffCandidates(oldTask, newTask)
    if (handoffUserIds.length === 0) return []

    const database = deps.database || admin.firestore()
    let focusTaskService = deps.focusTaskService
    if (!focusTaskService) {
        const { FocusTaskService } = require('../shared/FocusTaskService')
        focusTaskService = new FocusTaskService({ database })
    }

    const released = []
    for (const userId of handoffUserIds) {
        try {
            const didRelease = await releaseFocusTaskForUser(userId, projectId, taskId, newTask || {}, {
                focusTaskService,
                database,
            })
            if (didRelease) released.push(userId)
        } catch (error) {
            console.error('[workflowFocusHandoff] Failed to release focus task', {
                userId,
                projectId,
                taskId,
                error: error.message,
            })
            // AT-3124: when picking a replacement fails, an empty focus is still better than a
            // focus task the user can no longer see. clearFocusTask only clears while the focus is
            // still this task, so a user who already moved on is left alone.
            try {
                const result = await focusTaskService.clearFocusTask(userId, taskId)
                if (result && result.cleared) released.push(userId)
            } catch (clearError) {
                console.error('[workflowFocusHandoff] Fallback clear failed', {
                    userId,
                    taskId,
                    error: clearError.message,
                })
            }
        }
    }
    return released
}

module.exports = {
    resolveWorkflowStepId,
    hasWorkflowStepChanged,
    hasFocusHolderChanged,
    getWorkflowFocusHandoffCandidates,
    releaseFocusTaskOnWorkflowStepChange,
}
