import {
    getConnectionHealth,
    isManualOfflineMode,
    markServerContact,
    recoverStalledTaskWrites,
    startConnectionLatencySample,
    subscribeConnectionHealth,
} from '../connectionHealth'
import { isBrowserOffline } from '../connectionState'
import { subscribePageVisible } from '../appResume'
import { logPerformanceMeasurement } from '../performance/performanceLogger'

// Try one early recovery; the separate cooldown gives slow queues time to drain
// instead of repeatedly tearing down the transport every ten seconds.
export const TASK_WRITE_RECOVERY_AFTER_MS = 10000
export const TASK_WRITE_RECOVERY_COOLDOWN_MS = 60000
export const TASK_WRITE_MARKER_PREFIX = 'alldone.pendingTaskWrite.v1:'
export const TASK_WRITE_DIAGNOSTICS_KEY = 'alldone.taskWriteDiagnostics.v1'
const CHECK_INTERVAL_MS = 5000

const browserStorage = () => {
    try {
        return window.localStorage
    } catch (_) {
        return null
    }
}

const markerKey = ({ userId, taskId }) =>
    `${TASK_WRITE_MARKER_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(taskId)}`

// Only timings/counts go into the diagnostic journal and consent-gated analytics.
// The separate pending markers contain identifiers, never task contents or writes.
const recordDiagnostic = (storage, phase, durationMs, pendingCount, source) => {
    const entry = { at: Date.now(), phase, durationMs, pendingCount, source }
    try {
        const previous = JSON.parse(storage?.getItem(TASK_WRITE_DIAGNOSTICS_KEY) || '[]')
        storage?.setItem(
            TASK_WRITE_DIAGNOSTICS_KEY,
            JSON.stringify([...(Array.isArray(previous) ? previous : []), entry].slice(-50))
        )
    } catch (_) {}
    logPerformanceMeasurement(
        'task_write',
        phase,
        durationMs,
        { source, write_count: pendingCount },
        { sampleRate: durationMs >= TASK_WRITE_RECOVERY_AFTER_MS ? 1 : 0.1 }
    )
}

/**
 * Watch the actual write acknowledgement, independently of read-side health.
 * Firestore owns persistence and retries; this module NEVER replays a write or
 * clears its cache. A restored marker is settled with waitForPendingWrites(),
 * so reopening observes the SDK's existing queue without creating a duplicate.
 */
export const createTaskWriteMonitor = ({
    db,
    storage = browserStorage(),
    now = Date.now,
    isOffline = isBrowserOffline,
    isManualOffline = isManualOfflineMode,
    isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    getHealth = getConnectionHealth,
    startLatencySample = startConnectionLatencySample,
    markContact = markServerContact,
    recover = recoverStalledTaskWrites,
    subscribeHealth = subscribeConnectionHealth,
    subscribeVisible = subscribePageVisible,
    record = (phase, durationMs, count, source) => recordDiagnostic(storage, phase, durationMs, count, source),
} = {}) => {
    let userId = null
    let generation = 0
    let stopped = false
    let interval
    let recoveryInFlight = null
    let drainInFlight = null
    let lastRecoveryAt = null
    let lastProgressAt = null
    const pending = new Map()

    const persist = entry => {
        try {
            storage?.setItem(
                markerKey(entry),
                JSON.stringify({
                    userId: entry.userId,
                    taskId: entry.taskId,
                    startedAt: entry.startedAt,
                    lastRecoveryAt: entry.lastRecoveryAt,
                })
            )
        } catch (_) {}
    }
    const report = (phase, entry, source = 'task_create') => {
        try {
            record(phase, Math.max(0, now() - entry.startedAt), pending.size, source)
        } catch (_) {
            // Diagnostics must never change write completion or recovery.
        }
    }
    const stopSample = entry => {
        entry.finishLatency?.()
        entry.finishLatency = null
    }
    const startSample = entry => {
        if (!entry.finishLatency && !isOffline() && !isManualOffline() && ['live', 'slow'].includes(getHealth())) {
            entry.finishLatency = startLatencySample('task_create_ack')
        }
    }
    const settle = (entry, phase, source) => {
        try {
            storage?.removeItem(markerKey(entry))
        } catch (_) {}
        if (pending.get(entry.taskId) !== entry) return
        pending.delete(entry.taskId)
        stopSample(entry)
        lastProgressAt = now()
        report(phase, entry, source)
        if (phase === 'server_acked') markContact('task_write_ack')
        if (!pending.size) {
            clearInterval(interval)
            interval = undefined
        }
    }

    const observeRestoredQueue = () => {
        const restored = [...pending.values()].filter(entry => entry.restored)
        if (!restored.length || drainInFlight || typeof db?.waitForPendingWrites !== 'function') return
        const activeGeneration = generation
        // Invoke immediately: the checkpoint must cover the queue at restore,
        // not writes another account might issue after an auth transition.
        let checkpoint
        try {
            checkpoint = db.waitForPendingWrites()
        } catch (error) {
            report('checkpoint_failed', restored[0], 'restored_queue')
            return
        }
        const drain = Promise.resolve(checkpoint).then(
            () => {
                if (stopped || generation !== activeGeneration) return
                // Queue drained can include a rejected write whose page was
                // closed. Do not misreport individual task creation as success.
                restored.forEach(entry => settle(entry, 'queue_drained', 'restored_queue'))
            },
            () => {
                if (!stopped && generation === activeGeneration)
                    report('checkpoint_failed', restored[0], 'restored_queue')
            }
        )
        drainInFlight = drain
        void drain.finally(() => {
            if (drainInFlight === drain) drainInFlight = null
        })
    }

    const check = () => {
        if (stopped || !pending.size) return
        observeRestoredQueue()
        if (isHidden() || isOffline() || isManualOffline()) return
        pending.forEach(startSample)
        const at = now()
        const oldest = [...pending.values()].reduce((a, b) => (a.startedAt < b.startedAt ? a : b))
        if (
            recoveryInFlight ||
            at - oldest.startedAt < TASK_WRITE_RECOVERY_AFTER_MS ||
            at < oldest.recoveryEligibleAt ||
            (lastProgressAt !== null && at - lastProgressAt < TASK_WRITE_RECOVERY_AFTER_MS) ||
            (lastRecoveryAt !== null && at - lastRecoveryAt < TASK_WRITE_RECOVERY_COOLDOWN_MS)
        )
            return

        lastRecoveryAt = at
        pending.forEach(entry => {
            entry.lastRecoveryAt = at
            persist(entry)
        })
        report('recovery_started', oldest)
        const activeGeneration = generation
        const recovery = Promise.resolve().then(() => {
            if (stopped || generation !== activeGeneration || !pending.size || isOffline() || isManualOffline())
                return 'cancelled'
            return recover()
        })
        recoveryInFlight = recovery
        void recovery
            .then(
                outcome => {
                    if (!stopped && generation === activeGeneration && pending.size)
                        report(
                            outcome === 'cancelled'
                                ? 'recovery_cancelled'
                                : outcome
                                  ? 'recovery_finished'
                                  : 'recovery_failed',
                            oldest
                        )
                },
                () => {
                    if (!stopped && generation === activeGeneration && pending.size) report('recovery_failed', oldest)
                }
            )
            .finally(() => {
                if (recoveryInFlight === recovery) recoveryInFlight = null
            })
    }
    const arm = () => {
        pending.forEach(startSample)
        if (pending.size && interval === undefined) interval = setInterval(check, CHECK_INTERVAL_MS)
    }
    const clearActive = () => {
        generation++
        pending.forEach(stopSample)
        pending.clear()
        clearInterval(interval)
        interval = undefined
        drainInFlight = null
        lastProgressAt = null
        lastRecoveryAt = null
    }
    const unsubscribeVisible = subscribeVisible(check)
    const unsubscribeHealth = subscribeHealth(health => {
        if (!['live', 'slow'].includes(health)) pending.forEach(stopSample)
        else arm()
    })

    return {
        setUser(nextUserId) {
            if (stopped || nextUserId === userId) return
            clearActive()
            userId = nextUserId || null
            if (!userId) return
            const prefix = `${TASK_WRITE_MARKER_PREFIX}${encodeURIComponent(userId)}:`
            try {
                for (let index = 0; index < storage?.length; index++) {
                    const key = storage.key(index)
                    if (!key?.startsWith(prefix)) continue
                    let entry
                    try {
                        entry = JSON.parse(storage.getItem(key))
                    } catch (_) {
                        continue
                    }
                    if (
                        entry?.userId !== userId ||
                        typeof entry.taskId !== 'string' ||
                        !entry.taskId ||
                        !Number.isFinite(entry.startedAt) ||
                        markerKey(entry) !== key
                    )
                        continue
                    entry.startedAt = Math.min(entry.startedAt, now())
                    entry.restored = true
                    // Give an already-drained queue a chance to settle at boot.
                    entry.recoveryEligibleAt = now() + CHECK_INTERVAL_MS
                    if (Number.isFinite(entry.lastRecoveryAt)) {
                        entry.lastRecoveryAt = Math.min(entry.lastRecoveryAt, now())
                        lastRecoveryAt = Math.max(lastRecoveryAt || 0, entry.lastRecoveryAt)
                    }
                    pending.set(entry.taskId, entry)
                    report('restored', entry, 'restored_queue')
                }
            } catch (_) {}
            observeRestoredQueue()
            arm()
        },
        track(write, { userId: ownerId, taskId }) {
            if (stopped || !ownerId || ownerId !== userId || !taskId) return write
            const entry = { userId: ownerId, taskId, startedAt: now(), recoveryEligibleAt: now() }
            pending.set(taskId, entry)
            persist(entry)
            arm()
            Promise.resolve(write).then(
                () => settle(entry, 'server_acked'),
                () => settle(entry, 'rejected')
            )
            return write
        },
        stop() {
            stopped = true
            clearActive()
            unsubscribeVisible()
            unsubscribeHealth()
        },
    }
}

let activeMonitor = null

export const installTaskWriteMonitor = (db, auth) => {
    if (activeMonitor) return () => {}
    const monitor = createTaskWriteMonitor({ db })
    activeMonitor = monitor
    monitor.setUser(auth.currentUser?.uid)
    const unsubscribeAuth = auth.onAuthStateChanged(user => monitor.setUser(user?.uid))
    return () => {
        unsubscribeAuth()
        monitor.stop()
        if (activeMonitor === monitor) activeMonitor = null
    }
}

export const trackTaskWrite = (write, details) => activeMonitor?.track(write, details) || write
