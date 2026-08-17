import firebase from 'firebase/compat/app'

import store from '../redux/store'
import { isBrowserOffline } from './connectionState'

/**
 * Server-clock offset (AT-2340).
 *
 * `getFirebaseTimestampDirectly` used to WRITE and then READ the single global
 * `/info/currentTime` document on every call — and one of those calls sits on
 * the note autosave path, which runs every few seconds per editing user. That
 * document is a global singleton: every user of the app contends on the same
 * key, so it is both a hotspot (Firestore's ~1 write/second per-document soft
 * limit) and a full network round trip on a critical path. Its read loop also
 * recursed until the value materialised, so a slow ack meant unbounded reads.
 *
 * Nothing actually needed *that document* — callers only wanted "what time is
 * it on the server". So the round trip is replaced by a measured offset between
 * the client clock and the server clock:
 *
 *   - `getServerNow()` is synchronous: `Date.now() + offset`. No I/O, ever.
 *   - the offset is measured in the background, at most once every
 *     `SYNC_INTERVAL_MS`, against a PER-USER document nobody else contends on.
 *   - offline it is not measured at all and the client clock is used, which is
 *     exactly what the offline branch of `updateEditionData` already did.
 *
 * Accuracy: the offset is estimated as `serverTime - (t0 + t1) / 2`, i.e. the
 * server stamp minus the midpoint of the round trip (NTP's estimator). It is
 * used for `lastEditionDate`-style ordering, which needs seconds, not
 * milliseconds — and an unsynced client falls back to its own clock, which is
 * already what `created` uses everywhere in this codebase.
 */

const SYNC_INTERVAL_MS = 15 * 60 * 1000
// A measurement whose round trip was this slow says little about the offset;
// keep whatever we had rather than poisoning it.
const MAX_ACCEPTABLE_ROUND_TRIP_MS = 10000

let offsetMs = 0
let lastSyncedAt = 0
let inFlightSync = null

export const getClockOffsetMs = () => offsetMs

/** Test seam: forget the measured offset. */
export const resetServerClockForTests = () => {
    offsetMs = 0
    lastSyncedAt = 0
    inFlightSync = null
}

/** Current server time in epoch milliseconds. Synchronous, never blocks. */
export const getServerNow = () => Date.now() + offsetMs

const clockSyncDocRef = () => {
    const { loggedUser } = store.getState()
    const uid = loggedUser?.uid
    if (!uid) return null
    // Per-user, owner-only (firestore.rules `users/{userId}/{document=**}`), so
    // this write contends with nothing. No rules change was needed.
    return firebase.firestore().doc(`users/${uid}/private/clockSync`)
}

const measureOffset = async ref => {
    const startedAt = Date.now()
    await ref.set({ time: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
    // `source: 'server'` because the cached snapshot of a pending write resolves
    // `serverTimestamp()` to a local estimate (or null), which would measure the
    // client against itself.
    const snapshot = await ref.get({ source: 'server' })
    const finishedAt = Date.now()

    const time = snapshot.data()?.time
    const serverMs = time?.toMillis ? time.toMillis() : typeof time?.seconds === 'number' ? time.seconds * 1000 : null
    if (serverMs === null) return false

    const roundTripMs = finishedAt - startedAt
    if (roundTripMs > MAX_ACCEPTABLE_ROUND_TRIP_MS) return false

    offsetMs = serverMs - (startedAt + finishedAt) / 2
    lastSyncedAt = finishedAt
    return true
}

/**
 * Measure the offset if it is stale. Fire-and-forget by design — callers use
 * `getServerNow()` and never wait for this.
 *
 * @param {{force?: boolean}} options
 * @returns {Promise<boolean>} whether an offset is now known
 */
export const syncServerClock = async ({ force = false } = {}) => {
    if (isBrowserOffline()) return lastSyncedAt > 0
    if (!force && lastSyncedAt > 0 && Date.now() - lastSyncedAt < SYNC_INTERVAL_MS) return true
    if (inFlightSync) return inFlightSync

    const ref = clockSyncDocRef()
    if (!ref) return lastSyncedAt > 0

    inFlightSync = measureOffset(ref)
        .catch(error => {
            // A failed sync is not an error the user can act on: the client clock
            // remains the fallback, exactly as offline.
            console.warn('Could not measure the server clock offset; using the client clock.', error)
            return lastSyncedAt > 0
        })
        .finally(() => {
            inFlightSync = null
        })

    return inFlightSync
}

/**
 * The drop-in replacement for the old contended round trip: returns immediately
 * and refreshes the offset in the background when it has gone stale.
 */
export const getServerTimestampNow = () => {
    syncServerClock()
    return getServerNow()
}
