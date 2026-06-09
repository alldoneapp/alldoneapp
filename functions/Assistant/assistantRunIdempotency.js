const ASSISTANT_RUN_LOCK_LEASE_MS = 15 * 60 * 1000
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
            [
                ASSISTANT_RUN_STATUS_COMPLETED,
                ASSISTANT_RUN_STATUS_FAILED,
                ASSISTANT_RUN_STATUS_CANCELLED,
            ].includes(data.status)
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
        return (
            data.status === ASSISTANT_RUN_STATUS_CANCEL_REQUESTED ||
            data.status === ASSISTANT_RUN_STATUS_CANCELLED
        )
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

module.exports = {
    ASSISTANT_RUN_LOCK_LEASE_MS,
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
    isAssistantRunCancellationRequested,
    isAssistantRunCancelledError,
    requestCancelAssistantRunLock,
    shouldSkipExistingRun,
    throwIfAssistantRunCancelled,
}
