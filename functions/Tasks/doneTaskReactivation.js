'use strict'

/**
 * A done task goes back into its workflow when the assistant starts working on it again (AT-3098).
 *
 * The user comments on a task that is already Done ("there is still a bug"), the assistant answers
 * and starts a VM job on the task. Until now the task stayed Done for the whole run: the list showed
 * it finished while it was being rebuilt, and the result never passed the workflow's human review.
 *
 * Product decisions (Karsten, 2026-11-18):
 * - Only actual work reopens the task: a VM job hosted in the task (`execute_task_in_vm` in the
 *   task's chat, with `target_task_id`, or continuing an earlier run there). A plain chat answer,
 *   a status question or a small tool edit leaves the task Done.
 * - The task goes to the FIRST AI step of the assistant doing the work (falling back to the first AI
 *   step at all). Every later step, including every human review, runs again: nothing is skipped.
 * - A task whose workflow has no AI step (or that has no workflow) goes back to Open with its owner
 *   while the work runs; the owner completes it again afterwards.
 *
 * The write mirrors the client's moveTasksFromDone field for field (rebuilt stepHistory/userIds,
 * subtasks), so the onUpdateTask fan-out sees an ordinary reopen: the AI step is enqueued (and parks
 * on the running VM instead of running twice, AT-2222), the "changed task to Open" status feed is
 * written, the delegation receipt is marked open again and the origin conversation is told. The
 * reopening actor is the assistant, so the cross-user statistics marker makes the fan-out reverse the
 * owner's completion statistics, exactly as moveTasksFromDone does for the owner in the browser.
 *
 * Idempotent: the transaction reopens only a task that is still Done, so a retried tool call, a
 * second concurrent run or the user reopening it in the app at the same moment change nothing.
 */

const crypto = require('crypto')

const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')
const { getSortedWorkflowStepIds, isAiWorkflowStep, isOpenStepId } = require('./workflowStepHelper')

const MAX_NOTE_LENGTH = 2000
const PROMPT_OVERRIDE_MODE_APPEND = 'append'

const getStepHistory = task =>
    (Array.isArray(task?.stepHistory) ? task.stepHistory : []).map(stepId =>
        isOpenStepId(stepId) ? OPEN_STEP : stepId
    )

/**
 * Where a done task goes when an assistant works on it again: the first AI step of that assistant,
 * else the first AI step, else Open (an assistant workflow task has no Open: its first step).
 * Null when there is nowhere to go.
 */
const selectReactivationStepId = (task, workflow = {}, assistantId = '') => {
    const stepIds = getSortedWorkflowStepIds(workflow || {})
    const aiStepIds = stepIds.filter(stepId => isAiWorkflowStep(workflow[stepId]) && workflow[stepId].reviewerUid)
    const ownStepId = assistantId ? aiStepIds.find(stepId => workflow[stepId].reviewerUid === assistantId) : null
    if (ownStepId) return ownStepId
    if (aiStepIds.length > 0) return aiStepIds[0]
    if (task?.workflowTask === true) return stepIds[0] || null
    return OPEN_STEP
}

/** The task fields of the reopen. Pure, so the rules above are testable without Firestore. */
const buildDoneTaskReactivationUpdate = ({
    task,
    workflow = {},
    targetStepId,
    actorUserId,
    assistantId = '',
    now,
    note = '',
    fromConversation = null,
    transitionId = null,
    editorName = '',
}) => {
    const ownerId = task.userId
    let update
    if (targetStepId === OPEN_STEP) {
        update = {
            userIds: [ownerId],
            stepHistory: [OPEN_STEP],
            currentReviewerId: ownerId,
            completed: null,
            completedTime: null,
            dueDate: now,
        }
    } else {
        // Rebuilt like moveTasksFromDone: the steps the task already passed before the target stay in
        // its history, the target becomes the current step, everything after it is to come again.
        const history = getStepHistory(task)
        const userIds = [ownerId]
        const stepHistory = task.workflowTask === true ? [] : [OPEN_STEP]
        let currentReviewerId = ownerId
        for (const stepId of getSortedWorkflowStepIds(workflow)) {
            const { reviewerUid } = workflow[stepId]
            if (stepId === targetStepId) {
                stepHistory.push(stepId)
                userIds.push(reviewerUid)
                currentReviewerId = reviewerUid
                break
            }
            if (history.includes(stepId)) {
                stepHistory.push(stepId)
                userIds.push(reviewerUid)
            }
        }
        update = { userIds, stepHistory, currentReviewerId, completed: now, dueDate: now }
    }

    const landsOnAiStep = targetStepId !== OPEN_STEP && isAiWorkflowStep(workflow[targetStepId])
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE_LENGTH) : ''
    // The assistant reopens the task; for the owner that is another member's transition, which the
    // fan-out's statistics marker turns into the reversal of the completion statistics.
    const editorId = assistantId || actorUserId
    const reversesStatistics =
        !!transitionId && !!editorId && editorId !== ownerId && Number.isFinite(Number(task.completed))

    return {
        ...update,
        done: false,
        inDone: false,
        sortIndex: now,
        lastEditorId: editorId,
        lastEditionDate: now,
        // An assistant has no users/ document; the "changed task to Open" feed names it from here.
        ...(typeof editorName === 'string' && editorName.trim() ? { lastEditorName: editorName.trim() } : {}),
        // The follow-up request is added to the step's configured prompt, never replacing it, like a
        // move_task_workflow_step note. Only the owner's note is honoured by the run.
        workflowAiPromptOverride:
            landsOnAiStep && cleanNote
                ? {
                      stepId: targetStepId,
                      prompt: cleanNote,
                      mode: PROMPT_OVERRIDE_MODE_APPEND,
                      triggerMessageId: null,
                      requestedByUserId: actorUserId,
                  }
                : null,
        ...(task.workflowTask === true ? { workflowPayerUserId: actorUserId } : {}),
        // No runLockId: the chat run that started the work IS the work on the step, so the step must
        // park on it (AT-2222) rather than wait for it and then run its prompt a second time.
        workflowStepMove: {
            stepId: targetStepId,
            enteredAt: update.completed ?? null,
            runLockId: null,
            actorUserId,
            at: now,
            fromConversation: fromConversation?.objectId
                ? {
                      projectId: fromConversation.projectId || null,
                      objectType: fromConversation.objectType || null,
                      objectId: fromConversation.objectId,
                  }
                : null,
        },
        ...(reversesStatistics
            ? {
                  taskStatisticsTransition: {
                      id: transitionId,
                      actorId: editorId,
                      ownerId,
                      completed: Number(task.completed),
                  },
              }
            : {}),
    }
}

const loadWorkflow = async (db, projectId, task) => {
    const { loadTaskWorkflow } = require('./workflowStepMove')
    return loadTaskWorkflow(db, projectId, task)
}

/**
 * Read-only: where the task would go if work started on it now, or null when it is not a done
 * top-level task. Lets the caller brief the VM before the reopen is written.
 */
async function planDoneTaskReactivation({ db, projectId, taskId, assistantId = '' }) {
    if (!projectId || !taskId) return null
    const snapshot = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
    const task = snapshot.exists ? { ...snapshot.data(), id: taskId } : null
    if (!task?.done || task.parentId || !task.userId) return null
    const workflow = await loadWorkflow(db, projectId, task)
    const targetStepId = selectReactivationStepId(task, workflow, assistantId)
    if (targetStepId === null || targetStepId === undefined) return null
    return {
        targetStepId,
        landsOnAiStep: targetStepId !== OPEN_STEP && isAiWorkflowStep(workflow[targetStepId]),
        workflow,
        task,
    }
}

/**
 * Reopens a done task into the step its renewed assistant work belongs to.
 *
 * @returns {Promise<object>} `{ reactivated: true, stepId, stepLabel, landsOnAiStep, oldTask, task }`
 *   or `{ reactivated: false, reason }` (not_done, subtask, task_not_found, no_step, task_changed).
 */
async function reactivateDoneTaskForAssistantWork({
    db,
    projectId,
    taskId,
    assistantId = '',
    actorUserId,
    note = '',
    fromConversation = null,
    editorName = '',
    now = Date.now,
    createId = () => crypto.randomUUID(),
}) {
    if (!db || !projectId || !taskId || !actorUserId)
        throw new Error('db, projectId, taskId and actorUserId are required')
    const plan = await planDoneTaskReactivation({ db, projectId, taskId, assistantId })
    if (!plan) return { reactivated: false, reason: 'not_done' }
    const { workflow, targetStepId, landsOnAiStep } = plan
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)

    const result = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(taskRef)
        if (!fresh.exists) return { reactivated: false, reason: 'task_not_found' }
        const task = { ...fresh.data(), id: taskId }
        // Someone reopened it meanwhile (the app, a concurrent run): leave their step alone.
        if (!task.done) return { reactivated: false, reason: 'not_done' }
        // The workflow was loaded for this owner and this shape; anything else is re-planned next time.
        if (task.parentId || task.userId !== plan.task.userId || task.workflowTask !== plan.task.workflowTask) {
            return { reactivated: false, reason: 'task_changed' }
        }
        const timestamp = now()
        const update = buildDoneTaskReactivationUpdate({
            task,
            workflow,
            targetStepId,
            actorUserId,
            assistantId,
            now: timestamp,
            note,
            fromConversation,
            transitionId: createId(),
            editorName,
        })
        transaction.set(taskRef, update, { merge: true })

        // Subtasks follow their parent, exactly as moveTasksFromDone updates them.
        const subtaskUpdate = {
            userIds: update.userIds,
            stepHistory: update.stepHistory,
            currentReviewerId: update.currentReviewerId,
            completed: update.completed,
            dueDate: update.dueDate,
            ...(targetStepId === OPEN_STEP ? { completedTime: null } : {}),
            parentDone: false,
            inDone: false,
        }
        for (const subtaskId of Array.isArray(task.subtaskIds) ? task.subtaskIds : []) {
            transaction.set(db.doc(`items/${projectId}/tasks/${subtaskId}`), subtaskUpdate, { merge: true })
        }
        return { reactivated: true, oldTask: task, task: { ...task, ...update } }
    })

    if (!result.reactivated) return result
    const stepLabel =
        targetStepId === OPEN_STEP
            ? 'Open'
            : (typeof workflow[targetStepId]?.description === 'string' && workflow[targetStepId].description.trim()) ||
              'Workflow step'
    console.log('[doneTaskReactivation] Reopened a done task for renewed assistant work', {
        projectId,
        taskId,
        stepId: targetStepId,
        landsOnAiStep,
        assistantId: assistantId || null,
    })
    return { ...result, stepId: targetStepId, stepLabel, landsOnAiStep }
}

module.exports = {
    buildDoneTaskReactivationUpdate,
    planDoneTaskReactivation,
    reactivateDoneTaskForAssistantWork,
    selectReactivationStepId,
}
