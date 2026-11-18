'use strict'

/**
 * move_task_workflow_step, for assistants and MCP (AT-2829). The rules live in
 * Tasks/workflowStepMove.js; this module finds the task, establishes who is asking and how, and
 * leaves a line in the task's chat when the approval came from another conversation.
 */

const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { isAiWorkflowStep } = require('../Tasks/workflowStepHelper')
const {
    describeTaskWorkflow,
    getTaskPosition,
    loadTaskWorkflow,
    moveTaskWorkflowStep,
} = require('../Tasks/workflowStepMove')

const MAX_ORIGIN_CANDIDATES = 25
const HUMAN_READABLE_ID = /^[a-z]+-\d+$/i

const trimmed = value => (typeof value === 'string' ? value.trim() : '')

/**
 * Whether this call answers a message the user typed themselves.
 *
 * An MCP client acts as the user (Settings → MCP gated it). In the app, the run must be an
 * interactive one (`humanTurn`) and its trigger comment must be the user's own: server-seeded
 * prompts of workflow steps, heartbeats and scheduled tasks never set `humanTurn`, and another
 * member's or an assistant's comment never counts as this user's approval.
 */
async function isHumanTurn(db, runtime, requestUserId) {
    if (runtime?.sourceChannel === 'mcp') return true
    if (runtime?.humanTurn !== true || !requestUserId) return false
    const { projectId, objectType, objectId, messageId } = runtime
    if (!projectId || !objectType || !objectId || !messageId) return false
    const comment = await db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${messageId}`).get()
    if (!comment.exists) return false
    const data = comment.data() || {}
    return data.creatorId === requestUserId && data.fromAssistant !== true
}

async function getMemberProjectIds(db, userId) {
    const snapshot = await db.collection('projects').where('userIds', 'array-contains', userId).get()
    return snapshot.docs.map(doc => doc.id)
}

const parseOriginId = doc => {
    const data = doc.data() || {}
    if (data.projectId && data.taskId) return { projectId: data.projectId, taskId: data.taskId }
    const separator = doc.id.indexOf('__')
    return separator > 0 ? { projectId: doc.id.slice(0, separator), taskId: doc.id.slice(separator + 2) } : null
}

/**
 * Tasks this conversation delegated that now stand on a step of the requesting user. These are what
 * "merge it" means in Anna's conversation after she reported a result.
 */
async function findTasksWaitingInConversation(db, runtime, requestUserId) {
    const snapshot = await db
        .collection('delegatedTaskOrigins')
        .where('originObjectId', '==', runtime.objectId)
        .where('ownerId', '==', requestUserId)
        .get()
    const candidates = snapshot.docs.map(parseOriginId).filter(Boolean).slice(-MAX_ORIGIN_CANDIDATES)
    const waiting = []
    for (const { projectId, taskId } of candidates) {
        const taskDoc = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
        if (!taskDoc.exists) continue
        const task = { ...taskDoc.data(), id: taskId }
        if (task.done) continue
        const workflow = await loadTaskWorkflow(db, projectId, task)
        const step = workflow[getTaskPosition(task)]
        if (!step || isAiWorkflowStep(step) || step.reviewerUid !== requestUserId) continue
        waiting.push({ projectId, taskId, task, workflow })
    }
    return waiting
}

const summarizeCandidate = ({ projectId, taskId, task, workflow }, requestUserId) => ({
    projectId,
    taskId,
    humanReadableId: task.humanReadableId || null,
    name: task.extendedName || task.name || '',
    currentStep: describeTaskWorkflow(task, workflow, requestUserId)?.current?.label || null,
})

/** Finds the task the call is about, or explains what is missing. */
async function resolveTaskReference(db, { args, projectId, requestUserId, runtime }) {
    const rawId = trimmed(args.taskId)
    const explicitProjectId = trimmed(args.projectId)

    if (rawId && HUMAN_READABLE_ID.test(rawId)) {
        const projectIds = explicitProjectId ? [explicitProjectId] : await getMemberProjectIds(db, requestUserId)
        const matches = []
        for (const candidateProjectId of projectIds) {
            const snapshot = await db
                .collection(`items/${candidateProjectId}/tasks`)
                .where('humanReadableId', '==', rawId.toUpperCase())
                .limit(2)
                .get()
            snapshot.docs.forEach(doc => matches.push({ projectId: candidateProjectId, taskId: doc.id }))
        }
        if (matches.length === 1) return matches[0]
        if (matches.length > 1) {
            return {
                error: { code: 'ambiguous_task', message: `${rawId} exists in more than one project; pass projectId.` },
            }
        }
        return { error: { code: 'task_not_found', message: `No task ${rawId} was found.` } }
    }

    if (rawId) {
        const projectIds = [...new Set([explicitProjectId, runtime?.projectId, projectId].filter(Boolean))]
        for (const candidateProjectId of projectIds) {
            if ((await db.doc(`items/${candidateProjectId}/tasks/${rawId}`).get()).exists) {
                return { projectId: candidateProjectId, taskId: rawId }
            }
        }
        return {
            error: { code: 'task_not_found', message: 'The task was not found; pass its projectId or visible number.' },
        }
    }

    if (runtime?.objectType === 'tasks' && runtime.objectId) {
        return { projectId: runtime.projectId || projectId, taskId: runtime.objectId }
    }

    if (runtime?.objectId && requestUserId) {
        const waiting = await findTasksWaitingInConversation(db, runtime, requestUserId)
        if (waiting.length === 1) return { projectId: waiting[0].projectId, taskId: waiting[0].taskId }
        if (waiting.length > 1) {
            return {
                error: {
                    code: 'needs_task_choice',
                    message:
                        'Several tasks from this conversation wait for the user. Ask which one, then pass its taskId.',
                    tasks: waiting.map(candidate => summarizeCandidate(candidate, requestUserId)),
                },
            }
        }
    }

    return {
        error: {
            code: 'task_required',
            message:
                'No task from this conversation waits for the user. Pass the taskId (or visible number like AT-123).',
        },
    }
}

async function postApprovalNoteInTaskThread(db, { projectId, taskId, task, assistantId, requestUserId, result, note }) {
    const user = await db.doc(`users/${requestUserId}`).get()
    const name = (user.exists && user.data()?.displayName) || 'The task owner'
    const lines = [`${name} moved this task from “${result.from.label}” to “${result.to.label}” in chat.`]
    if (trimmed(note)) lines.push(`Instruction: ${trimmed(note)}`)
    const { createInitialStatusMessage } = require('./assistantStatusHelper')
    await createInitialStatusMessage(
        projectId,
        'tasks',
        taskId,
        assistantId,
        lines.join('\n'),
        [],
        task.isPublicFor || [FEED_PUBLIC_FOR_ALL],
        []
    )
}

async function executeMoveTaskWorkflowStepTool({
    db,
    args = {},
    projectId,
    assistantId,
    requestUserId,
    toolRuntimeContext: runtime = null,
    getFeedUser,
}) {
    if (!requestUserId) return { success: false, code: 'no_user', message: 'There is no user to act for.' }

    const reference = await resolveTaskReference(db, { args, projectId, requestUserId, runtime })
    if (reference.error) return { success: false, ...reference.error }

    const { assertObjectAccess } = require('../shared/privacyAccess')
    try {
        await assertObjectAccess(db, requestUserId, reference.projectId, 'tasks', reference.taskId)
    } catch (error) {
        return {
            success: false,
            code: 'task_not_found',
            message: 'The task was not found or is not visible to the user.',
        }
    }

    const taskDoc = await db.doc(`items/${reference.projectId}/tasks/${reference.taskId}`).get()
    if (!taskDoc.exists) return { success: false, code: 'task_not_found', message: 'The task no longer exists.' }
    const task = { ...taskDoc.data(), id: reference.taskId }

    const to = trimmed(String(args.to ?? ''))
    if (!to) {
        const workflow = await loadTaskWorkflow(db, reference.projectId, task)
        const description = describeTaskWorkflow(task, workflow, requestUserId)
        return {
            success: true,
            moved: false,
            projectId: reference.projectId,
            taskId: reference.taskId,
            humanReadableId: task.humanReadableId || null,
            taskName: task.extendedName || task.name || '',
            workflow: description,
            message: description
                ? `The task stands on “${description.current.label}”.`
                : 'The task owner has no workflow in this project.',
        }
    }

    const inOwnThread = runtime?.objectType === 'tasks' && runtime.objectId === reference.taskId
    const humanTurn = await isHumanTurn(db, runtime, requestUserId)
    const feedUser = getFeedUser ? await getFeedUser(reference.projectId) : null

    const result = await moveTaskWorkflowStep({
        db,
        projectId: reference.projectId,
        taskId: reference.taskId,
        actorUserId: requestUserId,
        to,
        expectedStepId: trimmed(args.expectedStepId) || null,
        skipSteps: args.skipSteps === true,
        note: trimmed(args.note),
        humanTurn,
        runLockId: inOwnThread ? runtime?.runLockId || null : null,
        feedUser,
        fromConversation:
            !inOwnThread && runtime?.sourceChannel !== 'mcp' && runtime?.objectId
                ? { projectId: runtime.projectId || null, objectType: runtime.objectType, objectId: runtime.objectId }
                : null,
    })

    if (result.success && result.moved && assistantId && !inOwnThread) {
        try {
            await postApprovalNoteInTaskThread(db, {
                projectId: reference.projectId,
                taskId: reference.taskId,
                task,
                assistantId,
                requestUserId,
                result,
                note: args.note,
            })
        } catch (error) {
            console.warn('[move_task_workflow_step] Could not post the move in the task chat', {
                taskId: reference.taskId,
                error: error.message,
            })
        }
    }

    if (result.success && result.moved) {
        return {
            ...result,
            message: `Moved from “${result.from.label}” to “${result.to.label}”. ${result.outcome} Tell the user in one short sentence.${
                inOwnThread ? " The user is in this task's chat, where the work continues: do not link this task." : ''
            }`,
            // Moved from the task's own chat, the work goes on where the user already is: the reply
            // gets no link to this task, not even one copied from the thread (AT-3096 follow-up).
            ...(inOwnThread
                ? {
                      delegatedTask: {
                          projectId: reference.projectId,
                          taskId: reference.taskId,
                          currentConversation: true,
                      },
                  }
                : {}),
        }
    }
    return result
}

module.exports = {
    executeMoveTaskWorkflowStepTool,
    findTasksWaitingInConversation,
    isHumanTurn,
    resolveTaskReference,
}
