'use strict'

/**
 * "Ready for your review" in the conversation a task was delegated from (AT-2829).
 *
 * A task Anna delegated runs through its workflow in its own chat. When it reaches a step of the
 * user who delegated it (their review, or a human prerequisite), Anna says so where the user asked
 * for it, with Anna's short summary of the latest result, what comes next and the link to the task
 * chat. A short reply there ("merge it") is then handled by move_task_workflow_step, which finds
 * this task from the same origin receipt.
 *
 * The detailed result stays in the task chat (AT-3074): the notice used to repeat its first 600
 * characters, and the VM runner posted the same excerpt a few seconds earlier. The runner now leaves
 * a run that ends a delegated task's AI step to this notice, and this notice carries only the summary.
 *
 * Runs in the onUpdateTask fan-out, which is at-least-once: the origin receipt remembers the last
 * step entry it announced, so a redelivery posts nothing.
 */

const admin = require('firebase-admin')

const { OPEN_STEP, getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { isAiWorkflowStep } = require('../Tasks/workflowStepHelper')
const { isDelegatedWorkflowTask } = require('../shared/delegatedTaskWorkflow')
const { describeTaskWorkflow, getTaskPosition, loadTaskWorkflow } = require('../Tasks/workflowStepMove')

const RECENT_COMMENTS_TO_SCAN = 10

const buildNoticeKey = (task, stepId) => `${stepId}__${task.completed || `s${(task.stepHistory || []).length}`}`

async function loadLatestAssistantResult(db, projectId, taskId) {
    try {
        const snapshot = await db
            .collection(`chatComments/${projectId}/tasks/${taskId}/comments`)
            .orderBy('created', 'desc')
            .limit(RECENT_COMMENTS_TO_SCAN)
            .get()
        const latest = snapshot.docs.map(doc => doc.data() || {}).find(comment => comment.fromAssistant === true)
        return latest?.commentText || ''
    } catch (error) {
        console.warn('[delegationReviewNotice] Could not read the latest result', { taskId, error: error.message })
        return ''
    }
}

const buildTaskLabel = task =>
    task.humanReadableId
        ? `${task.humanReadableId} “${task.extendedName || task.name}”`
        : `“${task.extendedName || task.name}”`

// `summary` is Anna's summary of the latest result (vmResultSummary), never the result itself.
const buildNoticeText = ({ task, step, next, summary, link }) => {
    const lines = [`📋 ${buildTaskLabel(task)} is ready for you at “${step.description || 'Review'}”.`]
    if (summary) lines.push('', summary)
    if (next?.id === 'done') {
        lines.push('', 'Reply “done” to complete it, or tell me what to change.')
    } else if (next) {
        const who = next.handledBy === 'assistant' ? 'assistant' : next.handledBy
        lines.push(
            '',
            `Next: “${next.label}”${who ? ` (${who})` : ''}. Reply here to approve, for example “go ahead”, or tell me what to change.`
        )
    }
    lines.push(link)
    return lines.join('\n')
}

/**
 * Announces a delegated task that just landed on its owner's step in the conversation it came from.
 * Returns true when a message was posted.
 */
async function notifyDelegationOriginOnHumanStep({
    db = admin.firestore(),
    projectId,
    taskId,
    oldTask = {},
    newTask = {},
}) {
    if (!newTask || newTask.done || newTask.parentId || !isDelegatedWorkflowTask(newTask)) return false
    const stepId = getTaskPosition(newTask)
    if (stepId === OPEN_STEP || stepId === getTaskPosition(oldTask || {})) return false

    const task = { ...newTask, id: taskId }
    // The user moved it here themselves from a chat; there is nothing to tell them. A stamp left by an
    // earlier move has another entry time and does not count.
    const move = newTask.workflowStepMove
    if (move?.stepId === stepId && move.actorUserId === task.userId && move.enteredAt === newTask.completed)
        return false

    const { loadDelegatedTaskOrigin } = require('./annaTaskDelegation')
    const origin = await loadDelegatedTaskOrigin(db, projectId, task)
    if (!origin.originObjectId || !origin.originAssistantId || !origin.originProjectId) return false

    const workflow = await loadTaskWorkflow(db, projectId, task)
    const step = workflow[stepId]
    if (!step || isAiWorkflowStep(step) || step.reviewerUid !== task.userId) return false

    const receiptRef = db.doc(`delegatedTaskOrigins/${projectId}__${taskId}`)
    const key = buildNoticeKey(task, stepId)
    const claimed = await db.runTransaction(async transaction => {
        const receipt = await transaction.get(receiptRef)
        if (!receipt.exists || receipt.data()?.lastReviewNoticeKey === key) return false
        transaction.update(receiptRef, { lastReviewNoticeKey: key, lastReviewNoticeAt: Date.now() })
        return true
    })
    if (!claimed) return false

    const description = describeTaskWorkflow(task, workflow, task.userId)
    const latestResult = await loadLatestAssistantResult(db, projectId, taskId)
    const { summarizeVmResultForChat } = require('./vmResultSummary')
    const summary = latestResult
        ? await summarizeVmResultForChat({
              resultText: latestResult,
              userId: task.userId,
              projectId,
              objectId: taskId,
              objectType: 'tasks',
              taskLabel: buildTaskLabel(task),
              db,
          })
        : ''
    const text = buildNoticeText({
        task,
        step,
        next: description?.next || null,
        summary,
        link: `${getBaseUrl()}/projects/${projectId}/tasks/${taskId}/chat`,
    })

    const { createInitialStatusMessage } = require('./assistantStatusHelper')
    await createInitialStatusMessage(
        origin.originProjectId,
        origin.originObjectType || 'topics',
        origin.originObjectId,
        origin.originAssistantId,
        text,
        [task.userId],
        [],
        [task.userId]
    )
    console.log('[delegationReviewNotice] Announced review in origin conversation', {
        projectId,
        taskId,
        stepId,
        originObjectId: origin.originObjectId,
    })
    return true
}

module.exports = { buildNoticeText, notifyDelegationOriginOnHumanStep }
