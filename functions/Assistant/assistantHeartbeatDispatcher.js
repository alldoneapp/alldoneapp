const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')

const {
    HEARTBEAT_SCHEDULES_COLLECTION,
    calculateNextHeartbeatAt,
    getHeartbeatDispatchTaskId,
    getTimestampMillis,
} = require('./assistantHeartbeatSchedule')

const REGION = 'europe-west1'
const HEARTBEAT_WORKER_FUNCTION_NAME = 'runAssistantHeartbeat'
const DISPATCH_LOOKAHEAD_MS = 5 * 60 * 1000
const DISPATCH_PAGE_SIZE = 200
const MAX_DISPATCHES_PER_RUN = 1000
const ENQUEUE_CONCURRENCY = 20

function getHeartbeatWorkerQueueResource() {
    const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (() => {
            try {
                return admin.app().options.projectId
            } catch (_) {
                return undefined
            }
        })()
    return projectId
        ? `locations/${REGION}/functions/${HEARTBEAT_WORKER_FUNCTION_NAME}`
        : HEARTBEAT_WORKER_FUNCTION_NAME
}

function isTaskAlreadyExistsError(error) {
    return ['functions/task-already-exists', 'already-exists', 6].includes(error?.code)
}

async function mapWithConcurrency(values, concurrency, callback) {
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex++
            await callback(values[index], index)
        }
    })
    await Promise.all(workers)
}

async function advanceEnqueuedHeartbeatSchedule(scheduleRef, expected, now, db) {
    return await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(scheduleRef)
        if (!snapshot.exists) return false
        const current = snapshot.data() || {}
        const currentDueAt = getTimestampMillis(current.nextHeartbeatAt)
        if (current.scheduleHash !== expected.scheduleHash || currentDueAt !== expected.dueAt) return false

        const nextHeartbeatAt = calculateNextHeartbeatAt({
            afterMs: Math.max(now, expected.dueAt),
            scheduleId: scheduleRef.id,
            intervalMs: current.intervalMs,
            awakeStartMs: current.awakeStartMs,
            awakeEndMs: current.awakeEndMs,
            timezoneName: current.timezoneName || null,
            timezoneOffsetMinutes: current.timezoneOffsetMinutes || 0,
        })
        transaction.update(scheduleRef, {
            nextHeartbeatAt,
            lastEnqueuedDueAt: expected.dueAt,
            updatedAt: now,
        })
        return true
    })
}

async function enqueueHeartbeatSchedule(scheduleDoc, { db, queue, now }) {
    const schedule = scheduleDoc.data() || {}
    const dueAt = getTimestampMillis(schedule.nextHeartbeatAt)
    if (!dueAt || !schedule.scheduleHash || !schedule.projectId || !schedule.assistantId || !schedule.userId) {
        console.warn('Heartbeat dispatcher: Invalid schedule document', { scheduleId: scheduleDoc.id })
        return { status: 'invalid' }
    }

    const payload = {
        scheduleId: scheduleDoc.id,
        projectId: schedule.projectId,
        assistantId: schedule.assistantId,
        userId: schedule.userId,
        dueAt,
        scheduleHash: schedule.scheduleHash,
    }
    const taskId = getHeartbeatDispatchTaskId(scheduleDoc.id, schedule.scheduleHash, dueAt)
    let duplicate = false

    try {
        await queue.enqueue(payload, {
            id: taskId,
            scheduleTime: new Date(Math.max(Date.now(), dueAt)),
            dispatchDeadlineSeconds: 1800,
        })
    } catch (error) {
        if (!isTaskAlreadyExistsError(error)) {
            console.error('Heartbeat dispatcher: Failed to enqueue schedule', {
                scheduleId: scheduleDoc.id,
                dueAt,
                error: error.message,
                code: error.code || null,
            })
            return { status: 'failed' }
        }
        duplicate = true
    }

    const advanced = await advanceEnqueuedHeartbeatSchedule(
        scheduleDoc.ref,
        { scheduleHash: schedule.scheduleHash, dueAt },
        now,
        db
    )
    return { status: duplicate ? 'duplicate' : 'enqueued', advanced }
}

async function dispatchDueHeartbeats({
    db = admin.firestore(),
    queue = getFunctions().taskQueue(getHeartbeatWorkerQueueResource()),
    now = Date.now(),
} = {}) {
    const horizon = now + DISPATCH_LOOKAHEAD_MS
    const stats = { queried: 0, enqueued: 0, duplicate: 0, failed: 0, invalid: 0, advanced: 0 }
    let cursor = null

    while (stats.queried < MAX_DISPATCHES_PER_RUN) {
        let query = db
            .collection(HEARTBEAT_SCHEDULES_COLLECTION)
            .where('nextHeartbeatAt', '<=', horizon)
            .orderBy('nextHeartbeatAt', 'asc')
            .limit(Math.min(DISPATCH_PAGE_SIZE, MAX_DISPATCHES_PER_RUN - stats.queried))
        if (cursor) query = query.startAfter(cursor)

        const snapshot = await query.get()
        if (snapshot.empty) break
        stats.queried += snapshot.docs.length

        await mapWithConcurrency(snapshot.docs, ENQUEUE_CONCURRENCY, async scheduleDoc => {
            const result = await enqueueHeartbeatSchedule(scheduleDoc, { db, queue, now })
            stats[result.status] = (stats[result.status] || 0) + 1
            if (result.advanced) stats.advanced++
        })

        cursor = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.docs.length < DISPATCH_PAGE_SIZE) break
    }

    console.log('Heartbeat dispatcher: Completed', {
        ...stats,
        horizon,
        capped: stats.queried >= MAX_DISPATCHES_PER_RUN,
    })
    return stats
}

module.exports = {
    DISPATCH_LOOKAHEAD_MS,
    DISPATCH_PAGE_SIZE,
    MAX_DISPATCHES_PER_RUN,
    ENQUEUE_CONCURRENCY,
    getHeartbeatWorkerQueueResource,
    isTaskAlreadyExistsError,
    advanceEnqueuedHeartbeatSchedule,
    enqueueHeartbeatSchedule,
    dispatchDueHeartbeats,
}
