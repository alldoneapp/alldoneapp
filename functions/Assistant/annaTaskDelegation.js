const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { getSortedWorkflowStepIds, isAiWorkflowStep, isOpenStepId } = require('../Tasks/workflowStepHelper')
const { isDelegatedWorkflowTask, withDelegationReviewStep } = require('../shared/delegatedTaskWorkflow')

// The conversations whose results are reported back where the user asked: Anna's conversation and,
// since AT-3071, a project assistant's chat. A task thread is never an origin: work asked for there
// stays in that task.
const isTrackedOriginConversation = conversation =>
    !!conversation?.objectId && (conversation.annaConversation === true || conversation.chatTaskTracking === true)

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
    const trackedOrigin = isTrackedOriginConversation(originConversation)
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
                ...(requestId ? { requestCommentId: requestId } : {}),
                ...(trackedOrigin
                    ? {
                          originProjectId: originConversation.projectId || projectId,
                          originObjectType: originConversation.objectType || 'topics',
                          originObjectId: originConversation.objectId,
                          originAssistantId: originConversation.assistantId || assistantId,
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
            'Tell the user briefly that the work continues in that task.',
    }
}

async function getDelegatedTaskExecution({ db, projectId, taskId }) {
    const snapshot = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
    const task = snapshot.exists ? snapshot.data() : null
    if (!isDelegatedWorkflowTask(task) || task.done) return null
    return {
        success: true,
        projectId,
        taskId,
        status: task.stepHistory?.length > 1 ? 'workflow_managed' : 'needs_workflow_choice',
        message:
            task.stepHistory?.length > 1
                ? 'This task is handled by its workflow. Do not start a second execution; follow its current step and review the result on the same task.'
                : 'This task has no active assistant workflow step. Offer to configure the workflow or explicitly switch this existing task to direct execution first.',
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
    claimDelegatedTaskRequest,
    buildDelegatedTaskFields,
    startDelegatedTaskWorkflow,
    getDelegatedTaskExecution,
    loadDelegatedTaskOrigin,
}
