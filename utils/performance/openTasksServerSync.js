import { logPerformanceMeasurement, performanceNow } from './performanceLogger'

/**
 * One number for "how long until the task board matched the server" after a boot or a resume.
 *
 * `firestore_first_server_snapshot` already exists per listener, but each listener samples it
 * independently (2% for the per-project task streams), so a sampled record can never say when the
 * WHOLE board was in sync — and that is the delay a user actually waits through: the cached rows
 * paint after 250ms, while tasks finished on another device stay on screen until every open-task
 * listener has heard from the server.
 *
 * A cycle is opened explicitly (boot, or a resume long enough to rebuild the listeners). Every
 * open-task listener attached while it is open registers itself, and the cycle reports once no
 * registered listener is waiting for its first server snapshot. Projects attach progressively, so
 * "nobody is waiting" has to hold for SETTLE_MS before it counts; the reported duration is taken
 * at the moment the last listener synced, not after the settle window. Listeners attached outside
 * a cycle (ordinary navigation) cost nothing.
 */
export const OPEN_TASKS_SERVER_SYNC_TRACE = 'open_tasks_server_sync'
export const OPEN_TASKS_SERVER_SYNC_SETTLE_MS = 5000
export const OPEN_TASKS_SERVER_SYNC_TIMEOUT_MS = 3 * 60 * 1000
export const OPEN_TASKS_SERVER_SYNC_SAMPLE_RATE = 0.25

const NOOP_REGISTRATION = Object.freeze({ serverReady: () => {}, dispose: () => {} })

let cycle = null

const clearTimers = activeCycle => {
    clearTimeout(activeCycle.settleTimer)
    clearTimeout(activeCycle.timeoutTimer)
}

const finishCycle = (activeCycle, phase, outcome, durationMs) => {
    if (cycle !== activeCycle) return
    cycle = null
    clearTimers(activeCycle)
    logPerformanceMeasurement(
        OPEN_TASKS_SERVER_SYNC_TRACE,
        phase,
        durationMs,
        {
            source: activeCycle.source,
            outcome,
            watcher_count: activeCycle.readyCount,
            count: activeCycle.pending.size,
        },
        { sampleRate: OPEN_TASKS_SERVER_SYNC_SAMPLE_RATE }
    )
}

const scheduleSettle = activeCycle => {
    clearTimeout(activeCycle.settleTimer)
    if (activeCycle.pending.size > 0 || activeCycle.readyCount === 0) return
    const syncedAfterMs = activeCycle.lastReadyAt - activeCycle.startedAt
    activeCycle.settleTimer = setTimeout(
        () => finishCycle(activeCycle, 'server_synced', 'success', syncedAfterMs),
        OPEN_TASKS_SERVER_SYNC_SETTLE_MS
    )
}

/** Opens a measurement cycle. A cycle still open is replaced and reported as superseded. */
export const beginOpenTasksServerSyncCycle = source => {
    if (cycle) finishCycle(cycle, 'superseded', 'cancelled', performanceNow() - cycle.startedAt)
    const activeCycle = {
        source,
        startedAt: performanceNow(),
        lastReadyAt: null,
        pending: new Set(),
        readyCount: 0,
        settleTimer: undefined,
        timeoutTimer: undefined,
    }
    activeCycle.timeoutTimer = setTimeout(
        () => finishCycle(activeCycle, 'timeout', 'failed', OPEN_TASKS_SERVER_SYNC_TIMEOUT_MS),
        OPEN_TASKS_SERVER_SYNC_TIMEOUT_MS
    )
    cycle = activeCycle
}

/**
 * Registers one open-task listener with the open cycle, if any. `serverReady` is idempotent and
 * only the first call counts; `dispose` withdraws a listener that never synced (an unmounted
 * project must not hold the cycle open until the timeout).
 */
export const registerOpenTasksServerSyncListener = () => {
    const activeCycle = cycle
    if (!activeCycle) return NOOP_REGISTRATION

    const token = {}
    activeCycle.pending.add(token)
    clearTimeout(activeCycle.settleTimer)

    return {
        serverReady: () => {
            if (cycle !== activeCycle || !activeCycle.pending.delete(token)) return
            activeCycle.readyCount += 1
            activeCycle.lastReadyAt = performanceNow()
            scheduleSettle(activeCycle)
        },
        dispose: () => {
            if (cycle !== activeCycle || !activeCycle.pending.delete(token)) return
            scheduleSettle(activeCycle)
        },
    }
}

// Test-only reset: the cycle is module state shared by every listener.
export const __resetOpenTasksServerSyncForTests = () => {
    if (cycle) clearTimers(cycle)
    cycle = null
}
