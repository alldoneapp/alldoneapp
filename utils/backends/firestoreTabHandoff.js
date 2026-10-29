/**
 * Hands the shared Firestore connection from a hidden tab to a visible one (AT-2907).
 *
 * With the multi-tab persistent cache (firestorePersistence.js) only ONE tab, the primary,
 * holds a network connection, and it serves the listeners of every Alldone tab through
 * IndexedDB. The SDK prefers a visible tab when the lease is free, but it never takes a
 * still-valid lease away from a hidden one (`canActAsPrimary` in indexeddb_persistence.ts).
 * A tab opened yesterday and left in the background therefore kept serving the tab the user
 * was looking at, with Chrome throttling its timers. Measured on 2026-10-29: the visible tab
 * got no server snapshot for its tasks after 109 seconds and fell back to cached data; with
 * persistence switched off, the same page had its server snapshot after 2.3 seconds.
 *
 * The SDK has no API to move the lease, but it does give it up when the primary's network is
 * disabled and another active client has network (`setNetworkEnabled` refreshes the lease at
 * once). So a tab that has been hidden for RELEASE_AFTER_HIDDEN_MS calls `disableNetwork()`
 * while another Alldone tab is visible, and `enableNetwork()` again when it becomes visible or
 * when no visible tab is left. A hidden secondary tab loses nothing by this: its views are fed
 * by the primary, and its writes go to the shared queue that the primary sends.
 *
 * "Another tab is visible" is answered by the tabs themselves over a BroadcastChannel, never by
 * reading the SDK's IndexedDB bookkeeping: a visible tab announces itself on becoming visible,
 * every HEARTBEAT_MS, and in reply to any tab that just went hidden. Without a visible peer a
 * hidden tab keeps its network, because a lone hidden tab with its network disabled would stop
 * syncing and stop sending its own writes.
 *
 * Three rules keep this from fighting the other owners of the network (firestoreNetworkGate,
 * connectionHealth, bootIntegrityHealer, restartFirestoreNetwork):
 * - never release while the network is parked for offline or manual offline (`isParked`);
 * - never enable while it is parked, so a tab coming back does not override "Continue offline";
 * - every other enable site asks `isFirestoreNetworkReleasedToVisibleTab()` first, so a
 *   transport restart in a released tab does not quietly take the connection back.
 */
import { subscribePageHidden, subscribePageVisible } from '../appResume'
import { logPerformanceMeasurement } from '../performance/performanceLogger'
import {
    isFirestoreNetworkReleasedToVisibleTab,
    setFirestoreNetworkReleasedToVisibleTab,
} from './firestoreNetworkRelease'

export const FIRESTORE_TAB_PRESENCE_CHANNEL = 'alldone-firestore-tab-presence'

/** Tabbing between two Alldone tabs must stay free: below this nothing changes hands. */
export const RELEASE_AFTER_HIDDEN_MS = 30 * 1000

/** How often a visible tab announces itself, and how often a hidden tab re-checks. */
export const HEARTBEAT_MS = 15 * 1000

/** A visible peer not heard from for this long is treated as gone (crashed, frozen). */
export const VISIBLE_PEER_TTL_MS = 3 * HEARTBEAT_MS

const createTabId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const createBroadcastChannel = name => {
    if (typeof BroadcastChannel !== 'function') return null
    try {
        return new BroadcastChannel(name)
    } catch (error) {
        return null
    }
}

export const installFirestoreTabHandoff = (
    db,
    {
        isParked = () => false,
        documentObject = typeof document === 'undefined' ? undefined : document,
        createChannel = createBroadcastChannel,
        subscribeVisible = subscribePageVisible,
        subscribeHidden = subscribePageHidden,
        now = () => Date.now(),
        setTimer = (callback, ms) => setTimeout(callback, ms),
        clearTimer = id => clearTimeout(id),
        setRepeating = (callback, ms) => setInterval(callback, ms),
        clearRepeating = id => clearInterval(id),
        releaseAfterHiddenMs = RELEASE_AFTER_HIDDEN_MS,
        heartbeatMs = HEARTBEAT_MS,
        visiblePeerTtlMs = VISIBLE_PEER_TTL_MS,
    } = {}
) => {
    if (!db || typeof db.disableNetwork !== 'function' || !documentObject) return () => {}
    const channel = createChannel(FIRESTORE_TAB_PRESENCE_CHANNEL)
    // Without a channel no peer can ever be known, so the tab could never release anyway.
    if (!channel) return () => {}

    const tabId = createTabId()
    const visiblePeers = new Map()
    let hiddenSince = documentObject.visibilityState === 'hidden' ? now() : null
    let releaseTimer = null
    let stopped = false

    const post = type => {
        try {
            channel.postMessage({ type, tabId })
        } catch (error) {
            // A closed channel during page teardown is not worth a warning.
        }
    }

    const hasVisiblePeer = () => {
        const at = now()
        visiblePeers.forEach((lastSeenAt, peerId) => {
            if (at - lastSeenAt > visiblePeerTtlMs) visiblePeers.delete(peerId)
        })
        return visiblePeers.size > 0
    }

    const log = (phase, reason) => {
        logPerformanceMeasurement('firestore_tab_handoff', phase, hiddenSince === null ? 0 : now() - hiddenSince, {
            source: reason,
            count: visiblePeers.size,
        })
    }

    const release = reason => {
        if (stopped || isFirestoreNetworkReleasedToVisibleTab() || hiddenSince === null) return
        if (now() - hiddenSince < releaseAfterHiddenMs) return
        if (!hasVisiblePeer() || isParked()) return
        setFirestoreNetworkReleasedToVisibleTab(true)
        log('released', reason)
        db.disableNetwork().catch(error => console.warn('[FirestoreTabHandoff] Could not release the network:', error))
    }

    const reacquire = reason => {
        if (!isFirestoreNetworkReleasedToVisibleTab()) return
        setFirestoreNetworkReleasedToVisibleTab(false)
        log('reacquired', reason)
        // Parked by the offline gate or "Continue offline": the gate's own recovery
        // transition, or "Reconnect now", brings the network back, not this module.
        if (isParked()) return
        db.enableNetwork().catch(error => console.warn('[FirestoreTabHandoff] Could not resume the network:', error))
    }

    const clearReleaseTimer = () => {
        if (releaseTimer === null) return
        clearTimer(releaseTimer)
        releaseTimer = null
    }

    const onHidden = () => {
        if (hiddenSince === null) hiddenSince = now()
        post('hidden')
        clearReleaseTimer()
        releaseTimer = setTimer(
            () => {
                releaseTimer = null
                release('hidden_timer')
            },
            Math.max(0, releaseAfterHiddenMs - (now() - hiddenSince))
        )
    }

    const onVisible = () => {
        // appResume also reports `focus` and `pageshow` for a page that never went away.
        if (documentObject.visibilityState === 'hidden') return
        const wasHidden = hiddenSince !== null
        hiddenSince = null
        clearReleaseTimer()
        reacquire('visible')
        if (wasHidden) post('visible')
    }

    const onMessage = event => {
        const message = event && event.data
        if (!message || message.tabId === tabId) return
        if (message.type === 'visible') {
            visiblePeers.set(message.tabId, now())
            release('peer_visible')
            return
        }
        if (message.type === 'hidden') {
            visiblePeers.delete(message.tabId)
            // The tab that just went hidden needs to know someone is still looking.
            if (hiddenSince === null) post('visible')
            if (!hasVisiblePeer()) reacquire('no_visible_peer')
        }
    }

    const tick = () => {
        if (hiddenSince === null) {
            post('visible')
            return
        }
        if (isFirestoreNetworkReleasedToVisibleTab() && !hasVisiblePeer()) reacquire('peer_timeout')
        else release('heartbeat')
    }

    channel.addEventListener('message', onMessage)
    const stopVisible = subscribeVisible(onVisible)
    const stopHidden = subscribeHidden(onHidden)
    const heartbeat = setRepeating(tick, heartbeatMs)
    if (hiddenSince === null) post('visible')
    else onHidden()

    return () => {
        stopped = true
        clearReleaseTimer()
        clearRepeating(heartbeat)
        stopVisible()
        stopHidden()
        channel.removeEventListener('message', onMessage)
        try {
            channel.close()
        } catch (error) {
            // Already closed.
        }
        reacquire('uninstalled')
    }
}
