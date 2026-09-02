const admin = require('firebase-admin')
const { buildVmGoldBillingDimensions } = require('./vmGoldDimensions')
const crypto = require('crypto')
const { VM_JOB_GOLD_REFUND_SOURCE } = require('./vmJob')
const { applyVmFailureWorkflowHold } = require('./vmWorkflowHold')
const { vmThreadSessionRef, advanceVmThreadQueue } = require('./vmThreadQueue')
const { findVmCloudRunExecution, __private__: cloudRunPrivate } = require('./vmCloudRunLauncher')

const VM_WORKER_TERMINATED_FAILURE_REASON = 'worker_terminated'
const VM_WORKER_RECONCILIATION_GRACE_MS = 30 * 1000
const VM_WORKER_RECONCILIATION_LIMIT = 100
const VM_WORKER_RECONCILIATION_LEASE_MS = 5 * 60 * 1000
const VM_WORKER_TERMINATED_TEXT =
    '❌ The VM worker stopped unexpectedly before it could finish. Any Gold charged for this run has been refunded. Please retry the task.'

function getVmRefundAmount(pending = {}) {
    return (
        (Number(pending.goldCharged) || 0) +
        (Number(pending.runtimeGoldCharged) || 0) +
        (Number(pending.proxyTokenGoldCharged) || 0)
    )
}

function isExpiredVmWorkerLease(pending = {}, now = Date.now()) {
    const leaseExpiresAt = Number(pending.leaseExpiresAt) || 0
    return (
        pending.kind === 'vm_job' &&
        pending.status === 'initiated' &&
        leaseExpiresAt > 0 &&
        leaseExpiresAt + VM_WORKER_RECONCILIATION_GRACE_MS <= now
    )
}

function isStaleVmWorkerCandidate(pending = {}, now = Date.now()) {
    if (isExpiredVmWorkerLease(pending, now)) return true
    const launchedAt = Number(pending.launchedAt) || Number(pending.launchRequestedAt) || 0
    return (
        pending.kind === 'vm_job' &&
        pending.status === 'pending' &&
        pending.launchState === 'launched' &&
        launchedAt > 0 &&
        launchedAt + VM_WORKER_RECONCILIATION_GRACE_MS <= now
    )
}

async function claimTerminatedVmWorker(doc, pending, execution, executionState, now) {
    return admin.firestore().runTransaction(async transaction => {
        const latestSnapshot = await transaction.get(doc.ref)
        if (!latestSnapshot.exists) return false
        const latest = latestSnapshot.data() || {}
        if (!isStaleVmWorkerCandidate(latest, now)) return false
        if ((latest.executionAttemptId || '') !== (pending.executionAttemptId || '')) return false

        transaction.set(
            doc.ref,
            {
                status: 'failed',
                error: executionState.message || 'Cloud Run VM worker terminated before task settlement',
                failureReason: VM_WORKER_TERMINATED_FAILURE_REASON,
                failedAt: now,
                launchState: 'failed',
                workerReconciliationState: 'pending',
                workerReconciliationClaimedAt: now,
                workerExecutionOutcome: executionState.outcome,
                workerExecutionReason: executionState.reason || null,
                cloudRunExecution: execution.name || latest.cloudRunExecution || null,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
            { merge: true }
        )
        return true
    })
}

async function clearTerminatedVmSession(pending) {
    const correlationId = pending.correlationId
    const sessionRef = vmThreadSessionRef(pending.projectId, pending.objectId)
    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(sessionRef)
        if (!snapshot.exists) return
        const session = snapshot.data() || {}
        if (session.activeCorrelationId !== correlationId && session.blockedByCorrelationId !== correlationId) return

        transaction.set(
            sessionRef,
            {
                sandboxId: null,
                status: 'failed',
                activeLeaseOwner: null,
                activeLeaseExpiresAt: null,
                activeCorrelationId: null,
                ...(session.blockedByCorrelationId === correlationId
                    ? { blockedByCorrelationId: null, blockedReason: null, blockedAt: null }
                    : {}),
            },
            { merge: true }
        )
    })
    return sessionRef
}

async function claimReconciliationNotification(pendingRef, now) {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(pendingRef)
        if (!snapshot.exists) return false
        const pending = snapshot.data() || {}
        if (pending.workerResultNotificationClaimedAt) return false
        transaction.set(pendingRef, { workerResultNotificationClaimedAt: now }, { merge: true })
        return true
    })
}

async function claimReconciliationLease(pendingRef, leaseOwner, now) {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(pendingRef)
        if (!snapshot.exists) return false
        const pending = snapshot.data() || {}
        if (pending.workerReconciliationState !== 'pending') return false
        if (
            pending.workerReconciliationLeaseOwner &&
            pending.workerReconciliationLeaseOwner !== leaseOwner &&
            Number(pending.workerReconciliationLeaseExpiresAt) > now
        ) {
            return false
        }
        transaction.set(
            pendingRef,
            {
                workerReconciliationLeaseOwner: leaseOwner,
                workerReconciliationLeaseExpiresAt: now + VM_WORKER_RECONCILIATION_LEASE_MS,
            },
            { merge: true }
        )
        return true
    })
}

async function finishTerminatedVmWorker(doc, pending, now) {
    const pendingRef = doc.ref
    const refundAmount = getVmRefundAmount(pending)
    if (refundAmount > 0) {
        const { refundGold } = require('../Gold/goldHelper')
        const refund = await refundGold(pending.userId, refundAmount, {
            source: VM_JOB_GOLD_REFUND_SOURCE,
            idempotencyKey: `vm_job_refund:${pending.correlationId}`,
            channel: 'assistant',
            projectId: pending.projectId,
            objectId: pending.objectId,
            objectType: pending.objectType,
            ...buildVmGoldBillingDimensions(pending),
            note: 'VM worker stopped before task settlement',
        })
        if (!refund?.success) throw new Error(refund?.message || 'VM worker Gold refund failed')
    }

    const runner = require('./vmJobRunner').__private__
    const statusCommentWritten = await runner.writeStatusComment(pending, VM_WORKER_TERMINATED_TEXT, {
        assistantRunStatus: 'failed',
        failureReason: VM_WORKER_TERMINATED_FAILURE_REASON,
    })
    if (!statusCommentWritten) throw new Error('VM worker failure status comment could not be finalized')
    await applyVmFailureWorkflowHold(admin.firestore(), pending, {
        correlationId: pending.correlationId,
        reviewerId: pending.userId,
        failureReason: VM_WORKER_TERMINATED_FAILURE_REASON,
    })
    const sessionRef = await clearTerminatedVmSession(pending)
    await runner.resolveWorkflowAfterVmJobSettlement(pendingRef, pending)
    await pendingRef.set(
        {
            workerReconciliationState: 'complete',
            workerReconciledAt: now,
            workerReconciliationLeaseOwner: null,
            workerReconciliationLeaseExpiresAt: null,
            goldRefundedAt: refundAmount > 0 ? now : null,
            goldRefunded: refundAmount,
        },
        { merge: true }
    )

    if (await claimReconciliationNotification(pendingRef, now)) {
        await runner.notifyVmResultChannels(pending, VM_WORKER_TERMINATED_TEXT, {
            pendingRef,
            notificationType: 'failed',
        })
    }

    const next = await advanceVmThreadQueue(sessionRef)
    if (next) {
        const { launchQueuedVmJob } = require('./vmJob')
        await launchQueuedVmJob(next)
    }
}

async function reconcileVmWorkerTerminations(now = Date.now()) {
    const db = admin.firestore()
    const reconciliationLeaseOwner = crypto.randomUUID()
    const [initiatedSnapshot, launchedPendingSnapshot, retrySnapshot] = await Promise.all([
        db.collection('pendingWebhooks').where('status', '==', 'initiated').limit(VM_WORKER_RECONCILIATION_LIMIT).get(),
        db.collection('pendingWebhooks').where('status', '==', 'pending').limit(VM_WORKER_RECONCILIATION_LIMIT).get(),
        db
            .collection('pendingWebhooks')
            .where('workerReconciliationState', '==', 'pending')
            .limit(VM_WORKER_RECONCILIATION_LIMIT)
            .get(),
    ])
    const result = { checked: 0, claimed: 0, reconciled: 0, running: 0, errors: 0 }
    const pendingSideEffects = new Map(retrySnapshot.docs.map(doc => [doc.id, doc]))
    const candidates = new Map([...initiatedSnapshot.docs, ...launchedPendingSnapshot.docs].map(doc => [doc.id, doc]))

    for (const doc of candidates.values()) {
        const pending = doc.data() || {}
        if (!isStaleVmWorkerCandidate(pending, now)) continue
        result.checked += 1
        try {
            const execution = await findVmCloudRunExecution(pending.correlationId || doc.id, {
                executionAttemptId: pending.executionAttemptId || '',
                minCreateTime: (Number(pending.launchRequestedAt) || Number(pending.createdAt) || now) - 60 * 1000,
            })
            const executionState = cloudRunPrivate.classifyVmCloudRunExecution(execution)
            if (!execution || !executionState.terminal) {
                result.running += 1
                continue
            }
            if (await claimTerminatedVmWorker(doc, pending, execution, executionState, now)) {
                result.claimed += 1
                pendingSideEffects.set(doc.id, doc)
            }
        } catch (error) {
            result.errors += 1
            console.warn('🖥️ VM JOB: worker termination detection failed', {
                correlationId: pending.correlationId || doc.id,
                error: error.message,
            })
        }
    }

    for (const doc of pendingSideEffects.values()) {
        try {
            const snapshot = await doc.ref.get()
            if (!snapshot.exists) continue
            const pending = { ...snapshot.data(), correlationId: snapshot.data()?.correlationId || doc.id }
            if (pending.workerReconciliationState !== 'pending') continue
            if (!(await claimReconciliationLease(doc.ref, reconciliationLeaseOwner, now))) continue
            await finishTerminatedVmWorker(doc, pending, now)
            result.reconciled += 1
        } catch (error) {
            result.errors += 1
            console.warn('🖥️ VM JOB: worker termination settlement failed; will retry', {
                correlationId: doc.id,
                error: error.message,
            })
        }
    }

    return result
}

module.exports = {
    reconcileVmWorkerTerminations,
    VM_WORKER_TERMINATED_FAILURE_REASON,
    VM_WORKER_TERMINATED_TEXT,
    __private__: {
        getVmRefundAmount,
        isExpiredVmWorkerLease,
        isStaleVmWorkerCandidate,
        claimTerminatedVmWorker,
        claimReconciliationLease,
        clearTerminatedVmSession,
        finishTerminatedVmWorker,
    },
}
