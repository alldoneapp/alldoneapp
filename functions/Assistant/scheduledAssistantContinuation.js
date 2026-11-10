const { createHash } = require('crypto')

const ATTEMPT_LEASE_MS = 30 * 60 * 1000

function scheduledPromptHash(task, executionProjectId) {
    return createHash('sha256')
        .update(JSON.stringify([task.prompt || '', executionProjectId, task.aiSystemMessage || '']))
        .digest('hex')
}

function hasActiveAttempt(execution, now = Date.now()) {
    return execution?.status === 'in_progress' && (!execution.leaseExpiresAt || execution.leaseExpiresAt > now)
}

function readLastExecuted(task, userId) {
    return task?.lastExecutedByUser?.[userId] ?? task?.lastExecuted ?? null
}

// The scan queues an occurrence by moving lastExecuted forward, so the next five-minute scan does
// not queue it again. It does so only if lastExecuted is still what the scan read: two overlapping
// scans (a Cloud Scheduler redelivery) cannot both queue the same occurrence. Returns the value it
// wrote, which the run's claim must then expect; null when another scan got there first.
async function reserveScheduledOccurrence({ taskRef, userId, task, now = Date.now() }) {
    return taskRef.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) return null
        if (readLastExecuted(snapshot.data(), userId) !== readLastExecuted(task, userId)) return null
        transaction.update(taskRef, { lastExecuted: now, [`lastExecutedByUser.${userId}`]: now })
        return now
    })
}

// Reserve the thread ID before creating its documents. Duplicate scheduler deliveries
// cannot execute the same occurrence, and a crashed attempt can reclaim the same thread.
//
// expectedLastExecuted is the value reserveScheduledOccurrence wrote. Without it the claim compares
// against the scanned snapshot, which the scan's own reservation has already moved on from, so every
// queued run refused itself and returned without a trace (2026-11-10, "Daily growth discovery").
async function claimScheduledPromptAttempt({
    taskRef,
    userId,
    task,
    executionProjectId,
    newTaskId,
    expectedLastExecuted,
    now = Date.now(),
}) {
    return taskRef.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        if (!snapshot.exists) return null
        const current = snapshot.data()
        if (scheduledPromptHash(current, executionProjectId) !== scheduledPromptHash(task, executionProjectId))
            return null
        const previous = current.executionByUser?.[userId] || {}
        if (hasActiveAttempt(previous, now)) return null
        const expected = expectedLastExecuted !== undefined ? expectedLastExecuted : readLastExecuted(task, userId)
        if (readLastExecuted(current, userId) !== expected) return null
        const promptHash = scheduledPromptHash(task, executionProjectId)
        const resume =
            ['failed', 'in_progress'].includes(previous.status) &&
            previous.taskId &&
            previous.promptHash === promptHash &&
            previous.executionProjectId === executionProjectId &&
            previous.retryExhausted !== true
        const attempt = {
            status: 'in_progress',
            startedAt: now,
            completedAt: null,
            error: null,
            leaseExpiresAt: now + ATTEMPT_LEASE_MS,
            taskId: resume ? previous.taskId : newTaskId,
            executionProjectId,
            promptHash,
            attempts: resume ? (previous.attempts || 1) + 1 : 1,
            stalledAttempts: resume ? previous.stalledAttempts || 0 : 0,
            progressSignature: resume ? previous.progressSignature || '' : '',
        }
        transaction.update(taskRef, {
            executionStatus: 'in_progress',
            lastExecutionError: null,
            lastExecutionStarted: now,
            lastExecutionCompleted: null,
            [`executionByUser.${userId}`]: attempt,
        })
        return { ...attempt, resume: !!resume }
    })
}

function failedScheduledAttempt(attempt, error, progressSignature, now = Date.now()) {
    const stalledAttempts =
        progressSignature && progressSignature !== attempt.progressSignature ? 0 : attempt.stalledAttempts + 1
    const { resume, ...stored } = attempt
    return {
        ...stored,
        status: 'failed',
        error: error.message,
        completedAt: now,
        leaseExpiresAt: 0,
        progressSignature,
        stalledAttempts,
        retryExhausted: stalledAttempts >= 3,
    }
}

async function updateScheduledAttempt(taskRef, userId, attempt, update) {
    return taskRef.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(taskRef)
        const current = snapshot.data()?.executionByUser?.[userId]
        if (current?.startedAt !== attempt.startedAt || current?.taskId !== attempt.taskId) return false
        transaction.update(taskRef, update)
        return true
    })
}

module.exports = {
    scheduledPromptHash,
    hasActiveAttempt,
    reserveScheduledOccurrence,
    claimScheduledPromptAttempt,
    failedScheduledAttempt,
    updateScheduledAttempt,
}
