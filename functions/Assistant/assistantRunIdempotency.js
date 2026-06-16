const ASSISTANT_RUN_LOCK_LEASE_MS = 15 * 60 * 1000
// A live chat run can never outlast the askToBotSecondGen function timeout (540s). Any lock
// still flagged running/cancel_requested past this threshold belongs to a process that was
// killed (timeout, redeploy, crash) and left its comment spinning — the watchdog finalizes it.
const ASSISTANT_RUN_STUCK_THRESHOLD_MS = 11 * 60 * 1000
const ASSISTANT_RUN_STATUS_RUNNING = 'running'
const ASSISTANT_RUN_STATUS_CANCEL_REQUESTED = 'cancel_requested'
const ASSISTANT_RUN_STATUS_CANCELLED = 'cancelled'
const ASSISTANT_RUN_STATUS_COMPLETED = 'completed'
const ASSISTANT_RUN_STATUS_FAILED = 'failed'

class AssistantRunCancelledError extends Error {
    constructor(message = 'Assistant run cancelled.') {
        super(message)
        this.name = 'AssistantRunCancelledError'
        this.code = 'assistant_run_cancelled'
    }
}

function normalizeLockPart(value) {
    return String(value || '')
        .trim()
        .replace(/[\/\s]+/g, '_')
}

function buildAssistantRunLockId({ projectId, objectType, objectId, messageId }) {
    return [projectId, objectType || 'tasks', objectId, messageId].map(normalizeLockPart).join('__')
}

function shouldSkipExistingRun(data, now) {
    if (!data) return false
    if (data.status === ASSISTANT_RUN_STATUS_COMPLETED) return true
    if (data.status === ASSISTANT_RUN_STATUS_RUNNING && Number(data.lockExpiresAt || 0) > now) return true
    if (data.status === ASSISTANT_RUN_STATUS_CANCEL_REQUESTED && Number(data.lockExpiresAt || 0) > now) return true
    return false
}

async function acquireAssistantRunLock(db, params, nowFn = Date.now) {
    const { projectId, objectType, objectId, messageId, userId, assistantId } = params || {}
    if (!projectId || !objectId || !messageId) {
        return { acquired: true, lockRef: null, lockId: null, skipped: false }
    }

    const now = nowFn()
    const lockId = buildAssistantRunLockId({ projectId, objectType, objectId, messageId })
    const lockRef = db.doc(`assistantRunLocks/${lockId}`)
    let result = null

    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(lockRef)
        const existing = snapshot.exists ? snapshot.data() || {} : null

        if (shouldSkipExistingRun(existing, now)) {
            result = {
                acquired: false,
                skipped: true,
                lockRef,
                lockId,
                existing,
                reason: existing.status === ASSISTANT_RUN_STATUS_COMPLETED ? 'already_completed' : 'already_running',
            }
            return
        }

        transaction.set(
            lockRef,
            {
                projectId,
                objectType: objectType || 'tasks',
                objectId,
                messageId,
                userId: userId || null,
                assistantId: assistantId || null,
                status: ASSISTANT_RUN_STATUS_RUNNING,
                createdAt: existing?.createdAt || now,
                startedAt: now,
                updatedAt: now,
                lockExpiresAt: now + ASSISTANT_RUN_LOCK_LEASE_MS,
                previousStatus: existing?.status || null,
            },
            { merge: true }
        )
        result = { acquired: true, skipped: false, lockRef, lockId }
    })

    return result || { acquired: true, skipped: false, lockRef, lockId }
}

async function completeAssistantRunLock(lockRef, extra = {}, nowFn = Date.now) {
    if (!lockRef) return
    const now = nowFn()
    await lockRef
        .set(
            {
                ...extra,
                status: ASSISTANT_RUN_STATUS_COMPLETED,
                completedAt: now,
                updatedAt: now,
            },
            { merge: true }
        )
        .catch(error => {
            console.warn('Assistant run idempotency: failed marking completed', { error: error.message })
        })
}

async function failAssistantRunLock(lockRef, error, nowFn = Date.now) {
    if (!lockRef) return
    const now = nowFn()
    await lockRef
        .set(
            {
                status: ASSISTANT_RUN_STATUS_FAILED,
                failedAt: now,
                updatedAt: now,
                error: error?.message || String(error || 'Unknown assistant run failure'),
            },
            { merge: true }
        )
        .catch(markError => {
            console.warn('Assistant run idempotency: failed marking failed', { error: markError.message })
        })
}

async function requestCancelAssistantRunLock(lockRef, userId, nowFn = Date.now) {
    if (!lockRef) return { success: false, reason: 'missing_lock' }
    const now = nowFn()
    return await lockRef.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(lockRef)
        if (!snapshot.exists) return { success: false, reason: 'not_found' }
        const data = snapshot.data() || {}
        if (userId && data.userId && data.userId !== userId) {
            return { success: false, reason: 'permission_denied' }
        }
        if (
            [ASSISTANT_RUN_STATUS_COMPLETED, ASSISTANT_RUN_STATUS_FAILED, ASSISTANT_RUN_STATUS_CANCELLED].includes(
                data.status
            )
        ) {
            return { success: false, reason: 'already_settled', status: data.status }
        }
        transaction.set(
            lockRef,
            {
                status: ASSISTANT_RUN_STATUS_CANCEL_REQUESTED,
                cancelRequestedAt: now,
                cancelRequestedBy: userId || null,
                updatedAt: now,
            },
            { merge: true }
        )
        return { success: true, status: ASSISTANT_RUN_STATUS_CANCEL_REQUESTED, data }
    })
}

async function isAssistantRunCancellationRequested(lockRef) {
    if (!lockRef) return false
    try {
        const snapshot = await lockRef.get()
        const data = snapshot.exists ? snapshot.data() || {} : {}
        return data.status === ASSISTANT_RUN_STATUS_CANCEL_REQUESTED || data.status === ASSISTANT_RUN_STATUS_CANCELLED
    } catch (error) {
        console.warn('Assistant run idempotency: failed checking cancellation', { error: error.message })
        return false
    }
}

async function throwIfAssistantRunCancelled(lockRef) {
    if (await isAssistantRunCancellationRequested(lockRef)) throw new AssistantRunCancelledError()
}

async function cancelAssistantRunLock(lockRef, extra = {}, nowFn = Date.now) {
    if (!lockRef) return
    const now = nowFn()
    await lockRef
        .set(
            {
                ...extra,
                status: ASSISTANT_RUN_STATUS_CANCELLED,
                cancelledAt: now,
                updatedAt: now,
            },
            { merge: true }
        )
        .catch(error => {
            console.warn('Assistant run idempotency: failed marking cancelled', { error: error.message })
        })
}

function isAssistantRunCancelledError(error) {
    return error?.code === 'assistant_run_cancelled' || error instanceof AssistantRunCancelledError
}

// Stamp the run's comment coordinates onto the lock so a watchdog (which only has the lock
// doc) can locate and finalize the spinning comment if the run dies abnormally.
async function recordAssistantRunComment(lockRef, { projectId, objectType, objectId, commentId }, nowFn = Date.now) {
    if (!lockRef || !commentId) return
    await lockRef
        .set(
            {
                commentId,
                projectId: projectId || null,
                objectType: objectType || 'tasks',
                objectId: objectId || null,
                updatedAt: nowFn(),
            },
            { merge: true }
        )
        .catch(error => {
            console.warn('Assistant run idempotency: failed recording comment ref on lock', {
                error: error.message,
            })
        })
}

// Stop a spinning assistant comment by writing a terminal state directly. Safe to call from the
// cancel callable (instant feedback) and from the watchdog (orphaned runs). By default it only
// touches comments that are still loading, so it never clobbers a run that finished normally.
async function finalizeAssistantRunComment(db, params, nowFn = Date.now) {
    const {
        projectId,
        objectType = 'tasks',
        objectId,
        commentId,
        commentText = 'Stopped.',
        status = ASSISTANT_RUN_STATUS_CANCELLED,
        onlyIfLoading = true,
    } = params || {}
    if (!db || !projectId || !objectId || !commentId) return false
    const now = nowFn()
    const commentRef = db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
    try {
        return await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(commentRef)
            if (!snapshot.exists) return false
            const comment = snapshot.data() || {}
            // Already settled by the live loop (or a previous finalize) — don't overwrite the answer.
            if (onlyIfLoading && comment.isLoading === false) return false
            const assistantRun = comment.assistantRun || {}
            const stamp = status === ASSISTANT_RUN_STATUS_CANCELLED ? { cancelledAt: now } : { failedAt: now }
            transaction.set(
                commentRef,
                {
                    commentText,
                    isLoading: false,
                    isThinking: false,
                    assistantRun: {
                        ...assistantRun,
                        status,
                        ...stamp,
                    },
                },
                { merge: true }
            )
            return true
        })
    } catch (error) {
        console.warn('Assistant run idempotency: failed finalizing comment', { error: error.message })
        return false
    }
}

// Backstop for runs whose process died (timeout/redeploy/crash) without finalizing: their lock is
// still running/cancel_requested long past any live run could survive. Finalize the comment and
// mark the lock terminal so the chat stops showing a frozen spinner forever.
async function reconcileStuckAssistantRunLocks(db, options = {}, nowFn = Date.now) {
    const now = nowFn()
    const limit = options.limit || 100
    const thresholdMs = options.thresholdMs || ASSISTANT_RUN_STUCK_THRESHOLD_MS
    const timedOutText = options.timedOutText || 'Stopped — the assistant run ended unexpectedly (timed out).'

    // Query by the non-terminal statuses only (single-field, auto-indexed) so we never page
    // through the many long-completed locks that are kept around for duplicate-run dedup. There
    // are only ever a handful of genuinely in-flight runs, so the per-status limit is plenty.
    const [runningSnap, cancelRequestedSnap] = await Promise.all([
        db.collection('assistantRunLocks').where('status', '==', ASSISTANT_RUN_STATUS_RUNNING).limit(limit).get(),
        db
            .collection('assistantRunLocks')
            .where('status', '==', ASSISTANT_RUN_STATUS_CANCEL_REQUESTED)
            .limit(limit)
            .get(),
    ])
    const docs = [...runningSnap.docs, ...cancelRequestedSnap.docs]

    let reconciled = 0
    for (const doc of docs) {
        const data = doc.data() || {}
        // A live run can never outlast the function timeout, so only act once the run is clearly dead.
        if (Number(data.startedAt || 0) > now - thresholdMs) continue
        const wasCancelRequested = data.status === ASSISTANT_RUN_STATUS_CANCEL_REQUESTED
        if (data.status !== ASSISTANT_RUN_STATUS_RUNNING && !wasCancelRequested) continue

        const terminalStatus = wasCancelRequested ? ASSISTANT_RUN_STATUS_CANCELLED : ASSISTANT_RUN_STATUS_FAILED

        if (data.commentId && data.projectId && data.objectId) {
            await finalizeAssistantRunComment(
                db,
                {
                    projectId: data.projectId,
                    objectType: data.objectType || 'tasks',
                    objectId: data.objectId,
                    commentId: data.commentId,
                    commentText: wasCancelRequested ? 'Stopped.' : timedOutText,
                    status: wasCancelRequested ? ASSISTANT_RUN_STATUS_CANCELLED : ASSISTANT_RUN_STATUS_FAILED,
                    onlyIfLoading: true,
                },
                nowFn
            )
        }

        await doc.ref
            .set(
                {
                    status: terminalStatus,
                    updatedAt: now,
                    reconciledAt: now,
                    reconciledReason: wasCancelRequested ? 'cancel_requested_orphaned' : 'timed_out',
                },
                { merge: true }
            )
            .catch(error => {
                console.warn('Assistant run idempotency: failed reconciling lock', {
                    lockId: doc.id,
                    error: error.message,
                })
            })
        reconciled++
    }

    return { scanned: docs.length, reconciled }
}

module.exports = {
    ASSISTANT_RUN_LOCK_LEASE_MS,
    ASSISTANT_RUN_STUCK_THRESHOLD_MS,
    ASSISTANT_RUN_STATUS_RUNNING,
    ASSISTANT_RUN_STATUS_CANCEL_REQUESTED,
    ASSISTANT_RUN_STATUS_CANCELLED,
    ASSISTANT_RUN_STATUS_COMPLETED,
    ASSISTANT_RUN_STATUS_FAILED,
    AssistantRunCancelledError,
    acquireAssistantRunLock,
    buildAssistantRunLockId,
    cancelAssistantRunLock,
    completeAssistantRunLock,
    failAssistantRunLock,
    finalizeAssistantRunComment,
    isAssistantRunCancellationRequested,
    isAssistantRunCancelledError,
    recordAssistantRunComment,
    reconcileStuckAssistantRunLocks,
    requestCancelAssistantRunLock,
    shouldSkipExistingRun,
    throwIfAssistantRunCancelled,
}
