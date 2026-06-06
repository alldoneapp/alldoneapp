const ASSISTANT_RUN_LOCK_LEASE_MS = 15 * 60 * 1000

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
    if (data.status === 'completed') return true
    if (data.status === 'running' && Number(data.lockExpiresAt || 0) > now) return true
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
                reason: existing.status === 'completed' ? 'already_completed' : 'already_running',
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
                status: 'running',
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
                status: 'completed',
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
                status: 'failed',
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

module.exports = {
    ASSISTANT_RUN_LOCK_LEASE_MS,
    acquireAssistantRunLock,
    buildAssistantRunLockId,
    completeAssistantRunLock,
    failAssistantRunLock,
    shouldSkipExistingRun,
}
