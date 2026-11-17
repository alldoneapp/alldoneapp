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

const { DONE_STEP, OPEN_STEP, getBaseUrl } = require('../Utils/HelperFunctionsCloud')
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

// --- Every other step change (2026-11-17) -------------------------------------------------------
//
// The user goes on in the delegated task (moves it to "Merge", sends it back, completes it) or its
// workflow moves on. The conversation the task came from gets one short line, so the user and its
// assistant can pick the work up there. Left out, because something else already says it:
// - the delegation start itself: the delegating conversation just reported it;
// - a landing on the owner's own step that the owner did not make: the 📋 review notice above;
// - a move asked for in the origin conversation itself (any of the user's Anna threads counts as one
//   conversation): the assistant there confirmed it.
// No bell: this is a routine update, unlike the review notice.

const stepLabel = (workflow, stepId) => {
    if (stepId === OPEN_STEP) return 'Open'
    if (stepId === DONE_STEP) return 'Done'
    const description = workflow?.[stepId]?.description
    return (typeof description === 'string' && description.trim()) || 'Workflow step'
}

const WAITING_PHRASES = {
    assistant: 'the assistant works on it now',
    you: 'it waits for you',
    'task owner': 'it waits for you',
    'another member': 'it waits for another member',
}

const buildActorLine = ({ toStepId, actorUserId, actorName, ownerId }) => {
    if (!actorUserId) return null
    const completed = toStepId === DONE_STEP
    if (actorUserId === ownerId) return completed ? 'You completed it yourself.' : 'You moved it yourself.'
    return `${actorName || 'Another member'} ${completed ? 'completed' : 'moved'} it.`
}

const buildStepChangeText = ({ task, fromLabel, toStepId, toLabel, handledBy, actorUserId, actorName, link }) => {
    const label = buildTaskLabel(task)
    let line
    if (toStepId === DONE_STEP) line = `✅ ${label} is done (it was at “${fromLabel}”).`
    else if (toStepId === OPEN_STEP) line = `↩️ ${label} is back in Open (it was at “${fromLabel}”).`
    else {
        const waiting = WAITING_PHRASES[handledBy]
        line = `🔀 ${label} moved from “${fromLabel}” to “${toLabel}”${waiting ? `; ${waiting}` : ''}.`
    }
    const actorLine = buildActorLine({ toStepId, actorUserId, actorName, ownerId: task.userId })
    return [line, ...(actorLine ? [actorLine] : []), link].join('\n')
}

const sameConversation = (conversation, origin, userId) => {
    if (!conversation?.objectId || !origin?.originObjectId) return false
    if (conversation.objectId === origin.originObjectId) return true
    const { isAnnaChatId } = require('./annaWorkspace')
    return isAnnaChatId(conversation.objectId, userId) && isAnnaChatId(origin.originObjectId, userId)
}

/**
 * What a position change of a delegated task means for its origin conversation: null (nothing to
 * say), 'review' (the 📋 notice says it) or { actorUserId, fromConversation } for a step line.
 *
 * The `workflowStepMove` stamp says who moved the task: a chat move on the server, or the step picker
 * and the checkbox in the browser (bound to the writer by firestore.rules). It counts for this change
 * when it names the step the task landed on and was written with this update, or entered the step at
 * the task's `completed`. An older stamp says nothing about this move.
 */
const classifyStepChange = ({ oldTask = {}, newTask, workflow = {} }) => {
    const from = getTaskPosition(oldTask || {})
    const to = getTaskPosition(newTask)
    if (from === to) return null
    if (from === OPEN_STEP && newTask.delegationStartedAt != null && newTask.delegationStartedAt === newTask.completed)
        return null
    const move = newTask.workflowStepMove
    const sameStep = !!move && move.stepId === to
    const enteredWithMove = sameStep && move.enteredAt != null && move.enteredAt === newTask.completed
    const writtenNow = sameStep && move.at != null && move.at !== oldTask?.workflowStepMove?.at
    const step = workflow[to]
    // Same test as the review notice, so exactly one of the two speaks.
    const ownerEnteredOwnStep = enteredWithMove && move.actorUserId === newTask.userId
    if (
        to !== OPEN_STEP &&
        to !== DONE_STEP &&
        step &&
        !isAiWorkflowStep(step) &&
        step.reviewerUid === newTask.userId &&
        !ownerEnteredOwnStep
    )
        return 'review'
    const stamped = enteredWithMove || writtenNow
    return {
        actorUserId: stamped ? move.actorUserId || null : null,
        fromConversation: stamped ? move.fromConversation || null : null,
    }
}

/**
 * Tells the conversation a delegated task came from that its workflow position changed. Returns true
 * when a line was posted.
 */
async function notifyDelegationOriginOnStepChange({
    db = admin.firestore(),
    projectId,
    taskId,
    oldTask = {},
    newTask = {},
}) {
    if (!newTask || newTask.parentId || !isDelegatedWorkflowTask(newTask)) return false
    if (getTaskPosition(newTask) === getTaskPosition(oldTask || {})) return false

    const task = { ...newTask, id: taskId }
    const { loadDelegatedTaskOrigin } = require('./annaTaskDelegation')
    const origin = await loadDelegatedTaskOrigin(db, projectId, task)
    if (!origin.originObjectId || !origin.originAssistantId || !origin.originProjectId) return false

    const workflow = await loadTaskWorkflow(db, projectId, task)
    const change = classifyStepChange({ oldTask, newTask: task, workflow })
    if (!change || change === 'review') return false
    if (sameConversation(change.fromConversation, origin, task.userId)) return false

    const to = getTaskPosition(task)
    const receiptRef = db.doc(`delegatedTaskOrigins/${projectId}__${taskId}`)
    const key = buildNoticeKey(task, to)
    const claimed = await db.runTransaction(async transaction => {
        const receipt = await transaction.get(receiptRef)
        if (!receipt.exists || receipt.data()?.lastStepNoticeKey === key) return false
        transaction.update(receiptRef, { lastStepNoticeKey: key, lastStepNoticeAt: Date.now() })
        return true
    })
    if (!claimed) return false

    const description = describeTaskWorkflow(task, workflow, task.userId)
    let actorName = null
    if (change.actorUserId && change.actorUserId !== task.userId) {
        const actor = await db
            .doc(`users/${change.actorUserId}`)
            .get()
            .catch(() => null)
        actorName = (actor?.exists && actor.data()?.displayName) || null
    }
    const text = buildStepChangeText({
        task,
        fromLabel: stepLabel(workflow, getTaskPosition(oldTask || {})),
        toStepId: to,
        toLabel: stepLabel(workflow, to),
        handledBy: description?.current?.handledBy || null,
        actorUserId: change.actorUserId,
        actorName,
        link: `${getBaseUrl()}/projects/${projectId}/tasks/${taskId}/chat`,
    })

    const { createInitialStatusMessage } = require('./assistantStatusHelper')
    await createInitialStatusMessage(
        origin.originProjectId,
        origin.originObjectType || 'topics',
        origin.originObjectId,
        origin.originAssistantId,
        text,
        [],
        [],
        [task.userId]
    )
    console.log('[delegationReviewNotice] Announced a step change in the origin conversation', {
        projectId,
        taskId,
        to,
        originObjectId: origin.originObjectId,
    })
    return true
}

module.exports = {
    buildNoticeText,
    buildStepChangeText,
    classifyStepChange,
    notifyDelegationOriginOnHumanStep,
    notifyDelegationOriginOnStepChange,
}
