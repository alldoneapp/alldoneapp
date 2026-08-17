import store from '../../redux/store'
import { isBrowserOffline } from '../connectionState'

/**
 * Offline-aware write-acknowledgement helpers (AT-2340).
 *
 * A Firestore write promise resolves on the **server** ack, not on the local
 * cache write. Offline that ack cannot arrive, so `await ref.set(...)` parks
 * forever and EVERYTHING AFTER IT IS UNREACHABLE — not slow, unreachable. That
 * is a different failure from a slow network: the mutation itself is already
 * durable (with IndexedDB persistence the pending-write queue survives a tab
 * close and flushes on the next boot), it is only the continuation that is
 * lost. Completing a task offline therefore wrote the task but never awarded
 * XP, never wrote the done feed and never added the follower; `updateTask` left
 * its focus handoff open forever; posting a comment never closed the modal.
 *
 * The fix is not to drop the await — durability and ordering online depend on
 * it (see the deliberate fire-and-forget → await change at
 * `tasksFirestore.js` `updateTaskInDone`). The fix is to await it only when an
 * ack can actually arrive.
 *
 * Reads are deliberately NOT covered here: an offline `get()` resolves from the
 * local cache, so it does not block.
 */

/**
 * `true` when no server ack can arrive right now.
 *
 * Mirrors the composite used by `cachedSnapshotGate` / `bootIntegrityHealer`:
 * the redux slice is authoritative once it has settled, and the synchronous
 * browser signal covers the boot window before its listener is installed.
 */
export const isAppOffline = () => {
    try {
        if (store.getState().connectionState === 'offline') return true
    } catch (error) {
        // The store is always available in the app; in isolated unit tests it
        // may not be, and the browser-level signal is enough there.
    }
    return isBrowserOffline()
}

/**
 * Await a Firestore write only when a server ack can arrive.
 *
 * Offline the write is still issued (it lands in the local cache and the
 * persisted mutation queue) but the caller continues immediately, so the code
 * after the write — XP, feeds, followers, focus handoff, closing a modal —
 * runs now instead of never. A rejection is logged rather than thrown: the
 * caller has already moved on, and an offline failure is expected.
 *
 * @param {Promise|*} write the write promise (or anything thenable/plain)
 * @param {string} label short description used in the offline warning
 * @returns {Promise} resolves to the write result online, `undefined` offline
 */
export const awaitWriteAck = (write, label = 'firestore write') => {
    const settled = Promise.resolve(write)
    if (!isAppOffline()) return settled
    settled.catch(error => {
        console.warn(`Offline write "${label}" did not reach the server; it stays queued locally.`, error)
    })
    return Promise.resolve()
}
