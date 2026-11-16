const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { getSortedWorkflowStepIds, isAiWorkflowStep } = require('../Tasks/workflowStepHelper')
const { isDelegatedWorkflowTask, withDelegationReviewStep } = require('../shared/delegatedTaskWorkflow')

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
async function startDelegatedTaskWorkflow({ db, projectId, taskId, ownerId, assistantId, originConversation }) {
    // Callback destinations must come from the authenticated call, never mutable task metadata.
    // No client write rule exists for this collection. Subsequent workflow steps read this receipt.
    if (originConversation?.annaConversation && originConversation.objectId) {
        await db.doc(`delegatedTaskOrigins/${projectId}__${taskId}`).set({
            // Named explicitly so a conversation's waiting tasks can be listed without parsing ids.
            projectId,
            taskId,
            ownerId,
            originProjectId: originConversation.projectId || projectId,
            originObjectType: originConversation.objectType || 'topics',
            originObjectId: originConversation.objectId,
            originAssistantId: originConversation.assistantId || assistantId,
        })
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
    if (!suitable) {
        return {
            status: 'needs_workflow_choice',
            handoffInstruction:
                'The task belongs to the requesting user. Their saved workflow has no usable step for the responsible assistant. ' +
                'Offer to configure that step or execute this task directly. Do not launch work or change the saved workflow without their choice. ' +
                'For direct execution, update this existing task to executionMode direct, then execute it; do not create another task.',
        }
    }

    const transition = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) throw new Error('The delegated task no longer exists')
        const task = { id: taskId, ...snapshot.data() }
        if (!isDelegatedWorkflowTask(task) || task.userId !== ownerId || task.done) return { task, changed: true }
        if (task.stepHistory?.length > 1 || task.stepHistory?.[0] !== OPEN_STEP) return { task }
        const workflow = withDelegationReviewStep(savedWorkflow, task)
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
    return {
        status: 'workflow_managed',
        ...(transition?.task ? { task: transition.task } : {}),
        handoffInstruction:
            'This existing task belongs to the requesting user and is handled by their workflow, including any prerequisite steps. ' +
            'The workflow starts the assistant work and returns the result for human review. Do not separately delegate, launch a VM, ' +
            'or mark this task done from the coordinating conversation; that would duplicate or bypass its workflow.',
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

module.exports = {
    buildDelegatedTaskFields,
    startDelegatedTaskWorkflow,
    getDelegatedTaskExecution,
    loadDelegatedTaskOrigin,
}
