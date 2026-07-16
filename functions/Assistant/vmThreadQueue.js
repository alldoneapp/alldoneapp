const admin = require('firebase-admin')

// Per-thread FIFO queue for VM jobs.
//
// A chat thread (task/topic) keeps a single persistent VM sandbox (see vmJobRunner.js). When a
// second `execute_task_in_vm` job is dispatched for a thread whose sandbox is still actively
// running, we do NOT spin up a throwaway isolated sandbox anymore — we queue the new job and run
// it on the SAME sandbox (resume) once the current one finishes. Jobs run sequentially, FIFO.
//
// The queue lives on the thread's `vmSessions/{projectId}__{objectId}` doc as a `queue` array of
// correlationIds (+ a `queueLength` number so the stalled-queue sweeper can query it with a plain
// single-field range and no composite index).
//
// Occupancy is tracked with the same runtime-lease fields the runner already uses
// (`activeLeaseOwner` / `activeLeaseExpiresAt` / `activeCorrelationId`). At dispatch we set a
// short-lived *dispatch lease* (owner string prefixed `dispatch:`) that covers the window between
// launching the Cloud Run execution and the runner claiming its real runtime lease (Cloud Run cold
// start + agent bootstrap). Crucially, dispatch/queue writes never touch the `status` field, so a
// paused/idle sandbox stays flagged reusable and the incoming runner still resumes it.

// The dispatch lease must comfortably exceed worst-case Cloud Run cold start + bootstrap, so the
// stalled-queue sweeper never advances the queue out from under a job that is merely still booting.
const VM_DISPATCH_LEASE_MS = 5 * 60 * 1000
const DISPATCH_LEASE_PREFIX = 'dispatch:'

function vmThreadKey(projectId, objectId) {
    return `${projectId}__${objectId}`
}

function vmThreadSessionRef(projectId, objectId) {
    return admin.firestore().doc(`vmSessions/${vmThreadKey(projectId, objectId)}`)
}

function dispatchLeaseOwner(correlationId) {
    return `${DISPATCH_LEASE_PREFIX}${correlationId}`
}

function isDispatchLeaseOwner(leaseOwner) {
    return typeof leaseOwner === 'string' && leaseOwner.startsWith(DISPATCH_LEASE_PREFIX)
}

/**
 * Decide whether a freshly-dispatched job should launch immediately or wait behind the thread's
 * currently-running/queued jobs. Atomic: either takes the dispatch lease (`launch`) or appends the
 * job to the FIFO queue (`queue`). Never touches `status` so idle-sandbox resume stays intact.
 *
 * @returns {{decision: 'launch'|'queue', position: number}} position is 1-based (0 for launch).
 */
async function admitVmJobToThread(sessionRef, correlationId, nowFn = Date.now) {
    return admin.firestore().runTransaction(async transaction => {
        const now = nowFn()
        const snapshot = await transaction.get(sessionRef)
        const session = snapshot.exists ? snapshot.data() || {} : {}
        const activeLeaseOwner = session.activeLeaseOwner || null
        const activeCorrelationId = session.activeCorrelationId || null
        const activeLeaseExpiresAt = Number(session.activeLeaseExpiresAt) || 0
        const blockedByCorrelationId = session.blockedByCorrelationId || null
        const queue = Array.isArray(session.queue) ? session.queue.slice() : []

        // Occupied if another job currently holds a live lease (runtime or dispatch), or jobs are
        // already waiting. The `queue.length` term also covers the brief window between an owner
        // releasing its runtime lease and the drain that hands the thread to the next waiter.
        const heldByOther = !!activeLeaseOwner && activeCorrelationId !== correlationId && activeLeaseExpiresAt > now
        const blockedByOther = !!blockedByCorrelationId && blockedByCorrelationId !== correlationId
        const occupied = heldByOther || blockedByOther || queue.length > 0

        if (occupied) {
            if (!queue.includes(correlationId)) queue.push(correlationId)
            transaction.set(sessionRef, { queue, queueLength: queue.length }, { merge: true })
            return { decision: 'queue', position: queue.indexOf(correlationId) + 1 }
        }

        transaction.set(
            sessionRef,
            {
                activeLeaseOwner: dispatchLeaseOwner(correlationId),
                activeLeaseExpiresAt: now + VM_DISPATCH_LEASE_MS,
                activeCorrelationId: correlationId,
            },
            { merge: true }
        )
        return { decision: 'launch', position: 0 }
    })
}

/**
 * Read-only peek: is the thread currently occupied (running or with jobs queued)? Used to decide
 * whether to skip the cross-thread concurrency cap for a same-thread follow-up. Best-effort — the
 * authoritative decision is the `admitVmJobToThread` transaction.
 */
async function isVmThreadOccupied(sessionRef, correlationId = null, nowFn = Date.now) {
    const snapshot = await sessionRef.get()
    if (!snapshot.exists) return false
    const session = snapshot.data() || {}
    const now = nowFn()
    const activeLeaseOwner = session.activeLeaseOwner || null
    const activeCorrelationId = session.activeCorrelationId || null
    const activeLeaseExpiresAt = Number(session.activeLeaseExpiresAt) || 0
    const blockedByCorrelationId = session.blockedByCorrelationId || null
    const queue = Array.isArray(session.queue) ? session.queue : []
    const heldByOther = !!activeLeaseOwner && activeCorrelationId !== correlationId && activeLeaseExpiresAt > now
    const blockedByOther = !!blockedByCorrelationId && blockedByCorrelationId !== correlationId
    return heldByOther || blockedByOther || queue.length > 0
}

/**
 * Pop the next queued job for the thread and hand it the dispatch lease so the incoming runner can
 * claim it. Called when the current owner finishes (drain-next). When the queue is empty it clears
 * any lingering dispatch lease so the thread is free for a fresh dispatch. Never touches `status`,
 * so the next runner still resumes the kept-alive/paused sandbox.
 *
 * @returns {Promise<string|null>} the next correlationId to launch, or null if none.
 */
async function advanceVmThreadQueue(sessionRef, nowFn = Date.now) {
    return admin.firestore().runTransaction(async transaction => {
        const now = nowFn()
        const snapshot = await transaction.get(sessionRef)
        if (!snapshot.exists) return null
        const session = snapshot.data() || {}
        const queue = Array.isArray(session.queue) ? session.queue.slice() : []

        // A job waiting for a plan decision, clarification, or approval still owns the logical
        // thread even though its runtime lease is intentionally released while E2B is paused.
        // Never hand the sandbox to a queued follow-up until that interaction settles.
        if (session.blockedByCorrelationId) return null

        if (queue.length === 0) {
            const updates = { queueLength: 0 }
            // Release a lingering dispatch lease (e.g. a launch/credential/cancel path that held the
            // thread without a runner ever claiming a runtime lease) so the thread is not wedged.
            if (isDispatchLeaseOwner(session.activeLeaseOwner)) {
                updates.activeLeaseOwner = null
                updates.activeLeaseExpiresAt = null
                updates.activeCorrelationId = null
            }
            transaction.set(sessionRef, updates, { merge: true })
            return null
        }

        const next = queue.shift()
        transaction.set(
            sessionRef,
            {
                queue,
                queueLength: queue.length,
                activeLeaseOwner: dispatchLeaseOwner(next),
                activeLeaseExpiresAt: now + VM_DISPATCH_LEASE_MS,
                activeCorrelationId: next,
            },
            { merge: true }
        )
        return next
    })
}

async function blockVmThreadForInteraction(sessionRef, correlationId, reason, nowFn = Date.now) {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(sessionRef)
        const session = snapshot.exists ? snapshot.data() || {} : {}
        const existing = session.blockedByCorrelationId || null
        if (existing && existing !== correlationId) return false
        transaction.set(
            sessionRef,
            {
                blockedByCorrelationId: correlationId,
                blockedReason: reason || 'awaiting_user',
                blockedAt: nowFn(),
                activeLeaseOwner: null,
                activeLeaseExpiresAt: null,
                activeCorrelationId: correlationId,
            },
            { merge: true }
        )
        return true
    })
}

async function unblockVmThreadInteraction(sessionRef, correlationId) {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(sessionRef)
        if (!snapshot.exists) return false
        const session = snapshot.data() || {}
        if (session.blockedByCorrelationId !== correlationId) return false
        transaction.set(
            sessionRef,
            {
                blockedByCorrelationId: null,
                blockedReason: null,
                blockedAt: null,
            },
            { merge: true }
        )
        return true
    })
}

/**
 * Remove a job from the thread's waiting queue (used when a queued job is cancelled).
 * @returns {Promise<boolean>} true if the job was present and removed.
 */
async function removeQueuedVmJobFromThread(sessionRef, correlationId) {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(sessionRef)
        if (!snapshot.exists) return false
        const session = snapshot.data() || {}
        const queue = Array.isArray(session.queue) ? session.queue : []
        if (!queue.includes(correlationId)) return false
        const filtered = queue.filter(id => id !== correlationId)
        transaction.set(sessionRef, { queue: filtered, queueLength: filtered.length }, { merge: true })
        return true
    })
}

/**
 * Put a job back at the FRONT of the thread queue. Used by the runner when it starts but finds the
 * thread's sandbox held by another live job (the rare dispatch/claim race): rather than run on a
 * throwaway isolated sandbox, the job re-queues and the current owner relaunches it on drain.
 * @returns {Promise<number>} the resulting queue length.
 */
async function requeueVmJobToThreadFront(sessionRef, correlationId) {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(sessionRef)
        const session = snapshot.exists ? snapshot.data() || {} : {}
        const queue = Array.isArray(session.queue) ? session.queue.filter(id => id !== correlationId) : []
        queue.unshift(correlationId)
        transaction.set(sessionRef, { queue, queueLength: queue.length }, { merge: true })
        return queue.length
    })
}

/**
 * Release the dispatch lease a job took at dispatch, if it still holds it, and advance the queue.
 * Used when a launch fails definitively so the thread is not wedged behind a job that never ran.
 */
async function releaseVmThreadDispatchLease(sessionRef, correlationId) {
    await admin
        .firestore()
        .runTransaction(async transaction => {
            const snapshot = await transaction.get(sessionRef)
            if (!snapshot.exists) return
            const session = snapshot.data() || {}
            if (session.activeCorrelationId !== correlationId) return
            if (!isDispatchLeaseOwner(session.activeLeaseOwner)) return
            transaction.set(
                sessionRef,
                { activeLeaseOwner: null, activeLeaseExpiresAt: null, activeCorrelationId: null },
                { merge: true }
            )
        })
        .catch(() => {})
}

/**
 * Scheduled sweeper: advance thread queues whose current owner died without draining (Cloud Run
 * OOM/infra kill), detected by an expired lease with jobs still waiting. Also relaunches a job that
 * a drain popped but whose launch never confirmed (its dispatch lease expires and it is still the
 * owner with waiters behind it).
 */
async function drainStalledVmThreadQueues(nowFn = Date.now) {
    const db = admin.firestore()
    const now = nowFn()
    const snap = await db.collection('vmSessions').where('queueLength', '>', 0).get()
    const result = { checked: 0, advanced: 0, launched: 0, errors: 0 }
    // Lazy require to avoid a load-time cycle (vmJob → vmThreadQueue).
    const { launchQueuedVmJob } = require('./vmJob')
    for (const doc of snap.docs) {
        const session = doc.data() || {}
        result.checked += 1
        if (session.blockedByCorrelationId) continue
        const leaseLive = !!session.activeLeaseOwner && Number(session.activeLeaseExpiresAt) > now
        // Owner alive or still within its boot window → it will drain when it finishes. Skip.
        if (leaseLive) continue
        try {
            const next = await advanceVmThreadQueue(doc.ref, nowFn)
            if (!next) continue
            result.advanced += 1
            const launch = await launchQueuedVmJob(next)
            if (launch && launch.success) result.launched += 1
        } catch (error) {
            result.errors += 1
            console.warn('🖥️ VM JOB: stalled-queue drain failed', {
                thread: doc.id,
                error: error.message,
            })
        }
    }
    return result
}

module.exports = {
    VM_DISPATCH_LEASE_MS,
    DISPATCH_LEASE_PREFIX,
    vmThreadKey,
    vmThreadSessionRef,
    dispatchLeaseOwner,
    isDispatchLeaseOwner,
    admitVmJobToThread,
    isVmThreadOccupied,
    advanceVmThreadQueue,
    removeQueuedVmJobFromThread,
    requeueVmJobToThreadFront,
    blockVmThreadForInteraction,
    unblockVmThreadInteraction,
    releaseVmThreadDispatchLease,
    drainStalledVmThreadQueues,
}
