const admin = require('firebase-admin')
const { buildVmGoldBillingDimensions } = require('./vmGoldDimensions')
const crypto = require('crypto')
const { VM_JOB_GOLD_REFUND_SOURCE } = require('./vmJob')
const { applyVmFailureWorkflowHold } = require('./vmWorkflowHold')
const { vmThreadSessionRef, advanceVmThreadQueue } = require('./vmThreadQueue')
const {
    findVmCloudRunExecution,
    getVmCloudRunExecution,
    __private__: cloudRunPrivate,
} = require('./vmCloudRunLauncher')
const { VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS } = require('./vmJobConfig')

const VM_WORKER_TERMINATED_FAILURE_REASON = 'worker_terminated'
const VM_WORKER_RECONCILIATION_GRACE_MS = 30 * 1000
const VM_WORKER_RECONCILIATION_LIMIT = 100
const VM_WORKER_RECONCILIATION_LEASE_MS = 5 * 60 * 1000
const VM_WORKER_TERMINATED_TEXT =
    '❌ The VM worker stopped unexpectedly before it could finish. Any Gold charged for this run has been refunded. Please retry the task.'
// Same status/text the runner itself settles a cancelled job with (vmJobRunner.js).
const VM_JOB_CANCEL_REQUESTED_STATUS = 'cancel_requested'
const VM_JOB_CANCELLED_STATUS = 'cancelled'
const VM_JOB_CANCELLED_TEXT = 'Stopped.'
// A live runner notices a cancel within seconds; give it room before looking at Cloud Run at all.
const VM_CANCEL_SETTLEMENT_GRACE_MS = 2 * 60 * 1000
// Past its own task timeout Cloud Run has killed the execution, so "not found" then means "gone".
const VM_CLOUD_RUN_TASK_TIMEOUT_MS = VM_CLOUD_RUN_TASK_TIMEOUT_SECONDS * 1000

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

// AT-2916: cancelAssistantRunSecondGen flips the job to cancel_requested AND cancels the Cloud Run
// execution directly. The runner is the only thing that settles a cancel_requested job, so when the
// execution is killed before the runner gets there (e.g. a stop pressed during sandbox start-up),
// nothing ever settles it: the job stays "Wird gestoppt…" in the Anna VM overview forever, keeps its
// 20-Gold base reserve and outlives the newer runs on the same thread. Note an expired lease is no
// proof of death here — the heartbeat only renews while status is 'initiated' — so this only
// selects candidates; a terminal Cloud Run execution is still required before settling.
function isOrphanedCancelCandidate(pending = {}, now = Date.now()) {
    if (pending.kind !== 'vm_job' || pending.status !== VM_JOB_CANCEL_REQUESTED_STATUS) return false
    if (pending.launchState !== 'launched') return false
    const cancelRequestedAt = Number(pending.cancelRequestedAt) || 0
    if (!cancelRequestedAt || cancelRequestedAt + VM_CANCEL_SETTLEMENT_GRACE_MS > now) return false
    const leaseExpiresAt = Number(pending.leaseExpiresAt) || 0
    return !leaseExpiresAt || leaseExpiresAt + VM_WORKER_RECONCILIATION_GRACE_MS <= now
}

function isStaleVmWorkerCandidate(pending = {}, now = Date.now()) {
    if (isExpiredVmWorkerLease(pending, now)) return true
    if (isOrphanedCancelCandidate(pending, now)) return true
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

        if (latest.status === VM_JOB_CANCEL_REQUESTED_STATUS) {
            // The user asked for exactly this; settle it the way the runner would have.
            transaction.set(
                doc.ref,
                {
                    status: VM_JOB_CANCELLED_STATUS,
                    cancelledAt: now,
                    workerReconciliationState: 'pending',
                    workerReconciliationClaimedAt: now,
                    workerReconciliationOutcome: 'cancelled',
                    workerExecutionOutcome: executionState.outcome,
                    workerExecutionReason: executionState.reason || null,
                    cloudRunExecution: execution?.name || latest.cloudRunExecution || null,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                },
                { merge: true }
            )
            return true
        }

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
                cloudRunExecution: execution?.name || latest.cloudRunExecution || null,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
            { merge: true }
        )
        return true
    })
}

// Releases the thread if this job still holds it. Also answers whether the caller may advance the
// thread queue: only when this job held the thread or nobody does. A settled job whose thread has
// since been taken over by a NEWER run (AT-2916: a cancel orphaned for hours while the user kept
// working in that task) must not touch it — advanceVmThreadQueue does not check ownership, and would
// hand the sandbox to a queued follow-up over the live run or drop that run's dispatch lease.
async function clearTerminatedVmSession(pending) {
    const correlationId = pending.correlationId
    const sessionRef = vmThreadSessionRef(pending.projectId, pending.objectId)
    let mayAdvanceQueue = false
    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(sessionRef)
        if (!snapshot.exists) return
        const session = snapshot.data() || {}
        if (session.activeCorrelationId !== correlationId && session.blockedByCorrelationId !== correlationId) {
            mayAdvanceQueue = !session.activeCorrelationId && !session.blockedByCorrelationId
            return
        }
        mayAdvanceQueue = true

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
    return { sessionRef, mayAdvanceQueue }
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

// Mirrors the runner's own cancel settlement (vmJobRunner.js, "cancel_requested" branches): only the
// base reserve is refunded — runtime minutes and tokens actually used stay charged — under the same
// idempotency key, so a runner that did get there first cannot be refunded twice. The comment goes
// through writeStatusComment, which also applies the AT-2196 reviewer hold for a cancelled run. No
// result notification: the user asked for this stop themselves.
async function finishOrphanedCancel(doc, pending, now) {
    const pendingRef = doc.ref
    const refundAmount = Number(pending.goldCharged) || 0
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
            note: 'VM task stopped',
        })
        if (!refund?.success) throw new Error(refund?.message || 'VM cancel Gold refund failed')
    }

    const runner = require('./vmJobRunner').__private__
    const statusCommentWritten = await runner.writeStatusComment(pending, VM_JOB_CANCELLED_TEXT, {
        assistantRunStatus: VM_JOB_CANCELLED_STATUS,
    })
    if (!statusCommentWritten) throw new Error('VM cancel status comment could not be finalized')
    const { sessionRef, mayAdvanceQueue } = await clearTerminatedVmSession(pending)
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

    const next = mayAdvanceQueue ? await advanceVmThreadQueue(sessionRef) : null
    if (next) {
        const { launchQueuedVmJob } = require('./vmJob')
        await launchQueuedVmJob(next)
    }
}

async function finishTerminatedVmWorker(doc, pending, now) {
    if (pending.workerReconciliationOutcome === 'cancelled') return finishOrphanedCancel(doc, pending, now)
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
    const { sessionRef, mayAdvanceQueue } = await clearTerminatedVmSession(pending)
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

    const next = mayAdvanceQueue ? await advanceVmThreadQueue(sessionRef) : null
    if (next) {
        const { launchQueuedVmJob } = require('./vmJob')
        await launchQueuedVmJob(next)
    }
}

// Which Cloud Run execution belongs to this attempt, and is it over? The paged lookup is the original
// path. An orphaned cancel additionally falls back to the execution name stored at launch (the paged
// list stops after a few hundred executions, so a cancel from hours ago can fall off it), accepted
// only when it carries this job's correlation and attempt ids. And because Cloud Run kills any
// execution at its task timeout, an execution that cannot be found long after that is gone too.
async function resolveWorkerExecutionState(pending, docId, now) {
    const correlationId = pending.correlationId || docId
    const executionAttemptId = pending.executionAttemptId || ''
    let execution = await findVmCloudRunExecution(correlationId, {
        executionAttemptId,
        minCreateTime: (Number(pending.launchRequestedAt) || Number(pending.createdAt) || now) - 60 * 1000,
    })
    const orphanedCancel = pending.status === VM_JOB_CANCEL_REQUESTED_STATUS
    if (!execution && orphanedCancel && pending.cloudRunExecution) {
        const stored = await getVmCloudRunExecution(pending.cloudRunExecution)
        if (
            stored &&
            cloudRunPrivate.executionHasCorrelationId(stored, correlationId) &&
            cloudRunPrivate.executionHasAttemptId(stored, executionAttemptId)
        )
            execution = stored
    }
    if (execution) return { execution, executionState: cloudRunPrivate.classifyVmCloudRunExecution(execution) }

    const lastLaunchAt =
        Math.max(Number(pending.launchedAt) || 0, Number(pending.launchRequestedAt) || 0) ||
        Number(pending.createdAt) ||
        0
    const outlivedTaskTimeout =
        orphanedCancel &&
        lastLaunchAt > 0 &&
        lastLaunchAt + VM_CLOUD_RUN_TASK_TIMEOUT_MS + VM_CANCEL_SETTLEMENT_GRACE_MS <= now
    return {
        execution: null,
        executionState: outlivedTaskTimeout
            ? { terminal: true, outcome: 'not_found', message: 'Cloud Run execution no longer exists' }
            : { terminal: false, outcome: 'unknown', message: '' },
    }
}

async function reconcileVmWorkerTerminations(now = Date.now()) {
    const db = admin.firestore()
    const reconciliationLeaseOwner = crypto.randomUUID()
    const [initiatedSnapshot, launchedPendingSnapshot, cancelRequestedSnapshot, retrySnapshot] = await Promise.all([
        db.collection('pendingWebhooks').where('status', '==', 'initiated').limit(VM_WORKER_RECONCILIATION_LIMIT).get(),
        db.collection('pendingWebhooks').where('status', '==', 'pending').limit(VM_WORKER_RECONCILIATION_LIMIT).get(),
        db
            .collection('pendingWebhooks')
            .where('status', '==', VM_JOB_CANCEL_REQUESTED_STATUS)
            .limit(VM_WORKER_RECONCILIATION_LIMIT)
            .get(),
        db
            .collection('pendingWebhooks')
            .where('workerReconciliationState', '==', 'pending')
            .limit(VM_WORKER_RECONCILIATION_LIMIT)
            .get(),
    ])
    const result = { checked: 0, claimed: 0, reconciled: 0, running: 0, errors: 0 }
    const pendingSideEffects = new Map(retrySnapshot.docs.map(doc => [doc.id, doc]))
    const candidates = new Map(
        [...initiatedSnapshot.docs, ...launchedPendingSnapshot.docs, ...cancelRequestedSnapshot.docs].map(doc => [
            doc.id,
            doc,
        ])
    )

    for (const doc of candidates.values()) {
        const pending = doc.data() || {}
        if (!isStaleVmWorkerCandidate(pending, now)) continue
        result.checked += 1
        try {
            const { execution, executionState } = await resolveWorkerExecutionState(pending, doc.id, now)
            if (!executionState.terminal) {
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
        isOrphanedCancelCandidate,
        resolveWorkerExecutionState,
        claimTerminatedVmWorker,
        claimReconciliationLease,
        clearTerminatedVmSession,
        finishTerminatedVmWorker,
    },
}
