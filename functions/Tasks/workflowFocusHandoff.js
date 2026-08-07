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
 * the step (AT-2188). Treating that as a step change would drop the focus task every time an agent
 * asked something.
 */
const resolveWorkflowStepId = task => {
    if (!task) return null
    if (task.done === true) return DONE_STEP
    const stepHistory = Array.isArray(task.stepHistory) ? task.stepHistory : []
    return stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : OPEN_STEP
}

const hasWorkflowStepChanged = (oldTask, newTask) => resolveWorkflowStepId(oldTask) !== resolveWorkflowStepId(newTask)

const isRealUserId = candidate =>
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    !candidate.startsWith(WORKSTREAM_ID_PREFIX) &&
    !NON_USER_REVIEWER_IDS.includes(candidate)

/**
 * Everyone who could have been focusing the task before it moved, minus whoever holds it now.
 *
 * The task landing on your plate is the opposite of it leaving your plate, so the incoming
 * reviewer keeps its focus if they had it — only the people it moved AWAY from lose it. This also
 * keeps a backward move to Open from un-focusing the owner it just returned to.
 *
 * Returns [] when the step did not actually change, which is what keeps unrelated task updates
 * (renames, descriptions, estimations, assistant comments, VM interaction holds) from touching
 * anybody's focus.
 */
const getWorkflowFocusHandoffCandidates = (oldTask = {}, newTask = {}) => {
    // Subtasks mirror their parent's stepHistory (updateSubtasksState), so acting on them would
    // repeat the parent's handoff once per subtask.
    if (newTask.parentId) return []
    if (!hasWorkflowStepChanged(oldTask, newTask)) return []

    const incomingReviewerId = newTask.currentReviewerId
    const previousUserIds = Array.isArray(oldTask.userIds) ? oldTask.userIds : []

    const candidates = [oldTask.userId, newTask.userId, oldTask.currentReviewerId, ...previousUserIds]

    const handoffUserIds = []
    for (const candidate of candidates) {
        if (!isRealUserId(candidate)) continue
        if (candidate === incomingReviewerId) continue
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

    const replacement = await focusTaskService.findAndSetNewFocusTask(
        userId,
        projectId,
        task.parentGoalId || null,
        taskId,
        timezoneOffset
    )

    if (!replacement) await focusTaskService.clearFocusTask(userId, taskId)

    console.log('[workflowFocusHandoff] Released focus task after workflow step change', {
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
        }
    }
    return released
}

module.exports = {
    resolveWorkflowStepId,
    hasWorkflowStepChanged,
    getWorkflowFocusHandoffCandidates,
    releaseFocusTaskOnWorkflowStepChange,
}
