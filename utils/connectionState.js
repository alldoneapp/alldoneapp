/**
 * Connectivity signal for offline support (OFFLINE_SUPPORT_PLAN.md, Stage 1).
 *
 * One listener owns the app-wide online/offline state and pushes it into the
 * `connectionState` redux slice. Installed once from AppNavigator's AppContainer —
 * the component that mounts once for the whole app and already owns the app's
 * document/window-level listeners (same reasoning as the escape stack, AT-2257).
 *
 * State machine, deliberately matching the contract the (previously dead)
 * ConnectionStateModal was written against:
 *   ''        initial — connectivity never observed to change; treated as online
 *   'offline' the browser reported offline
 *   'online'  recovery — only ever set coming back FROM 'offline', never on boot,
 *             so the green "Alldone is online" toast fires exactly once per recovery
 *
 * Browser `online` events are optimistic (a captive portal counts as online), so
 * consumers must treat 'offline' as authoritative and 'online' as a hint. Later
 * stages add a Firestore-snapshot-based tell for the captive-portal case.
 *
 * Transitions are debounced: network switches (Wi-Fi → cellular) fire rapid
 * offline/online pairs that should not flash the offline UI.
 */
import store from '../redux/store'
import { setConnectionState } from '../redux/actions'

const CONNECTION_STATE_DEBOUNCE_MS = 500

/**
 * Synchronous browser-level offline check for early-boot code that runs before
 * (or independently of) the debounced redux slice — the slice can still be ''
 * while the first reads are already failing. `false` when there is no navigator
 * (tests, non-browser).
 */
export const isBrowserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export const installConnectionStateListener = ({
    windowObject = typeof window === 'undefined' ? undefined : window,
    dispatch = store.dispatch,
    getConnectionState = () => store.getState().connectionState,
} = {}) => {
    if (!windowObject || !windowObject.addEventListener) return () => {}

    let debounceTimer

    const applyBrowserState = () => {
        debounceTimer = undefined
        const browserIsOffline = windowObject.navigator && windowObject.navigator.onLine === false
        const currentState = getConnectionState()
        if (browserIsOffline) {
            if (currentState !== 'offline') dispatch(setConnectionState('offline'))
        } else if (currentState === 'offline') {
            dispatch(setConnectionState('online'))
        }
    }

    const scheduleUpdate = () => {
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(applyBrowserState, CONNECTION_STATE_DEBOUNCE_MS)
    }

    windowObject.addEventListener('online', scheduleUpdate)
    windowObject.addEventListener('offline', scheduleUpdate)

    // A page can be loaded while already offline (the browser boots the app from the
    // service worker precache); pick that up without waiting for an event.
    if (windowObject.navigator && windowObject.navigator.onLine === false) scheduleUpdate()

    return () => {
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        windowObject.removeEventListener('online', scheduleUpdate)
        windowObject.removeEventListener('offline', scheduleUpdate)
    }
}
