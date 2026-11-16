'use strict'

/**
 * Moving a task through its workflow from a conversation (AT-2829).
 *
 * "merge it" in a task chat or in Anna's conversation should move the task to its next step without
 * the user opening the step picker. The assistant decides that the message is an approval; this
 * module decides whether the move is allowed and performs it, so the rules hold whatever the model
 * believes:
 *
 * - Only a live human turn moves a task: a message the user typed in the app (or their MCP client,
 *   which acts as the user). Unattended runs (workflow AI steps, heartbeats, scheduled tasks, email,
 *   WhatsApp) never approve a step. AI steps keep advancing themselves through the workflow runner.
 * - Only the task owner or the reviewer of the current human step may move it, and only the owner
 *   may move a task off an AI step or off Open.
 * - Forward by one step is the approval. Jumping over steps, or to Done while steps remain, needs
 *   `skipSteps` (the user asked for it in so many words), and only the owner may skip a step that
 *   belongs to another member.
 * - A note travels to the next AI step as an addition to its saved prompt (`mode: 'append'`), never
 *   as a replacement, so "merge it, squash the commits" still runs the configured merge prompt.
 *
 * The task write mirrors the client's moveTasksFromMiddleOfWorkflow / moveTasksFromOpen field for
 * field, the same way advanceTaskFromWorkflowStep mirrors its forward branch, so the onUpdateTask
 * fan-out (AI step enqueue, Gold for progress, status feed, statistics) sees an ordinary move.
 * Reopening a completed task is not offered here: only the client's moveTasksFromDone reverses the
 * completion statistics.
 */

const admin = require('firebase-admin')

const { OPEN_STEP, DONE_STEP } = require('../Utils/HelperFunctionsCloud')
const { getSortedWorkflowStepIds, isAiWorkflowStep, isOpenStepId } = require('./workflowStepHelper')
const { withDelegationReviewStep } = require('../shared/delegatedTaskWorkflow')
const { buildLastEditorVia } = require('../shared/mcpActor')

const OPEN_ID = 'open'
const DONE_ID = 'done'
const NEXT_TARGETS = ['next', 'forward', 'approve']
const BACK_TARGETS = ['back', 'previous', 'prev']
const MAX_NOTE_LENGTH = 2000
const PROMPT_OVERRIDE_MODE_APPEND = 'append'

const toPublicStepId = stepId => (stepId === OPEN_STEP ? OPEN_ID : stepId === DONE_STEP ? DONE_ID : stepId)

// Normalized: a legacy 'Open' entry (tasks created by assistants or MCP) reads as OPEN_STEP.
const getStepHistory = task =>
    (Array.isArray(task?.stepHistory) ? task.stepHistory : []).map(stepId =>
        isOpenStepId(stepId) ? OPEN_STEP : stepId
    )

/** Where the task stands: OPEN_STEP, DONE_STEP or a workflow step id. */
const getTaskPosition = task => {
    if (task?.done) return DONE_STEP
    const history = getStepHistory(task)
    return history.length ? history[history.length - 1] : OPEN_STEP
}

const getWorkflowOwnerRef = (db, projectId, task) =>
    task?.workflowTask === true
        ? db.doc(`assistants/${projectId}/items/${task.userId}`)
        : db.doc(`users/${task.userId}`)

/** The workflow the task actually runs through: the owner's saved steps plus any delegation review. */
const loadTaskWorkflow = async (db, projectId, task) => {
    if (!task?.userId) return {}
    const owner = await getWorkflowOwnerRef(db, projectId, task).get()
    const saved = owner.exists ? owner.data()?.workflow?.[projectId] || {} : {}
    return withDelegationReviewStep(saved, task)
}

const describeHandler = (workflow, stepId, task, viewerUserId) => {
    if (stepId === DONE_STEP) return null
    const reviewerUid = stepId === OPEN_STEP ? task.userId : workflow[stepId]?.reviewerUid
    if (stepId !== OPEN_STEP && isAiWorkflowStep(workflow[stepId])) return 'assistant'
    if (reviewerUid && reviewerUid === viewerUserId) return 'you'
    if (reviewerUid && reviewerUid === task.userId) return 'task owner'
    return 'another member'
}

const describeStep = (workflow, stepId, task, viewerUserId) => {
    if (stepId === OPEN_STEP) {
        return { id: OPEN_ID, label: 'Open', handledBy: describeHandler(workflow, stepId, task, viewerUserId) }
    }
    if (stepId === DONE_STEP) return { id: DONE_ID, label: 'Done', handledBy: null }
    const step = workflow[stepId] || {}
    return {
        id: stepId,
        label: (typeof step.description === 'string' && step.description.trim()) || 'Workflow step',
        handledBy: describeHandler(workflow, stepId, task, viewerUserId),
    }
}

/**
 * The task's workflow as the assistant sees it: every position in order, where the task stands, and
 * the steps a plain "next" or "back" would reach. Null when the owner has no workflow here.
 */
const describeTaskWorkflow = (task, workflow, viewerUserId) => {
    const stepIds = getSortedWorkflowStepIds(workflow || {})
    if (stepIds.length === 0) return null
    const position = getTaskPosition(task)
    const positions = [OPEN_STEP, ...stepIds, DONE_STEP]
    const index = positions.indexOf(position)
    const steps = positions.map(stepId => ({
        ...describeStep(workflow, stepId, task, viewerUserId),
        current: stepId === position,
    }))
    return {
        current: index >= 0 ? steps[index] : { id: String(position), label: 'Unknown step', handledBy: null },
        next: index >= 0 && position !== DONE_STEP ? steps[index + 1] : null,
        previous: index > 0 && position !== DONE_STEP ? steps[index - 1] : null,
        steps,
    }
}

/** One line per workflow for prompts: Open → “Implement” (assistant) → [“Review” (you)] → Done. */
const formatWorkflowLine = description =>
    description.steps
        .map(step => {
            const label = step.id === OPEN_ID || step.id === DONE_ID ? step.label : `“${step.label}”`
            const text = step.handledBy && step.id !== OPEN_ID ? `${label} (${step.handledBy})` : label
            return step.current ? `[${text}, current]` : text
        })
        .join(' → ')

const normalizeKey = value =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[“”"']/g, '')

/**
 * Resolves `to` against the task's workflow. Accepts next/back, open/done, a step id or a step name
 * (exact, then a unique partial match).
 */
const resolveTarget = (to, { workflow, task }) => {
    const stepIds = getSortedWorkflowStepIds(workflow)
    const position = getTaskPosition(task)
    const positions = [OPEN_STEP, ...stepIds, DONE_STEP]
    const index = positions.indexOf(position)
    const raw = typeof to === 'string' || typeof to === 'number' ? String(to).trim() : ''
    const key = normalizeKey(raw)
    if (!key)
        return {
            error: { code: 'invalid_target', message: 'Say where to move the task: next, back, done or a step name.' },
        }

    if (NEXT_TARGETS.includes(key)) {
        if (index < 0)
            return {
                error: {
                    code: 'unknown_position',
                    message: 'The task stands on a step that is no longer in its workflow. Move it in the app.',
                },
            }
        return { stepId: positions[index + 1] }
    }
    if (BACK_TARGETS.includes(key)) {
        if (index <= 0)
            return { error: { code: 'no_previous_step', message: 'The task is Open; there is no earlier step.' } }
        return { stepId: positions[index - 1] }
    }
    if (key === OPEN_ID || raw === String(OPEN_STEP)) return { stepId: OPEN_STEP }
    if (key === DONE_ID || key === 'complete' || key === 'completed' || raw === String(DONE_STEP))
        return { stepId: DONE_STEP }
    if (stepIds.includes(raw)) return { stepId: raw }

    const labelled = stepIds.map(stepId => ({ stepId, label: normalizeKey(workflow[stepId]?.description) }))
    const exact = labelled.filter(entry => entry.label && entry.label === key)
    const partial = exact.length
        ? exact
        : labelled.filter(entry => entry.label && (entry.label.includes(key) || key.includes(entry.label)))
    if (partial.length === 1) return { stepId: partial[0].stepId }
    const names = stepIds.map(stepId => `“${workflow[stepId]?.description || stepId}”`).join(', ')
    if (partial.length > 1) {
        return {
            error: {
                code: 'ambiguous_step',
                message: `“${raw}” matches more than one step (${names}). Name the step exactly.`,
            },
        }
    }
    return {
        error: {
            code: 'unknown_step',
            message: `This task's workflow has no step called “${raw}”. Its steps are: ${names}.`,
        },
    }
}

/** The approval rules above, as data. Returns null when the move is allowed. */
const checkMovePermission = ({ task, workflow, targetStepId, actorUserId, humanTurn, skipSteps }) => {
    const position = getTaskPosition(task)
    if (!humanTurn) {
        return {
            code: 'needs_human_request',
            message:
                'Workflow steps move only on a request the user typed in this conversation. AI steps advance on their own when their run finishes; leave this task where it is and report back instead.',
        }
    }
    if (position === DONE_STEP) {
        return {
            code: 'task_done',
            message: 'The task is already done. Reopen it in the app if it should go back into its workflow.',
        }
    }
    if (targetStepId === position) return { code: 'already_there', message: 'The task is already on that step.' }

    const isOwner = actorUserId === task.userId
    const currentStep = position === OPEN_STEP ? null : workflow[position]
    const isCurrentHumanReviewer =
        !!currentStep && !isAiWorkflowStep(currentStep) && currentStep.reviewerUid === actorUserId
    if (!isOwner && !isCurrentHumanReviewer) {
        return {
            code: 'not_your_step',
            message:
                position === OPEN_STEP || isAiWorkflowStep(currentStep)
                    ? 'Only the task owner can move this task from its current step.'
                    : 'Only the reviewer of the current step or the task owner can move this task.',
        }
    }

    const stepIds = getSortedWorkflowStepIds(workflow)
    const positions = [OPEN_STEP, ...stepIds, DONE_STEP]
    const from = positions.indexOf(position)
    const to = positions.indexOf(targetStepId)
    if (from < 0) {
        return {
            code: 'unknown_position',
            message: 'The task stands on a step that is no longer in its workflow. Move it in the app.',
        }
    }
    if (to > from + 1) {
        const skipped = positions.slice(from + 1, to)
        if (!skipSteps) {
            return {
                code: 'would_skip_steps',
                message: `Moving there skips ${skipped
                    .map(stepId => `“${workflow[stepId]?.description || stepId}”`)
                    .join(', ')}. Ask the user whether to skip, and pass skipSteps only if they say so.`,
            }
        }
        const skipsSomeoneElse = skipped.some(
            stepId => !isAiWorkflowStep(workflow[stepId]) && workflow[stepId]?.reviewerUid !== actorUserId
        )
        if (skipsSomeoneElse && !isOwner) {
            return { code: 'not_your_step', message: "Only the task owner can skip another member's review step." }
        }
    }
    return null
}

/** The task fields a move writes, mirroring the client's movers for the same transition. */
const buildWorkflowMoveUpdate = ({
    task,
    workflow,
    targetStepId,
    actorUserId,
    now,
    note,
    runLockId,
    feedUser = null,
}) => {
    const position = getTaskPosition(task)
    const stepIds = getSortedWorkflowStepIds(workflow)
    const history = getStepHistory(task)
    const userIds = Array.isArray(task.userIds) && task.userIds.length ? task.userIds : [task.userId]
    let update
    let isForward

    if (targetStepId === DONE_STEP) {
        isForward = true
        update = {
            userIds: [task.userId],
            currentReviewerId: DONE_STEP,
            completed: now,
            done: true,
            inDone: true,
        }
    } else if (targetStepId === OPEN_STEP && task.workflowTask !== true) {
        isForward = false
        update = {
            userIds: [task.userId],
            stepHistory: [OPEN_STEP],
            currentReviewerId: task.userId,
            completed: null,
            completedTime: null,
            dueDate: now,
            done: false,
            inDone: false,
        }
    } else {
        // An assistant workflow task is born into its workflow; its "Open" is the first step.
        const destination = targetStepId === OPEN_STEP ? stepIds[0] : targetStepId
        isForward = stepIds.indexOf(destination) > stepIds.indexOf(position)
        if (isForward) {
            update = {
                userIds: [...userIds, workflow[destination].reviewerUid],
                currentReviewerId: workflow[destination].reviewerUid,
                stepHistory: [...history, destination],
                completed: now,
                dueDate: now,
                done: false,
                inDone: false,
            }
        } else {
            const newUserIds = [task.userId]
            const newStepHistory = task.workflowTask ? [] : [OPEN_STEP]
            let reviewerId = task.userId
            for (const stepId of stepIds) {
                const { reviewerUid } = workflow[stepId]
                if (stepId === destination) {
                    newStepHistory.push(stepId)
                    newUserIds.push(reviewerUid)
                    reviewerId = reviewerUid
                    break
                }
                if (history.includes(stepId)) {
                    newStepHistory.push(stepId)
                    newUserIds.push(reviewerUid)
                }
            }
            update = {
                userIds: newUserIds,
                stepHistory: newStepHistory,
                currentReviewerId: reviewerId,
                completed: now,
                dueDate: now,
                done: false,
                inDone: false,
            }
        }
        targetStepId = destination
    }

    const cleanNote = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE_LENGTH) : ''
    const landsOnAiStep =
        targetStepId !== DONE_STEP && targetStepId !== OPEN_STEP && isAiWorkflowStep(workflow[targetStepId])
    // Over MCP the feed user carries the client marker, so the task says "via Claude" like any MCP edit.
    const lastEditorVia = buildLastEditorVia(feedUser, now)

    return {
        targetStepId,
        isForward,
        update: {
            ...update,
            sortIndex: now,
            lastEditorId: actorUserId,
            lastEditionDate: now,
            lastEditorVia: lastEditorVia || null,
            // Assistant workflow tasks are paid for by whoever moves them into a step.
            ...(task.workflowTask === true ? { workflowPayerUserId: actorUserId } : {}),
            // Added to the next AI step's saved prompt, never replacing it. Only the owner's note is
            // honoured by the run (resolveWorkflowRunIdentity), exactly like a popup handoff comment.
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
            // The chat run that made this move is still live when the task lands on an AI step. The
            // step must wait for it, not count it as "the assistant is already working on this task"
            // and skip itself (AT-2222). See getWorkflowMoverRunLockId.
            workflowStepMove: {
                stepId: targetStepId,
                enteredAt: update.completed ?? null,
                runLockId: runLockId || null,
                actorUserId,
                at: now,
            },
        },
    }
}

/**
 * The message lock of the chat run that moved the task onto `stepId`, while that move is the
 * task's latest transition. The workflow runner ignores this one run when deciding whether the
 * assistant is already working on the task, and waits for it to finish instead.
 */
const getWorkflowMoverRunLockId = (task, stepId) => {
    const move = task?.workflowStepMove
    if (!move || !move.runLockId || move.stepId !== stepId) return null
    if (move.enteredAt == null || move.enteredAt !== task.completed) return null
    return move.runLockId
}

const isProjectMember = async (db, projectId, userId) => {
    const project = await db.doc(`projects/${projectId}`).get()
    const userIds = project.exists ? project.data()?.userIds : null
    return Array.isArray(userIds) && userIds.includes(userId)
}

const describeOutcome = (workflow, targetStepId, task, actorUserId) => {
    if (targetStepId === DONE_STEP) return 'The task is done.'
    if (targetStepId === OPEN_STEP) return 'The task is back to Open with its owner.'
    const step = workflow[targetStepId]
    if (isAiWorkflowStep(step)) {
        return `The assistant step “${step.description}” starts automatically, usually within a minute, and posts its result in the task's chat.`
    }
    return step.reviewerUid === actorUserId
        ? `The task now waits for you at “${step.description}”.`
        : `The task now waits for another member at “${step.description}”.`
}

/**
 * Moves a task through its workflow on behalf of `actorUserId`.
 *
 * @returns {Promise<object>} `{ success: true, moved: true, from, to, outcome, workflow }`, or
 *   `{ success: false, code, message, workflow }` when the move is not allowed or not possible.
 */
async function moveTaskWorkflowStep({
    db = admin.firestore(),
    projectId,
    taskId,
    actorUserId,
    to,
    expectedStepId = null,
    skipSteps = false,
    note = '',
    humanTurn = false,
    runLockId = null,
    feedUser = null,
    now = Date.now,
}) {
    if (!projectId || !taskId || !actorUserId) throw new Error('projectId, taskId and actorUserId are required')
    if (!(await isProjectMember(db, projectId, actorUserId))) {
        return { success: false, code: 'not_a_member', message: 'You are not a member of the task’s project.' }
    }

    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const snapshot = await taskRef.get()
    if (!snapshot.exists) return { success: false, code: 'task_not_found', message: 'The task no longer exists.' }
    const initialTask = { ...snapshot.data(), id: taskId }
    if (initialTask.parentId) {
        return {
            success: false,
            code: 'subtask',
            message: 'Subtasks follow their parent task. Move the parent task instead.',
        }
    }
    const workflow = await loadTaskWorkflow(db, projectId, initialTask)
    const describe = task => describeTaskWorkflow(task, workflow, actorUserId)
    if (!describe(initialTask)) {
        return { success: false, code: 'no_workflow', message: 'The task owner has no workflow in this project.' }
    }

    const result = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(taskRef)
        if (!fresh.exists) return { success: false, code: 'task_not_found', message: 'The task no longer exists.' }
        const task = { ...fresh.data(), id: taskId }
        const position = getTaskPosition(task)

        if (expectedStepId !== null && expectedStepId !== undefined && expectedStepId !== '') {
            const expected = String(expectedStepId)
            if (expected !== String(toPublicStepId(position)) && expected !== String(position)) {
                return {
                    success: false,
                    code: 'task_moved',
                    message: `The task has moved since; it now stands on “${describeStep(workflow, position, task, actorUserId).label}”. Check with the user before moving it.`,
                    workflow: describe(task),
                }
            }
        }

        const target = resolveTarget(to, { workflow, task })
        if (target.error) return { success: false, ...target.error, workflow: describe(task) }

        const denied = checkMovePermission({
            task,
            workflow,
            targetStepId: target.stepId,
            actorUserId,
            humanTurn,
            skipSteps: skipSteps === true,
        })
        if (denied) return { success: false, ...denied, workflow: describe(task) }

        const timestamp = now()
        const move = buildWorkflowMoveUpdate({
            task,
            workflow,
            targetStepId: target.stepId,
            actorUserId,
            now: timestamp,
            note,
            runLockId,
            feedUser,
        })
        transaction.set(taskRef, move.update, { merge: true })

        // Subtasks mirror their parent's position, like advanceTaskFromWorkflowStep and the client.
        const movingToDone = move.targetStepId === DONE_STEP
        const { workflowAiPromptOverride, workflowStepMove, ...subtaskUpdate } = move.update
        for (const subtaskId of Array.isArray(task.subtaskIds) ? task.subtaskIds : []) {
            transaction.set(
                db.doc(`items/${projectId}/tasks/${subtaskId}`),
                { ...subtaskUpdate, parentDone: movingToDone, inDone: movingToDone },
                { merge: true }
            )
        }

        return { success: true, task, move, position }
    })

    if (!result.success) return result

    const { task, move, position } = result
    const movedTask = { ...task, ...move.update }
    try {
        const { writeMovedInWorkflowFeed } = require('./workflowAiStep')
        const fromStep = position === OPEN_STEP ? { description: 'Open', reviewerUid: task.userId } : workflow[position]
        await writeMovedInWorkflowFeed(projectId, taskId, task, fromStep, move.targetStepId, workflow, {
            feedUser: feedUser || { uid: actorUserId },
            isForward: move.isForward,
        })
    } catch (error) {
        console.error('[workflowStepMove] Could not write workflow feed', { projectId, taskId, error: error.message })
    }

    console.log('[workflowStepMove] Moved task', {
        projectId,
        taskId,
        from: toPublicStepId(position),
        to: toPublicStepId(move.targetStepId),
        actorUserId,
        viaChatRun: !!runLockId,
    })

    return {
        success: true,
        moved: true,
        projectId,
        taskId,
        humanReadableId: task.humanReadableId || null,
        taskName: task.extendedName || task.name || '',
        from: describeStep(workflow, position, task, actorUserId),
        to: describeStep(workflow, move.targetStepId, movedTask, actorUserId),
        noteForwarded: !!move.update.workflowAiPromptOverride,
        outcome: describeOutcome(workflow, move.targetStepId, task, actorUserId),
        workflow: describeTaskWorkflow(movedTask, workflow, actorUserId),
    }
}

module.exports = {
    DONE_ID,
    OPEN_ID,
    PROMPT_OVERRIDE_MODE_APPEND,
    buildWorkflowMoveUpdate,
    checkMovePermission,
    describeStep,
    describeTaskWorkflow,
    formatWorkflowLine,
    getTaskPosition,
    getWorkflowMoverRunLockId,
    loadTaskWorkflow,
    moveTaskWorkflowStep,
    resolveTarget,
    toPublicStepId,
}
