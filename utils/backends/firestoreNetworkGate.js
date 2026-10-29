import store from '../../redux/store'
import { isManualOfflineMode } from '../connectionHealth'
import { isFirestoreNetworkReleasedToVisibleTab } from './firestoreNetworkRelease'

/** The network is parked while the browser is offline or the user chose "Continue offline". */
export const isFirestoreNetworkParked = ({ getState = store.getState, isManualOffline = isManualOfflineMode } = {}) =>
    getState().connectionState === 'offline' || isManualOffline()

/**
 * Stands Firestore's network down while the app is offline (offline log/battery
 * follow-up). Offline, the SDK otherwise keeps attempting to rebuild its Listen
 * WebChannel on a backoff loop — every attempt logs a browser-level
 * `net::ERR_INTERNET_DISCONNECTED` for the channel URL plus a gapi
 * `cleardot.gif` connectivity probe, and an SDK `transport errored` warning.
 * None of that is actionable while offline (the app is designed to run from the
 * cache), and on a phone in airplane mode the doomed reconnect attempts also
 * cost battery.
 *
 * `disableNetwork()` keeps the local cache fully functional (reads serve from
 * cache, writes queue) — it only parks the transport. The gate re-enables on
 * the recovery transition, which also makes reconnection immediate instead of
 * waiting out the SDK's current backoff interval.
 *
 * Deliberately keyed on the debounced `connectionState` slice, not raw browser
 * events: rapid flaps are absorbed upstream, and the calls queue through the
 * SDK in dispatch order, so the final state always matches the last transition.
 * The boot-integrity healer's own disable/enable cycles cannot interleave: it
 * stands down entirely while `connectionState === 'offline'`.
 */
export const installFirestoreNetworkGate = (
    db,
    {
        getState = store.getState,
        subscribe = store.subscribe,
        isManualOffline = isManualOfflineMode,
        isReleasedToVisibleTab = isFirestoreNetworkReleasedToVisibleTab,
    } = {}
) => {
    if (!db || typeof db.disableNetwork !== 'function') return () => {}

    const shouldParkNetwork = () => isFirestoreNetworkParked({ getState, isManualOffline })
    let wasParked = shouldParkNetwork()
    return subscribe(() => {
        const shouldPark = shouldParkNetwork()
        if (shouldPark === wasParked) return
        wasParked = shouldPark

        if (shouldPark) {
            db.disableNetwork().catch(error =>
                console.warn('Failed to park the Firestore network while offline:', error)
            )
        } else if (!isReleasedToVisibleTab()) {
            // A hidden tab that handed the connection to a visible one (firestoreTabHandoff.js)
            // takes it back itself when it becomes visible again.
            db.enableNetwork().catch(error =>
                console.warn('Failed to resume the Firestore network after reconnect:', error)
            )
        }
    })
}
