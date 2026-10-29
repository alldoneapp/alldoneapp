/**
 * Whether this tab handed its Firestore connection to a visible tab (AT-2907).
 *
 * Set only by firestoreTabHandoff.js. Kept in a module with no imports because every owner
 * of the network (the offline gate, connection health, the boot integrity healer and
 * restartFirestoreNetwork) must ask it before calling `enableNetwork()`, and connection
 * health in particular must stay importable without the analytics bundle or the store.
 */
let released = false

export const isFirestoreNetworkReleasedToVisibleTab = () => released

export const setFirestoreNetworkReleasedToVisibleTab = value => {
    released = !!value
}
