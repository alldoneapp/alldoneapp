'use strict'

/**
 * "Needs your input" in Anna's conversation when a VM asks the user something (AT-3065).
 *
 * A VM question (clarification, plan review, tool approval) is answered in the task chat that hosts
 * the VM, and on its own it only rewrites that chat's status comment and raises the bell. When the
 * VM is Anna's work, the user is likely talking to her somewhere else, so she says so there:
 *
 * - a job that carries an origin conversation (an assistant started it from another thread), or
 * - a job on a task Anna delegated from her conversation, asked by the user who delegated it (the
 *   delegation receipt names the conversation, as for the "ready for you" notice).
 *
 * A VM the user started on a task of their own stays in the task chat and the bell.
 *
 * One line per question: the job remembers the request it announced, and a question that was
 * already answered is not announced.
 */

const admin = require('firebase-admin')

const { getBaseUrl } = require('../Utils/HelperFunctionsCloud')
const { buildVmChatPath } = require('./vmHostTaskHelper')

const QUESTION_MAX = 300
const PLAN_SNIPPET_MAX = 600
const REASON_MAX = 300

const text = value => (typeof value === 'string' ? value.trim() : '')
const clip = (value, max) => {
    const trimmed = text(value)
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

const describeTask = task => {
    if (!task) return ''
    const name = text(task.extendedName) || text(task.name)
    if (task.humanReadableId && name) return `${task.humanReadableId} “${name}”`
    return task.humanReadableId || (name ? `“${name}”` : '')
}

function buildVmInputNoticeText({ interaction, agentLabel, task, link }) {
    const agent = text(agentLabel) || 'The VM'
    const subject = describeTask(task)
    const on = subject ? ` on ${subject}` : ''
    const lines = []

    if (interaction?.kind === 'plan_review') {
        lines.push(`🗒️ ${agent} prepared a plan${on} and waits for your review before it runs.`)
        const plan = clip(interaction.plan, PLAN_SNIPPET_MAX)
        if (plan) lines.push('', plan)
    } else if (interaction?.kind === 'tool_approval') {
        const tool = clip(interaction.toolName, 120)
        lines.push(`🔐 ${agent} needs your approval${on} before it continues${tool ? `: ${tool}` : ''}.`)
        const reason = clip(interaction.reason, REASON_MAX)
        if (reason) lines.push('', reason)
    } else {
        lines.push(`💬 ${agent} needs your input${on} before it continues.`)
        const questions = (Array.isArray(interaction?.questions) ? interaction.questions : [])
            .map(question => clip(question?.question || question?.header, QUESTION_MAX))
            .filter(Boolean)
        if (questions.length) lines.push('', ...questions.map(question => `• ${question}`))
    }

    lines.push('', `Answer it in the task chat: ${link}`)
    return lines.join('\n')
}

/** Where Anna talks to the user about this job, or null when the job is not Anna's work. */
async function resolveInputNoticeOrigin(db, pending, task) {
    const own = {
        originProjectId: text(pending.originProjectId),
        originObjectType: text(pending.originObjectType) || 'topics',
        originObjectId: text(pending.originObjectId),
        originAssistantId: text(pending.originAssistantId),
    }
    if (own.originProjectId && own.originObjectId && own.originAssistantId) return own

    // The delegation receipt speaks for the user who delegated the task, so only their questions go
    // there; another member's VM on the same task is not this conversation's business.
    if (!task || !pending.userId || task.userId !== pending.userId) return null
    const { loadDelegatedTaskOrigin } = require('./annaTaskDelegation')
    const origin = await loadDelegatedTaskOrigin(db, pending.projectId, task)
    if (!origin.originProjectId || !origin.originObjectId || !origin.originAssistantId) return null
    return { ...origin, originObjectType: origin.originObjectType || 'topics' }
}

async function loadHostTask(db, pending) {
    if ((pending.objectType || 'tasks') !== 'tasks' || !pending.projectId || !pending.objectId) return null
    const snapshot = await db.doc(`items/${pending.projectId}/tasks/${pending.objectId}`).get()
    return snapshot.exists ? { ...snapshot.data(), id: pending.objectId } : null
}

/**
 * Tells the user in Anna's conversation that a VM waits for them. Best-effort: returns true when a
 * message was posted, false otherwise, and never throws.
 */
async function notifyVmInputNeededInOrigin({
    db = admin.firestore(),
    pendingRef,
    pendingWebhook: pending = {},
    interaction,
    agentLabel,
}) {
    const requestId = text(interaction?.requestId)
    if (!pendingRef || !requestId || !pending?.userId) return false
    try {
        const task = await loadHostTask(db, pending)
        const origin = await resolveInputNoticeOrigin(db, pending, task)
        if (!origin) return false
        if (origin.originProjectId === pending.projectId && origin.originObjectId === pending.objectId) return false

        const claimed = await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(pendingRef)
            const job = snapshot.exists ? snapshot.data() || {} : null
            if (!job || job.interactionRequestId !== requestId || job.status !== 'awaiting_user') return false
            if (job.originInputNoticeRequestId === requestId) return false
            transaction.set(
                pendingRef,
                { originInputNoticeRequestId: requestId, originInputNoticeAt: Date.now() },
                { merge: true }
            )
            return true
        })
        if (!claimed) return false

        const link = `${getBaseUrl()}${buildVmChatPath(pending.projectId, pending.objectType || 'tasks', pending.objectId)}`
        const message = buildVmInputNoticeText({ interaction, agentLabel, task, link })

        const { createInitialStatusMessage } = require('./assistantStatusHelper')
        await createInitialStatusMessage(
            origin.originProjectId,
            origin.originObjectType,
            origin.originObjectId,
            origin.originAssistantId,
            message,
            [pending.userId],
            [],
            [pending.userId]
        )
        console.log('🖥️ VM JOB: Announced a waiting question in the origin conversation', {
            correlationId: pending.correlationId,
            requestId,
            kind: interaction?.kind,
            originProjectId: origin.originProjectId,
            originObjectId: origin.originObjectId,
        })
        return true
    } catch (error) {
        console.warn('🖥️ VM JOB: Could not announce the waiting question in the origin conversation', {
            correlationId: pending?.correlationId,
            requestId,
            error: error?.message || String(error),
        })
        return false
    }
}

module.exports = { buildVmInputNoticeText, notifyVmInputNeededInOrigin, resolveInputNoticeOrigin }
