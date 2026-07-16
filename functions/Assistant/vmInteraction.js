const crypto = require('crypto')

const { VM_DISPATCH_LEASE_MS, dispatchLeaseOwner } = require('./vmThreadQueue')

const VM_INTERACTION_STATUS_AWAITING = 'awaiting_user'
const VM_INTERACTION_TTL_MS = 24 * 60 * 60 * 1000
const VALID_VM_INTERACTION_KINDS = ['clarification', 'plan_review', 'tool_approval']
const VALID_VM_INTERACTION_ACTIONS = ['submit', 'approve', 'revise', 'deny', 'cancel']

function truncate(value, maxLength) {
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text
}

function sanitizeQuestions(questions) {
    if (!Array.isArray(questions)) return []
    return questions.slice(0, 4).map((question, index) => ({
        id: truncate(question?.id || `question-${index + 1}`, 100),
        header: truncate(question?.header || 'Question', 40),
        question: truncate(question?.question || '', 1200),
        multiSelect: !!question?.multiSelect,
        isOther: question?.isOther !== false,
        isSecret: !!question?.isSecret,
        options: Array.isArray(question?.options)
            ? question.options.slice(0, 5).map(option => ({
                  label: truncate(option?.label || '', 120),
                  description: truncate(option?.description || '', 500),
              }))
            : [],
    }))
}

function sanitizeVmInteraction({ requestId, kind, provider, payload = {}, createdAt, expiresAt }) {
    const base = {
        requestId,
        kind,
        provider,
        createdAt,
        expiresAt,
    }
    if (kind === 'clarification') {
        return { ...base, questions: sanitizeQuestions(payload.questions) }
    }
    if (kind === 'plan_review') {
        return { ...base, plan: truncate(payload.plan, 20000) }
    }
    return {
        ...base,
        toolName: truncate(payload.toolName || payload.name || 'Sensitive operation', 120),
        reason: truncate(payload.reason || '', 1200),
        command: truncate(payload.command || '', 2000),
        cwd: truncate(payload.cwd || '', 500),
    }
}

function validateVmInteractionResponse(kind, response) {
    const action = response?.action
    if (!VALID_VM_INTERACTION_ACTIONS.includes(action)) throw new Error('Unsupported VM interaction response action.')
    if (kind === 'clarification' && action !== 'submit' && action !== 'cancel') {
        throw new Error('Clarification responses must submit answers or cancel the VM task.')
    }
    if (kind === 'plan_review' && !['approve', 'revise', 'cancel'].includes(action)) {
        throw new Error('Plan responses must approve, revise, or cancel the VM task.')
    }
    if (kind === 'tool_approval' && !['approve', 'deny', 'cancel'].includes(action)) {
        throw new Error('Approval responses must approve, deny, or cancel the VM task.')
    }
    const answers = {}
    if (response?.answers && typeof response.answers === 'object' && !Array.isArray(response.answers)) {
        Object.entries(response.answers)
            .slice(0, 8)
            .forEach(([key, value]) => {
                const safeKey = truncate(key, 120)
                if (!safeKey || ['__proto__', 'prototype', 'constructor'].includes(safeKey)) return
                answers[safeKey] = Array.isArray(value)
                    ? value.slice(0, 5).map(answer => truncate(answer, 2000))
                    : truncate(value, 4000)
            })
    }
    return {
        action,
        answers,
        message: truncate(response?.message || '', 4000),
    }
}

async function createVmInteractionRequest({
    db,
    pendingRef,
    sessionRef,
    correlationId,
    userId,
    kind,
    provider,
    providerRequestId = '',
    payload = {},
    providerState = {},
    now = Date.now(),
    ttlMs = VM_INTERACTION_TTL_MS,
    requestId = crypto.randomUUID(),
}) {
    if (!VALID_VM_INTERACTION_KINDS.includes(kind)) throw new Error(`Unsupported VM interaction kind: ${kind}`)
    const createdAt = Number(now) || Date.now()
    const expiresAt = createdAt + ttlMs
    const interactionRef = db.doc(`vmJobInteractions/${correlationId}/requests/${requestId}`)
    const sanitized = sanitizeVmInteraction({ requestId, kind, provider, payload, createdAt, expiresAt })

    await db.runTransaction(async transaction => {
        const pendingSnapshot = await transaction.get(pendingRef)
        if (!pendingSnapshot.exists) throw new Error('VM job was not found.')
        const pending = pendingSnapshot.data() || {}
        if (pending.userId !== userId) throw new Error('VM interaction user does not own this job.')
        if (['completed', 'failed', 'cancelled'].includes(pending.status)) {
            throw new Error('VM job has already settled.')
        }

        transaction.set(interactionRef, {
            correlationId,
            requestId,
            kind,
            provider,
            providerRequestId,
            userId,
            payload,
            providerState,
            sanitized,
            status: 'pending',
            createdAt,
            expiresAt,
        })
        transaction.set(
            pendingRef,
            {
                status: VM_INTERACTION_STATUS_AWAITING,
                interactionPhase: kind === 'plan_review' ? 'planning' : pending.interactionPhase || 'executing',
                currentInteraction: sanitized,
                interactionProviderState: providerState,
                interactionRequestId: requestId,
                interactionRequestedAt: createdAt,
                interactionExpiresAt: expiresAt,
                expiresAt,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
            { merge: true }
        )
        transaction.set(
            sessionRef,
            {
                blockedByCorrelationId: correlationId,
                blockedReason: kind,
                blockedAt: createdAt,
                activeLeaseOwner: null,
                activeLeaseExpiresAt: null,
                activeCorrelationId: correlationId,
            },
            { merge: true }
        )
    })

    return sanitized
}

async function answerVmInteractionRequest({
    db,
    pendingRef,
    sessionRef,
    correlationId,
    requestId,
    userId,
    response,
    now = Date.now(),
    executionAttemptId = crypto.randomUUID(),
}) {
    const interactionRef = db.doc(`vmJobInteractions/${correlationId}/requests/${requestId}`)
    let result
    await db.runTransaction(async transaction => {
        const [pendingSnapshot, interactionSnapshot, sessionSnapshot] = await Promise.all([
            transaction.get(pendingRef),
            transaction.get(interactionRef),
            transaction.get(sessionRef),
        ])
        if (!pendingSnapshot.exists || !interactionSnapshot.exists) throw new Error('VM interaction was not found.')
        const pending = pendingSnapshot.data() || {}
        const interaction = interactionSnapshot.data() || {}
        const session = sessionSnapshot.exists ? sessionSnapshot.data() || {} : {}
        if (pending.userId !== userId || interaction.userId !== userId) {
            const error = new Error('Only the user who started the VM task can answer this interaction.')
            error.code = 'permission_denied'
            throw error
        }
        if (pending.status !== VM_INTERACTION_STATUS_AWAITING || pending.interactionRequestId !== requestId) {
            const error = new Error('This VM interaction is no longer active.')
            error.code = 'stale_interaction'
            throw error
        }
        if (interaction.status !== 'pending') {
            const error = new Error('This VM interaction has already been answered.')
            error.code = 'stale_interaction'
            throw error
        }
        if (Number(interaction.expiresAt) <= now) {
            const error = new Error('This VM interaction has expired.')
            error.code = 'expired_interaction'
            throw error
        }
        if (session.blockedByCorrelationId && session.blockedByCorrelationId !== correlationId) {
            throw new Error('The VM thread is blocked by another job.')
        }

        const normalizedResponse = validateVmInteractionResponse(interaction.kind, response)
        const cancelling = normalizedResponse.action === 'cancel'
        transaction.set(
            interactionRef,
            {
                status: cancelling ? 'cancelled' : 'answered',
                response: normalizedResponse,
                answeredAt: now,
                answeredBy: userId,
            },
            { merge: true }
        )
        transaction.set(
            pendingRef,
            {
                status: cancelling ? 'cancel_requested' : 'pending',
                currentInteraction: null,
                interactionRequestId: null,
                interactionResponse: normalizedResponse,
                answeredInteraction: interaction.sanitized || null,
                answeredInteractionRequestId: requestId,
                interactionAnsweredAt: now,
                executionAttemptId,
                launchState: 'requested',
                leaseOwner: null,
                leaseExpiresAt: null,
            },
            { merge: true }
        )
        transaction.set(
            sessionRef,
            {
                blockedByCorrelationId: null,
                blockedReason: null,
                blockedAt: null,
                activeLeaseOwner: dispatchLeaseOwner(correlationId),
                activeLeaseExpiresAt: now + VM_DISPATCH_LEASE_MS,
                activeCorrelationId: correlationId,
            },
            { merge: true }
        )
        result = {
            cancelling,
            executionAttemptId,
            response: normalizedResponse,
            interaction,
            pending,
        }
    })
    return result
}

async function expireVmInteractions(db, now = Date.now()) {
    const snapshot = await db
        .collection('pendingWebhooks')
        .where('status', '==', VM_INTERACTION_STATUS_AWAITING)
        .where('interactionExpiresAt', '<=', now)
        .limit(100)
        .get()
    const result = { checked: snapshot.size || snapshot.docs.length, expired: 0, errors: 0 }

    for (const doc of snapshot.docs) {
        try {
            const pending = doc.data() || {}
            if (pending.kind !== 'vm_job' || !pending.interactionRequestId) continue
            const sessionRef = db.doc(`vmSessions/${pending.projectId}__${pending.objectId}`)
            const interactionRef = db.doc(`vmJobInteractions/${doc.id}/requests/${pending.interactionRequestId}`)
            const expired = await db.runTransaction(async transaction => {
                const [latestSnapshot, interactionSnapshot, sessionSnapshot] = await Promise.all([
                    transaction.get(doc.ref),
                    transaction.get(interactionRef),
                    transaction.get(sessionRef),
                ])
                const latest = latestSnapshot.exists ? latestSnapshot.data() || {} : {}
                if (
                    latest.status !== VM_INTERACTION_STATUS_AWAITING ||
                    latest.interactionRequestId !== pending.interactionRequestId ||
                    Number(latest.interactionExpiresAt) > now
                ) {
                    return false
                }
                transaction.set(
                    doc.ref,
                    {
                        status: 'failed',
                        failureReason: 'interaction_expired',
                        failedAt: now,
                        currentInteraction: null,
                    },
                    { merge: true }
                )
                if (interactionSnapshot.exists) {
                    transaction.set(interactionRef, { status: 'expired', expiredAt: now }, { merge: true })
                }
                const session = sessionSnapshot.exists ? sessionSnapshot.data() || {} : {}
                if (session.blockedByCorrelationId === doc.id) {
                    transaction.set(
                        sessionRef,
                        {
                            blockedByCorrelationId: null,
                            blockedReason: null,
                            blockedAt: null,
                            activeLeaseOwner: null,
                            activeLeaseExpiresAt: null,
                            activeCorrelationId: null,
                        },
                        { merge: true }
                    )
                }
                return true
            })
            if (!expired) continue

            const text = '⌛ This VM task expired while waiting for your response. Start a new VM task to continue.'
            if (pending.statusCommentId) {
                await db
                    .doc(
                        `chatComments/${pending.projectId}/${pending.objectType || 'tasks'}/${
                            pending.objectId
                        }/comments/${pending.statusCommentId}`
                    )
                    .set(
                        {
                            commentText: text,
                            originalContent: text,
                            isLoading: false,
                            assistantRun: {
                                kind: 'vm_job',
                                runId: doc.id,
                                requestUserId: pending.userId,
                                status: 'failed',
                                failedAt: now,
                            },
                        },
                        { merge: true }
                    )
                    .catch(() => {})
            }
            const baseGold = Number(pending.goldCharged) || 0
            if (baseGold > 0) {
                const { refundGold } = require('../Gold/goldHelper')
                await refundGold(pending.userId, baseGold, {
                    source: 'vm_job_refund',
                    channel: 'assistant',
                    projectId: pending.projectId,
                    objectId: pending.objectId,
                    objectType: pending.objectType,
                    note: 'VM task expired while waiting for user input',
                }).catch(() => {})
            }
            const { advanceVmThreadQueue } = require('./vmThreadQueue')
            const next = await advanceVmThreadQueue(sessionRef).catch(() => null)
            if (next)
                await require('./vmJob')
                    .launchQueuedVmJob(next)
                    .catch(() => {})
            result.expired += 1
        } catch (error) {
            result.errors += 1
            console.warn('🖥️ VM JOB: failed expiring interaction', { correlationId: doc.id, error: error.message })
        }
    }
    return result
}

module.exports = {
    VM_INTERACTION_STATUS_AWAITING,
    VM_INTERACTION_TTL_MS,
    VALID_VM_INTERACTION_KINDS,
    sanitizeVmInteraction,
    validateVmInteractionResponse,
    createVmInteractionRequest,
    answerVmInteractionRequest,
    expireVmInteractions,
}
