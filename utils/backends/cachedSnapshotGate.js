/**
 * Cached-snapshot delivery gate (OFFLINE_SUPPORT_PLAN.md, Stage 4).
 *
 * The list watchers (open/done/workflow tasks, notes) deliberately buffer
 * `fromCache` snapshots and only render once a server snapshot arrives — correct
 * online (no flash of partial data while the transport settles, the AT-era
 * wedged-Listen-stream lesson), fatal offline: every snapshot is `fromCache`
 * forever, so nothing would ever render even though IndexedDB persistence
 * (Stage 3) holds all the data.
 *
 * This gate keeps each watcher's existing buffer-and-merge structure and owns
 * only the decision: `shouldBuffer(querySnapshot)` replaces the raw
 * `querySnapshot.metadata.fromCache` test. Cached snapshots are delivered
 * (returned `false`) in two cases:
 *
 * 1. The browser says we are offline (`connectionState === 'offline'`).
 * 2. Only cached snapshots have arrived for CACHED_SNAPSHOT_GRACE_MS. This is
 *    the reliable offline tell: `navigator.onLine` lies on captive portals, and
 *    Firestore snapshots are edge-triggered — if the offline transition lands
 *    after the initial cache snapshot, no further event would ever come to
 *    re-evaluate, so a level check alone would leave the list blank.
 *
 * Delivery for case 2 re-invokes the watcher's own handler with a synthetic
 * "flush" snapshot: `docChanges()` is empty (the real changes are already in
 * the watcher's buffer — re-reading them would double-count), while `docs`/
 * `size`/`empty`/`forEach` delegate to the last cached snapshot for the
 * watchers that read whole result sets. The handler's normal merge path then
 * runs exactly as it would for a server snapshot.
 *
 * A server snapshot cancels any pending flush and resets the gate, so brief
 * mid-session cache blips keep today's buffered behavior.
 */
import store from '../../redux/store'

export const CACHED_SNAPSHOT_GRACE_MS = 4000

const defaultIsOffline = () => store.getState().connectionState === 'offline'

const createFlushSnapshot = snapshot => ({
    docChanges: () => [],
    docs: snapshot.docs,
    size: snapshot.size,
    empty: snapshot.empty,
    forEach: callback => snapshot.forEach(callback),
    metadata: {
        fromCache: true,
        hasPendingWrites: !!(snapshot.metadata && snapshot.metadata.hasPendingWrites),
        isGateFlush: true,
    },
})

/**
 * @param getHandler lazily resolves the watcher's own snapshot handler (lazily
 *        because the handler closes over the gate — declare the handler as a
 *        hoisted `function` right after creating the gate).
 */
export const createCachedSnapshotGate = (
    getHandler,
    { graceMs = CACHED_SNAPSHOT_GRACE_MS, isOffline = defaultIsOffline } = {}
) => {
    let graceTimer
    let latestSnapshot = null
    let disposed = false

    const clearGraceTimer = () => {
        if (graceTimer !== undefined) {
            clearTimeout(graceTimer)
            graceTimer = undefined
        }
    }

    const flush = () => {
        graceTimer = undefined
        if (disposed || !latestSnapshot) return
        const handler = getHandler()
        if (typeof handler === 'function') handler(createFlushSnapshot(latestSnapshot))
    }

    const shouldBuffer = querySnapshot => {
        const metadata = (querySnapshot && querySnapshot.metadata) || {}
        // A flush re-invocation must run the handler's delivery branch and must
        // not re-arm the timer.
        if (metadata.isGateFlush) return false
        if (!metadata.fromCache) {
            clearGraceTimer()
            latestSnapshot = null
            return false
        }
        latestSnapshot = querySnapshot
        if (isOffline()) {
            clearGraceTimer()
            return false
        }
        if (graceTimer === undefined && !disposed) graceTimer = setTimeout(flush, graceMs)
        return true
    }

    const dispose = () => {
        disposed = true
        clearGraceTimer()
        latestSnapshot = null
    }

    // Watchers store their unsubscribe functions in maps that outlive the view;
    // wrapping ties the pending flush timer's lifetime to the subscription so a
    // flush can never deliver into an unwatched view.
    const wrapUnsubscribe = unsubscribe => () => {
        dispose()
        if (typeof unsubscribe === 'function') unsubscribe()
    }

    return { shouldBuffer, dispose, wrapUnsubscribe }
}
