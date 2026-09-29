import { startPerformanceTrace } from './performanceLogger'

/**
 * Measures both first usable content and first authoritative server snapshot.
 * Cache delivery can finish the first trace while server freshness keeps waiting.
 */
export const createFirstSnapshotPerformance = (metadata = {}, options = {}) => {
    const trace = startPerformanceTrace('firestore_first_snapshot', metadata, options)
    const serverTrace = startPerformanceTrace('firestore_first_server_snapshot', metadata, options)
    let cacheRecorded = false

    return {
        observe(snapshot, buffered) {
            const snapshotMetadata = snapshot?.metadata || {}
            const details = {
                document_count: Number.isFinite(snapshot?.size) ? snapshot.size : snapshot?.docs?.length || 0,
                from_cache: !!snapshotMetadata.fromCache,
            }
            if (!snapshotMetadata.fromCache && !serverTrace.isEnded()) {
                serverTrace.end('server_ready', { ...details, outcome: 'success' })
            }
            if (trace.isEnded()) return
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
            serverTrace.fail('listener_failed')
        },
        cancel() {
            trace.end('listener_cancelled', { outcome: 'cancelled' })
            serverTrace.end('listener_cancelled', { outcome: 'cancelled' })
        },
    }
}
