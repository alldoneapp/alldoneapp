const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { getSortedWorkflowStepIds, isAiWorkflowStep, isOpenStepId } = require('../Tasks/workflowStepHelper')
const { isDelegatedWorkflowTask, withDelegationReviewStep } = require('../shared/delegatedTaskWorkflow')

// The conversations whose results are reported back where the user asked: Anna's conversation and,
// since AT-3071, a project assistant's chat. A task thread is never an origin: work asked for there
// stays in that task.
const isTrackedOriginConversation = conversation =>
    !!conversation?.objectId && (conversation.annaConversation === true || conversation.chatTaskTracking === true)

/**
 * The conversation a delegated task reports back to, or null. Normally the conversation the tool
 * runs in. A delegate reached through talk_to_assistant runs without a conversation of its own; its
 * runtime carries the caller's conversation as `origin*` (set by the server, never by the model),
 * and `originTracksWork` says whether that one is tracked (AT-3096). Without this the review notice
 * of a task the delegate created never reached the chat the user asked in.
 */
function resolveDelegationOrigin(conversation) {
    if (isTrackedOriginConversation(conversation)) {
        return {
            projectId: conversation.projectId || '',
            objectType: conversation.objectType || 'topics',
            objectId: conversation.objectId,
            assistantId: conversation.assistantId || '',
        }
    }
    if (
        !conversation?.objectId &&
        conversation?.originTracksWork === true &&
        typeof conversation.originProjectId === 'string' &&
        conversation.originProjectId &&
        typeof conversation.originObjectId === 'string' &&
        conversation.originObjectId &&
        typeof conversation.originAssistantId === 'string' &&
        conversation.originAssistantId
    ) {
        return {
            projectId: conversation.originProjectId,
            objectType: conversation.originObjectType || 'topics',
            objectId: conversation.originObjectId,
            assistantId: conversation.originAssistantId,
        }
    }
    return null
}

const buildDelegatedTaskFields = (ownerId, assistantId, executionMode) => ({
    userId: executionMode === 'direct' ? assistantId : ownerId,
    assigneeType: executionMode === 'direct' ? 'assistant' : 'USER',
    executionMode: executionMode === 'direct' ? 'direct' : 'workflow',
    assistantId,
    taskMetadata: {
        annaWorkspace: { ownerId, assistantId },
        ...(executionMode === 'direct' ? {} : { delegation: { ownerId, assistantId, requiresReview: true } }),
    },
})

// Start at the beginning, never at a later assistant step: earlier reviewers are prerequisites.
// This runs only after the original request is durable in the task conversation.
//
// Without a usable saved step for the responsible assistant (AT-3071) the task starts directly: it
// gets its own "work on request, then owner review" workflow (shared/delegatedTaskWorkflow.js) and the
// assistant starts working in the task at once, grounded by `requestCommentId`.
async function startDelegatedTaskWorkflow({
    db,
    projectId,
    taskId,
    ownerId,
    assistantId,
    originConversation,
    requestCommentId,
}) {
    // Callback destinations and the request must come from the authenticated call, never mutable task
    // metadata. No client write rule exists for this collection. Subsequent workflow steps read it.
    const trackedOrigin = resolveDelegationOrigin(originConversation)
    const requestId = typeof requestCommentId === 'string' && requestCommentId ? requestCommentId : ''
    if (trackedOrigin || requestId) {
        // Merged: a retried start must not erase the review-notice bookkeeping of the receipt.
        await db.doc(`delegatedTaskOrigins/${projectId}__${taskId}`).set(
            {
                // Named explicitly so a conversation's waiting tasks can be listed without parsing ids.
                projectId,
                taskId,
                ownerId,
                assistantId,
                // Lists the user's open delegated tasks for Anna (delegatedTasksContext.js); the task
                // update fan-out keeps it in step with the task.
                open: true,
                ...(requestId ? { requestCommentId: requestId } : {}),
                ...(trackedOrigin
                    ? {
                          originProjectId: trackedOrigin.projectId || projectId,
                          originObjectType: trackedOrigin.objectType,
                          originObjectId: trackedOrigin.objectId,
                          originAssistantId: trackedOrigin.assistantId || assistantId,
                      }
                    : {}),
            },
            { merge: true }
        )
    }
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const owner = await db.doc(`users/${ownerId}`).get()
    const savedWorkflow = owner.exists ? owner.data()?.workflow?.[projectId] || {} : {}
    const suitable = Object.values(savedWorkflow).some(
        step =>
            isAiWorkflowStep(step) &&
            step.reviewerUid === assistantId &&
            (step.aiPrompt?.trim() || step.aiPreConfigTaskId)
    )

    const transition = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) throw new Error('The delegated task no longer exists')
        const task = { id: taskId, ...snapshot.data() }
        if (!isDelegatedWorkflowTask(task) || task.userId !== ownerId || task.done) return { task, changed: true }
        const history = Array.isArray(task.stepHistory) ? task.stepHistory : []
        // Already in its workflow: the workflow is handling it.
        if (history.length > 1) return { task }
        // Neither Open nor in the workflow: say so instead of reporting a start that never happened.
        // AT-3065 was created with ['Open'] and silently stayed Open while Anna was told otherwise.
        if (history.length === 1 && !isOpenStepId(history[0])) return { task, changed: true }
        const metadata = task.taskMetadata || {}
        const taskMetadata = suitable
            ? metadata
            : { ...metadata, delegation: { ...metadata.delegation, assistantId, directStart: true } }
        const workflow = withDelegationReviewStep(savedWorkflow, { ...task, taskMetadata })
        const stepId = getSortedWorkflowStepIds(workflow)[0]
        const reviewerId = workflow[stepId].reviewerUid
        const now = Date.now()
        const update = {
            stepHistory: [OPEN_STEP, stepId],
            userIds: [ownerId, reviewerId],
            currentReviewerId: reviewerId,
            completed: now,
            dueDate: now,
            sortIndex: now,
            isAssistantEnabled: true,
            // The start of the delegation, which the delegating conversation reports itself; the
            // step-change notice leaves this entry out (delegationReviewNotice.js).
            delegationStartedAt: now,
            ...(suitable ? {} : { taskMetadata }),
        }
        transaction.set(taskRef, update, { merge: true })
        return { oldTask: task, task: { ...task, ...update } }
    })

    if (transition.changed) {
        return {
            status: 'task_changed',
            task: transition.task,
            handoffInstruction:
                'This task was changed while delegation was being prepared. Read its current state before continuing; do not create another task or start a second execution.',
        }
    }

    if (transition?.oldTask) {
        // The task trigger makes the same deterministic enqueue. Calling it here closes the gap
        // before that trigger arrives and ensures a subsequent VM request sees queued workflow work.
        const { enqueueWorkflowAiRunIfNeeded } = require('../Tasks/workflowAiStep')
        await enqueueWorkflowAiRunIfNeeded(projectId, taskId, transition.oldTask, transition.task)
    }
    const directStart = !suitable && !!transition?.oldTask
    return {
        status: 'workflow_managed',
        ...(directStart ? { directStart: true } : {}),
        ...(transition?.task ? { task: transition.task } : {}),
        handoffInstruction:
            (directStart
                ? 'The saved workflow has no step for the responsible assistant, so this task started directly: that assistant is now working on the request in the task conversation, and the result returns to the requesting user for review. '
                : 'This existing task belongs to the requesting user and is handled by their workflow, including any prerequisite steps. ' +
                  'The workflow starts the assistant work and returns the result for human review. ') +
            'Do not separately delegate, launch a VM, or mark this task done from the coordinating conversation; that would duplicate or bypass its workflow. ' +
            'Tell the user briefly that the work continues in that task and give them its link (taskUrl in this result) exactly as returned; never write a placeholder or build the link yourself.',
    }
}

const hasFailedCurrentStep = task => {
    const history = Array.isArray(task?.stepHistory) ? task.stepHistory : []
    const status = task?.workflowAiStatus
    return history.length > 1 && status?.status === 'failed' && status.stepId === history[history.length - 1]
}

/**
 * Restarts the failed AI step of a delegated task when the user asked to continue it.
 *
 * Only the workflow may start a VM on a delegated task, so a chat turn is refused below. When the
 * step's own run had failed, that refusal was a dead end (2026-11-18, task nFzDtx2oPmJOsH5ztdGF): the
 * VM restarted under the agent, its notice said "reply in this thread to continue", and the reply
 * was refused while the only way on was the "Needs attention" tag in the task list. Restarting the
 * failed run keeps the workflow the only one that starts the VM: the run waits for this reply to
 * finish (deferDelegatedWorkflowForConversation) and continues in the same thread and VM session.
 * Only a message the user typed counts, as for move_task_workflow_step; the user pays, as with the
 * tag. Returns null when the step cannot be restarted from here.
 */
async function retryFailedDelegatedStep({ db, projectId, taskId, task, retryAs }) {
    if (!retryAs?.requestUserId || !hasFailedCurrentStep(task)) return null
    const { isHumanTurn } = require('./workflowStepMoveTool')
    if (!(await isHumanTurn(db, retryAs.runtime, retryAs.requestUserId))) return null
    try {
        const { retryFailedWorkflowAiRun } = require('../Tasks/workflowAiStep')
        const runId = await retryFailedWorkflowAiRun(projectId, taskId, retryAs.requestUserId)
        if (!runId) return null
        return {
            success: true,
            projectId,
            taskId,
            status: 'workflow_step_restarted',
            runId,
            message:
                "This task's failed workflow step was started again. It continues in this task's conversation, in the same VM when one was kept, as soon as this reply is finished. Do not start a VM yourself. Tell the user briefly that the step is running again.",
        }
    } catch (error) {
        console.warn('Could not restart the failed workflow step of a delegated task', {
            projectId,
            taskId,
            error: error.message,
        })
        return null
    }
}

const resolveEditorName = async (reactivation, assistantId) => {
    if (typeof reactivation?.editorName === 'string') return reactivation.editorName
    if (typeof reactivation?.resolveEditorName !== 'function') return ''
    try {
        return (await reactivation.resolveEditorName(assistantId)) || ''
    } catch (error) {
        return ''
    }
}

const doneTaskRefusal = message => ({ success: true, status: 'task_done', message })

/**
 * New VM work asked for on a done delegated task (AT-3098). The task must not stay Done while it is
 * worked on, and only its workflow may start the VM, so the task goes back to the first AI step of
 * its assistant; that step runs the request (appended to its prompt) after this reply, and every
 * later step, human review included, follows again. Only the owner's request reopens it: the
 * workflow runs, and is paid for, as the owner.
 */
async function reopenDoneDelegatedTask({ db, projectId, taskId, task, retryAs, reactivation }) {
    const requestUserId = retryAs?.requestUserId || ''
    if (!requestUserId || requestUserId !== task.userId) {
        return doneTaskRefusal(
            "This task is done and is handled by its owner's workflow. Only the task owner's request reopens it for more work. Do not start a VM on it; tell the user that the owner can reopen it."
        )
    }
    const { planDoneTaskReactivation, reactivateDoneTaskForAssistantWork } = require('../Tasks/doneTaskReactivation')
    const assistantId = task.taskMetadata?.delegation?.assistantId || task.assistantId || ''
    const plan = await planDoneTaskReactivation({ db, projectId, taskId, assistantId })
    if (plan && !plan.landsOnAiStep) {
        return doneTaskRefusal(
            'This task is done and its workflow has no assistant step to do more work in. Do not start a VM on it; offer to configure the workflow, or to switch this task to direct execution.'
        )
    }
    const runtime = retryAs.runtime || {}
    const result = await reactivateDoneTaskForAssistantWork({
        db,
        projectId,
        taskId,
        assistantId,
        actorUserId: requestUserId,
        note: reactivation?.note || '',
        editorName: await resolveEditorName(reactivation, assistantId),
        // The task's own chat is where the user sees it happen; any other conversation is named so
        // the origin is not told twice about a move it asked for itself.
        fromConversation:
            runtime.objectId && runtime.objectId !== taskId
                ? { projectId: runtime.projectId, objectType: runtime.objectType, objectId: runtime.objectId }
                : null,
    })
    if (!result.reactivated) return null
    // The task trigger makes the same deterministic enqueue; this closes the gap before it arrives,
    // so the next look at the task sees its workflow working (as startDelegatedTaskWorkflow does).
    try {
        const { enqueueWorkflowAiRunIfNeeded } = require('../Tasks/workflowAiStep')
        await enqueueWorkflowAiRunIfNeeded(projectId, taskId, result.oldTask, result.task)
    } catch (error) {
        console.warn('Could not enqueue the reopened step of a delegated task; the task trigger will', {
            projectId,
            taskId,
            error: error.message,
        })
    }
    return {
        success: true,
        projectId,
        taskId,
        status: 'workflow_step_reopened',
        stepId: result.stepId,
        message: `This task was done. It is back on its workflow step “${result.stepLabel}”, which works on this request in the task's conversation as soon as this reply is finished; its result then goes through the workflow's review steps again. Do not start a VM yourself. Tell the user briefly that the task was reopened and the step is working on it.`,
    }
}

/**
 * Whether execute_task_in_vm must leave this task to its workflow, and what to tell the assistant.
 * `retryAs` ({ requestUserId, runtime }) lets a request the user typed restart a failed AI step, and
 * lets the owner's request reopen a done task into its workflow (`reactivation`: { note, editorName |
 * resolveEditorName(assistantId) }).
 */
async function getDelegatedTaskExecution({
    db,
    projectId,
    taskId,
    retryAs = null,
    reactivation = null,
    allowReopen = true,
}) {
    const snapshot = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
    const task = snapshot.exists ? snapshot.data() : null
    if (!isDelegatedWorkflowTask(task)) return null
    if (task.done) {
        const reopened = allowReopen
            ? await reopenDoneDelegatedTask({ db, projectId, taskId, task, retryAs, reactivation })
            : null
        if (reopened) return reopened
        if (!allowReopen) {
            return doneTaskRefusal(
                'This task changed while it was being reopened. Read its current state before continuing; do not start a VM on it.'
            )
        }
        // Reopened by someone else in the meantime (the app, a concurrent run): judge it as it stands
        // now, which normally means its workflow already handles it.
        return getDelegatedTaskExecution({ db, projectId, taskId, retryAs, allowReopen: false })
    }
    const restarted = await retryFailedDelegatedStep({ db, projectId, taskId, task, retryAs })
    if (restarted) return restarted
    const managed = task.stepHistory?.length > 1
    return {
        success: true,
        projectId,
        taskId,
        status: managed ? 'workflow_managed' : 'needs_workflow_choice',
        message: !managed
            ? 'This task has no active assistant workflow step. Offer to configure the workflow or explicitly switch this existing task to direct execution first.'
            : hasFailedCurrentStep(task)
              ? "This task is handled by its workflow, and the run of its current step failed. Do not start a second execution. Only a message the user types asking to continue restarts the step; otherwise the user can press the task's 'Needs attention' tag in the task list."
              : 'This task is handled by its workflow. Do not start a second execution; follow its current step and review the result on the same task.',
    }
}

async function loadDelegatedTaskOrigin(db, projectId, task) {
    if (!isDelegatedWorkflowTask(task)) return {}
    const snapshot = await db.doc(`delegatedTaskOrigins/${projectId}__${task.id}`).get()
    const origin = snapshot.exists ? snapshot.data() : null
    if (!origin || origin.ownerId !== task.userId) return {}
    // Only the destination: callers spread it into run options, and the receipt also carries ids
    // and review-notice bookkeeping.
    const fields = ['originProjectId', 'originObjectType', 'originObjectId', 'originAssistantId']
    return Object.fromEntries(fields.filter(field => origin[field] !== undefined).map(field => [field, origin[field]]))
}

/**
 * The request comment a directly started delegation was created with (AT-3071), read from the
 * server-only receipt. Only the run of the assistant the receipt names, for the owner it names, uses
 * it, and only the first run of the work step: the claim records that run, so a retry of the same run
 * gets the request again while a later entry (sent back) posts the step's prompt as usual.
 */
async function claimDelegatedTaskRequest(db, projectId, task, assistantId, runId) {
    if (!isDelegatedWorkflowTask(task) || !task.id || !runId) return null
    const ref = db.doc(`delegatedTaskOrigins/${projectId}__${task.id}`)
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const receipt = snapshot.exists ? snapshot.data() : null
        if (!receipt?.requestCommentId || receipt.ownerId !== task.userId || receipt.assistantId !== assistantId)
            return null
        if (receipt.requestRunId && receipt.requestRunId !== runId) return null
        if (!receipt.requestRunId) transaction.set(ref, { requestRunId: runId }, { merge: true })
        return { requestCommentId: receipt.requestCommentId }
    })
}

module.exports = {
    isTrackedOriginConversation,
    resolveDelegationOrigin,
    claimDelegatedTaskRequest,
    buildDelegatedTaskFields,
    startDelegatedTaskWorkflow,
    getDelegatedTaskExecution,
    loadDelegatedTaskOrigin,
}
