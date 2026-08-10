/**
 * Temporary reviewer holds for VM jobs.
 *
 * A VM job can reach a point where the task needs a human even though the work of its workflow step
 * is not finished: the agent stops to ask a question, or the run fails outright. In both cases the
 * task must stay exactly where it is — same `stepHistory`, same workflow position, no
 * `completed`/`done` timestamps, no subtask moves — because the step was never performed. Advancing
 * would hand the task to the next reviewer for work nobody did, consume the parked `workflowAiRuns`
 * step (`finalizeWorkflowAiRun` only advances a task it still finds on its own step) and look like a
 * completed step to `awardGoldForTaskProgress`.
 *
 * Open task lists are keyed by `currentReviewerId`, so the only thing that changes is a temporary
 * hold: the current step is handed to the requesting user so the task (and its comment) shows up in
 * their list. The displaced reviewer is recorded on the task so it can be given back.
 *
 * Two reasons share one hold field, because a task can only sensibly be held once:
 *  - `interaction` — the agent asked something. Released as soon as the interaction is answered or
 *    cancelled (see vmInteraction.js).
 *  - `failure` — the run failed or was cancelled (AT-2196). There is no answer to wait for, so the
 *    hold is released when a new VM run actually starts on that task (a retry hands the task back to
 *    the workflow reviewer while the VM works) or when the workflow/user moves the task on.
 */

const VM_WORKFLOW_HOLD_FIELD = 'vmInteractionWorkflowStep'
const VM_HOLD_REASON_INTERACTION = 'interaction'
const VM_HOLD_REASON_FAILURE = 'failure'

function getVmHoldTaskRef(db, pending) {
    if (!db || !pending || !pending.projectId || !pending.objectId) return null
    if ((pending.objectType || 'tasks') !== 'tasks') return null
    return db.doc(`items/${pending.projectId}/tasks/${pending.objectId}`)
}

function getCurrentWorkflowStepId(task) {
    const stepHistory = Array.isArray(task?.stepHistory) ? task.stepHistory : []
    return stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : null
}

// Holds written before reasons existed are interaction holds.
function getHoldReason(hold) {
    return hold?.reason || VM_HOLD_REASON_INTERACTION
}

/**
 * Decides the hold for an agent question. Returns the hold to record, and whether it still has to be
 * written.
 */
function resolveVmInteractionWorkflowHold(task, correlationId, requestId, reviewerId, triggeredAt) {
    const existing = task[VM_WORKFLOW_HOLD_FIELD]

    if (existing && existing.correlationId === correlationId) {
        // A retry of the very same question: the hold already describes it.
        if (existing.requestId === requestId && getHoldReason(existing) === VM_HOLD_REASON_INTERACTION) {
            return { hold: existing, changed: false }
        }
        // A follow-up question from the same job. Keep the originally displaced reviewer so the
        // final release still restores the real workflow reviewer rather than the user themself.
        return {
            hold: { ...existing, requestId, triggeredAt, reason: VM_HOLD_REASON_INTERACTION },
            changed: true,
        }
    }

    // Another job already holds this task, or the task is already the asking user's to act on.
    if (existing || task.currentReviewerId === reviewerId) return { hold: existing || null, changed: false }

    return {
        hold: {
            correlationId,
            requestId,
            reviewerId,
            previousReviewerId: task.currentReviewerId ?? null,
            workflowStepId: getCurrentWorkflowStepId(task),
            triggeredAt,
            reason: VM_HOLD_REASON_INTERACTION,
        },
        changed: true,
    }
}

/**
 * Gives the workflow step back to the reviewer a hold displaced.
 *
 * Every exit from `awaiting_user` runs through this: answering, cancelling and expiring. The task
 * never moved off its step, so there is nothing to undo beyond the reviewer.
 */
function releaseVmInteractionWorkflowHold(transaction, taskRef, task, correlationId, requestId) {
    if (!taskRef || !task) return
    const hold = task[VM_WORKFLOW_HOLD_FIELD]
    if (!hold || hold.correlationId !== correlationId || hold.requestId !== requestId) return

    transaction.set(
        taskRef,
        {
            // Only restore the reviewer while this hold still owns the task. A user may have moved
            // the task on manually while the VM was waiting; that newer workflow decision wins.
            ...(task.currentReviewerId === hold.reviewerId
                ? { currentReviewerId: hold.previousReviewerId ?? null }
                : {}),
            [VM_WORKFLOW_HOLD_FIELD]: null,
        },
        { merge: true }
    )
}

/**
 * AT-2196: a failed or cancelled VM run hands its task to the requesting user.
 *
 * Without this the task keeps its assistant reviewer and simply disappears from every human's list:
 * the run is over, nothing else will move it, and the only trace is a comment in a chat nobody is
 * looking at. Same mechanism as a question — reviewer only, workflow step untouched.
 *
 * Returns the task update to merge, or null when no hold is needed.
 */
function buildVmFailureHoldUpdate(
    task,
    { correlationId, reviewerId, triggeredAt, failureReason = null, claimableReviewerIds = [] } = {}
) {
    if (!task || !reviewerId || !correlationId) return null
    const existing = task[VM_WORKFLOW_HOLD_FIELD]

    if (existing) {
        // Someone else's hold: never steal a task another live job is waiting on.
        if (existing.correlationId !== correlationId) return null
        // This job's own hold. An interaction hold becomes a failure hold (the question died with
        // the run), but the originally displaced reviewer is preserved so a retry restores it.
        if (getHoldReason(existing) === VM_HOLD_REASON_FAILURE) return null
        return {
            // The user may have moved the task on while the question was open; that newer workflow
            // decision wins and we only re-label the hold.
            ...(task.currentReviewerId === existing.reviewerId ? { currentReviewerId: existing.reviewerId } : {}),
            [VM_WORKFLOW_HOLD_FIELD]: {
                ...existing,
                requestId: null,
                reason: VM_HOLD_REASON_FAILURE,
                failureReason,
                triggeredAt,
            },
        }
    }

    // The task is already the user's to act on: they can see it, nothing to hold.
    if (task.currentReviewerId === reviewerId) return null

    // A run can last five hours, and a question can sit unanswered for a day. Only claim a task that
    // is still parked where this job left it — with the assistant it was dispatched against, or with
    // nobody. If a human has taken it over in the meantime, that newer workflow decision wins and the
    // task is visible to a person already, which is the entire point of the hold.
    const claimable = (claimableReviewerIds || []).filter(Boolean)
    if (task.currentReviewerId && !claimable.includes(task.currentReviewerId)) return null

    return {
        currentReviewerId: reviewerId,
        [VM_WORKFLOW_HOLD_FIELD]: {
            correlationId,
            requestId: null,
            reviewerId,
            previousReviewerId: task.currentReviewerId ?? null,
            workflowStepId: getCurrentWorkflowStepId(task),
            triggeredAt,
            reason: VM_HOLD_REASON_FAILURE,
            failureReason,
        },
    }
}

/**
 * Releases a failure hold when a new VM run starts on the task, handing the step back to the
 * reviewer it displaced. Interaction holds are left alone — they own their own release path.
 *
 * Returns the task update to merge, or null when there is nothing to release.
 */
function buildVmFailureHoldReleaseUpdate(task, { reviewerId = null } = {}) {
    const hold = task?.[VM_WORKFLOW_HOLD_FIELD]
    if (!hold || getHoldReason(hold) !== VM_HOLD_REASON_FAILURE) return null
    // The hold belongs to the user whose run failed. Another member starting their own VM run on the
    // same thread must not clear it out from under them before they ever saw the failure.
    if (reviewerId && hold.reviewerId !== reviewerId) return null

    return {
        // A manual move made after the failure wins; only clear the bookkeeping in that case.
        ...(task.currentReviewerId === hold.reviewerId ? { currentReviewerId: hold.previousReviewerId ?? null } : {}),
        [VM_WORKFLOW_HOLD_FIELD]: null,
    }
}

async function applyVmFailureWorkflowHold(
    db,
    pending,
    { correlationId, reviewerId, now = Date.now(), failureReason, claimableReviewerIds }
) {
    const taskRef = getVmHoldTaskRef(db, pending)
    if (!taskRef || !reviewerId) return false
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) return false
        const update = buildVmFailureHoldUpdate(snapshot.data() || {}, {
            correlationId,
            reviewerId,
            triggeredAt: now,
            failureReason,
            claimableReviewerIds: claimableReviewerIds || [pending.assistantId],
        })
        if (!update) return false
        transaction.set(taskRef, update, { merge: true })
        return true
    })
}

/**
 * Run-start bookkeeping, in one read: release the failure hold a previous run of this user left on
 * the task (work is starting again, so the step goes back to the reviewer that failure displaced),
 * and report the reviewer the task ends up with. That reviewer is what this run is allowed to claim
 * back if it fails too — anything else means a human moved the task while the VM was working.
 */
async function prepareVmFailureHoldForRun(db, pending) {
    const taskRef = getVmHoldTaskRef(db, pending)
    if (!taskRef) return { releasedHold: null, reviewerAtRunStart: null }
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) return { releasedHold: null, reviewerAtRunStart: null }
        const task = snapshot.data() || {}
        const update = buildVmFailureHoldReleaseUpdate(task, { reviewerId: pending.userId })
        if (!update) return { releasedHold: null, reviewerAtRunStart: task.currentReviewerId ?? null }
        transaction.set(taskRef, update, { merge: true })
        return {
            releasedHold: task[VM_WORKFLOW_HOLD_FIELD] || null,
            reviewerAtRunStart:
                update.currentReviewerId !== undefined ? update.currentReviewerId : (task.currentReviewerId ?? null),
        }
    })
}

/**
 * Puts back a hold this run released and then never replaced — the thread-busy deferral, where the
 * job is re-queued with no failure comment and no settlement of its own. Without this the previous
 * failure silently leaves the user's list and nothing ever puts it back.
 */
async function restoreVmFailureWorkflowHold(db, pending, hold) {
    const taskRef = getVmHoldTaskRef(db, pending)
    if (!taskRef || !hold || !hold.reviewerId) return false
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) return false
        const task = snapshot.data() || {}
        // Only undo our own release: a hold taken since, or a workflow move made since, both win.
        if (task[VM_WORKFLOW_HOLD_FIELD]) return false
        if ((task.currentReviewerId ?? null) !== (hold.previousReviewerId ?? null)) return false
        transaction.set(
            taskRef,
            { currentReviewerId: hold.reviewerId, [VM_WORKFLOW_HOLD_FIELD]: hold },
            { merge: true }
        )
        return true
    })
}

module.exports = {
    VM_WORKFLOW_HOLD_FIELD,
    VM_HOLD_REASON_INTERACTION,
    VM_HOLD_REASON_FAILURE,
    getVmHoldTaskRef,
    getCurrentWorkflowStepId,
    resolveVmInteractionWorkflowHold,
    releaseVmInteractionWorkflowHold,
    buildVmFailureHoldUpdate,
    buildVmFailureHoldReleaseUpdate,
    applyVmFailureWorkflowHold,
    prepareVmFailureHoldForRun,
    restoreVmFailureWorkflowHold,
}
