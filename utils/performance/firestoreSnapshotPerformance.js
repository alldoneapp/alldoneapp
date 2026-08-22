import { startPerformanceTrace } from './performanceLogger'

/**
 * Measures time to the first snapshot a watcher can actually render. A cached
 * snapshot buffered while online is a separate phase; the trace stays open until
 * the server snapshot or cached-snapshot grace makes data usable.
 */
export const createFirstSnapshotPerformance = (metadata = {}, options = {}) => {
    const trace = startPerformanceTrace('firestore_first_snapshot', metadata, options)
    let cacheRecorded = false

    return {
        observe(snapshot, buffered) {
            if (trace.isEnded()) return
            const snapshotMetadata = snapshot?.metadata || {}
            const details = {
                document_count: Number.isFinite(snapshot?.size) ? snapshot.size : snapshot?.docs?.length || 0,
                from_cache: !!snapshotMetadata.fromCache,
            }
            if (buffered) {
                if (!cacheRecorded) {
                    cacheRecorded = true
                    trace.mark('cache_buffered', details)
                }
                return
            }
            const phase = snapshotMetadata.isGateFlush
                ? 'cache_grace_ready'
                : snapshotMetadata.fromCache
                  ? 'cache_ready'
                  : 'server_ready'
            trace.end(phase, { ...details, outcome: 'success' })
        },
        fail() {
            trace.fail('listener_failed')
        },
        cancel() {
            trace.end('listener_cancelled', { outcome: 'cancelled' })
        },
    }
}
