/**
 * Firestore IndexedDB persistence (OFFLINE_SUPPORT_PLAN.md, Stage 3).
 *
 * Called once from initFirebase, right after db.settings() and before any other
 * Firestore call — the compat SDK requires enablePersistence to be the first
 * operation, and queues every call made after it behind the enable, which is why
 * the caller must NOT await this (a slow IndexedDB open would delay boot for
 * nothing; the SDK serializes correctness itself).
 *
 * synchronizeTabs matters: users keep several Alldone tabs open, and without it
 * the second tab would fail persistence entirely ('failed-precondition').
 *
 * Every failure path degrades to exactly the pre-Stage-3 behavior (in-memory
 * cache only) and must never block or crash boot:
 * - 'failed-precondition': another tab owns persistence without synchronizeTabs
 *   (should not happen once all tabs run this build, but old tabs exist during
 *   rollout) — continue without persistence.
 * - 'unimplemented': the browser has no IndexedDB support (private mode on some
 *   browsers) — continue without persistence.
 *
 * Emulator sessions skip persistence on purpose: initFirebase wipes every
 * Firestore IndexedDB before init for the emulator (clearAllFirebaseIndexedDB),
 * so a persistent cache would only ever hold one session's throwaway data while
 * making emulator runs less deterministic.
 */
import { getPerformanceDiagnostics } from '../performance/performanceDiagnostics'
import { markNamedPerformanceTrace, startPerformanceTrace } from '../performance/performanceLogger'

export const enableFirestorePersistence = (db, { useEmulator = false } = {}) => {
    const diagnostics = getPerformanceDiagnostics()
    const trace = startPerformanceTrace('firestore_persistence', {
        diagnostic_mode: diagnostics.disableFirestorePersistence,
    })
    if (diagnostics.disableFirestorePersistence) {
        trace.end('diagnostic_disabled', { outcome: 'skipped' })
        markNamedPerformanceTrace('app_boot', 'persistence_skipped', { outcome: 'diagnostic_disabled' })
        return Promise.resolve(false)
    }
    if (useEmulator) {
        trace.end('emulator_skipped', { outcome: 'skipped' })
        return Promise.resolve(false)
    }
    if (!db || typeof db.enablePersistence !== 'function') {
        trace.end('unsupported', { outcome: 'skipped' })
        return Promise.resolve(false)
    }

    let persistencePromise
    try {
        persistencePromise = db.enablePersistence({ synchronizeTabs: true })
    } catch (error) {
        console.warn('Firestore persistence could not be requested:', error)
        trace.fail('request_failed')
        markNamedPerformanceTrace('app_boot', 'persistence_failed', { outcome: 'failed' })
        return Promise.resolve(false)
    }

    return Promise.resolve(persistencePromise)
        .then(() => {
            trace.end('enabled', { outcome: 'success' })
            markNamedPerformanceTrace('app_boot', 'persistence_ready', { outcome: 'success' })
            return true
        })
        .catch(error => {
            if (error && error.code === 'failed-precondition') {
                console.warn(
                    'Firestore persistence unavailable: another tab holds it without multi-tab sync. ' +
                        'Continuing with the in-memory cache.'
                )
            } else if (error && error.code === 'unimplemented') {
                console.warn(
                    'Firestore persistence unavailable: this browser does not support it. ' +
                        'Continuing with the in-memory cache.'
                )
            } else {
                console.warn('Firestore persistence failed to enable:', error)
            }
            trace.fail('enable_failed')
            markNamedPerformanceTrace('app_boot', 'persistence_failed', { outcome: error?.code || 'failed' })
            return false
        })
}
