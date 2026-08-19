/**
 * Local IndexedDB durability for the live notes editor (OFFLINE_SUPPORT_PLAN.md,
 * Stage 6). y-indexeddb persists every Yjs update as it happens, so note content
 * survives offline sessions and reloads even though the canonical copy lives in
 * Firebase Storage (which cannot be written offline). Merge-on-reconnect is
 * automatic and conflict-free — CRDT state simply unions with the room.
 *
 * Deliberately scoped to the LIVE editor only: the headless/virtual Quill path
 * in notesHelper.js serves online-only operations (restore, delta extraction)
 * and attaching a durable store there would only add cleanup hazards.
 */
import { IndexeddbPersistence } from 'y-indexeddb'

const NOTE_LOCAL_PERSISTENCE_PREFIX = 'alldone-note-'

export const createNoteLocalPersistence = (noteId, document) => {
    // No IndexedDB (some private-browsing modes, non-browser environments):
    // prepareSyncedNoteDocument treats a null persistence as "no offline
    // durability this session" and everything else works as before.
    if (typeof indexedDB === 'undefined') return null
    return new IndexeddbPersistence(`${NOTE_LOCAL_PERSISTENCE_PREFIX}${noteId}`, document)
}
