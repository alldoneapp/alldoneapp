/**
 * Firestore IndexedDB persistence (OFFLINE_SUPPORT_PLAN.md, Stage 3).
 *
 * Called once from initFirebase, right after the base db.settings() call and
 * before any other Firestore operation. The current SDK configures persistence
 * through FirestoreSettings.localCache; enablePersistence({ synchronizeTabs:
 * true }) is deprecated.
 *
 * synchronizeTabs matters: users keep several Alldone tabs open, and without it
 * the second tab would fail persistence entirely ('failed-precondition').
 *
 * A synchronous configuration failure degrades to the SDK's default in-memory
 * cache and must never block or crash boot. IndexedDB availability is handled by
 * the SDK once the configured cache starts.
 *
 * Emulator sessions skip persistence on purpose: initFirebase wipes every
 * Firestore IndexedDB before init for the emulator (clearAllFirebaseIndexedDB),
 * so a persistent cache would only ever hold one session's throwaway data while
 * making emulator runs less deterministic.
 */
import { getPerformanceDiagnostics } from '../performance/performanceDiagnostics'
import { markNamedPerformanceTrace, startPerformanceTrace } from '../performance/performanceLogger'
import { persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const FIRESTORE_CACHE_SIZE_BYTES = 100 * 1024 * 1024

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
    if (!db || typeof db.settings !== 'function') {
        trace.end('unsupported', { outcome: 'skipped' })
        return Promise.resolve(false)
    }

    try {
        db.settings({
            merge: true,
            localCache: persistentLocalCache({
                cacheSizeBytes: FIRESTORE_CACHE_SIZE_BYTES,
                tabManager: persistentMultipleTabManager(),
            }),
        })
    } catch (error) {
        console.warn('Firestore persistent cache could not be configured:', error)
        trace.fail('configuration_failed')
        markNamedPerformanceTrace('app_boot', 'persistence_failed', { outcome: 'failed' })
        return Promise.resolve(false)
    }

    trace.end('configured', { outcome: 'success' })
    markNamedPerformanceTrace('app_boot', 'persistence_configured', { outcome: 'success' })
    return Promise.resolve(true)
}
