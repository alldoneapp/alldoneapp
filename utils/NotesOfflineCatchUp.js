/**
 * Reconnect catch-up for note content that never reached Firebase Storage (AT-2340).
 *
 * Firestore queues offline writes and flushes them on reconnect; Firebase
 * Storage does not — a failed `.put()` is gone. Note BODIES live in Storage, so
 * an edit made offline survived only in the editor's local y-indexeddb copy,
 * and the only thing that ever uploaded it was re-opening that exact note. A
 * note edited on a plane and then closed stayed stale on the server (and on
 * every other device) indefinitely.
 *
 * This sweep closes that gap. `setNoteData` records every failed upload in the
 * dependency-free `pendingNoteUploads` registry; on reconnect each recorded
 * note is opened headlessly against its own y-indexeddb store, compared with
 * the canonical copy, and uploaded ONLY if the local state is genuinely ahead.
 *
 * Three properties worth keeping:
 *
 * 1. **Verify before writing.** The comparison is the same
 *    `storageIsMissingLocalState` the editor uses, so a note whose content the
 *    server already has costs one Storage read and no writes at all.
 * 2. **Merge, never clobber.** The Storage bytes are applied into the local doc
 *    before encoding, so the upload is the CRDT UNION. Someone else's edits
 *    made while we were offline cannot be overwritten by our catch-up.
 * 3. **Content only.** The Firestore side (preview, lastEditionDate,
 *    lastEditorId, the edited-today list, feeds) was already written by the
 *    offline autosave and is flushed by Firestore's own offline queue. Writing
 *    it again here would re-stamp the note as edited a second time.
 *
 * The note currently open in the editor is skipped — the live editor owns that
 * IndexedDB store and does its own verified catch-up on reconnect.
 */
import * as Y from 'yjs'

import store from '../redux/store'
import Backend from './BackendBridge'
import { notesStorage } from './backends/firestore'
import { isBrowserOffline } from './connectionState'
import { clearPendingNoteUpload, readPendingNoteUploads } from './Notes/pendingNoteUploads'
import { createNoteLocalPersistence } from '../components/NotesView/NotesDV/EditorView/noteLocalPersistence'
import { storageIsMissingLocalState } from '../components/NotesView/NotesDV/EditorView/noteCollaborationRecovery'

const CATCH_UP_DELAY_AFTER_RECONNECT_MS = 5000
const DELAY_BETWEEN_NOTES_MS = 250
const MAX_NOTES_PER_RUN = 25

let running = false
let listenersInstalled = false

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Opens the note's local store headlessly, merges the canonical copy in and
 * reports whether the union differs from what Storage holds.
 *
 * Returns `null` when there is no local durability in this browser, which means
 * there is nothing this module could ever upload.
 */
export const resolveNoteCatchUpState = async (noteId, storageBytes) => {
    const document = new Y.Doc()
    const persistence = createNoteLocalPersistence(noteId, document)
    if (!persistence) {
        document.destroy()
        return null
    }
    try {
        await persistence.whenSynced
        const needsUpload = storageIsMissingLocalState(document, storageBytes)
        if (!needsUpload) return { needsUpload: false, encodedState: null }
        // Union, not replacement: whatever reached Storage while we were
        // offline stays in the bytes we are about to upload.
        if (storageBytes.length > 0) Y.applyUpdate(document, storageBytes, 'storage-catch-up')
        return { needsUpload: true, encodedState: Y.encodeStateAsUpdate(document) }
    } finally {
        persistence.destroy()
        document.destroy()
    }
}

const uploadNoteContent = async (projectId, noteId, encodedState) => {
    await notesStorage.ref().child(`notesData/${projectId}/${noteId}`).put(encodedState)
}

export const runNotesOfflineCatchUp = async () => {
    if (running) return
    if (isBrowserOffline()) return
    const pending = readPendingNoteUploads()
    if (pending.length === 0) return

    running = true
    try {
        let uploaded = 0
        for (const { projectId, noteId } of pending.slice(0, MAX_NOTES_PER_RUN)) {
            if (isBrowserOffline()) break
            // The live editor owns its own store and runs its own verified
            // catch-up; two writers on one IndexedDB store is the one race this
            // module must not create.
            if (store.getState().activeNoteId === noteId) continue
            try {
                const data = await Backend.getNoteData(projectId, noteId)
                const storageBytes = data ? new Uint8Array(data) : new Uint8Array(0)
                const catchUpState = await resolveNoteCatchUpState(noteId, storageBytes)
                if (!catchUpState) return // no IndexedDB in this browser: nothing is recoverable
                if (catchUpState.needsUpload) {
                    await uploadNoteContent(projectId, noteId, catchUpState.encodedState)
                    uploaded++
                }
                // Either it is uploaded or the server already had it; both mean
                // there is nothing left to catch up for this note.
                clearPendingNoteUpload(noteId)
            } catch (error) {
                // Keep the entry: the next reconnect retries it. A note that
                // keeps failing costs one read per reconnect, never a lost edit.
                console.warn(`[NotesCatchUp] Catching up note ${noteId} failed:`, error)
            }
            await wait(DELAY_BETWEEN_NOTES_MS)
        }
        if (uploaded > 0) console.log(`[NotesCatchUp] Uploaded ${uploaded} note(s) edited offline`)
    } finally {
        running = false
    }
}

/**
 * Installed once after login, next to the offline prefetch. The prefetch pulls
 * note content DOWN for offline reading; this pushes offline edits UP.
 */
export const scheduleNotesOfflineCatchUp = () => {
    runNotesOfflineCatchUp().catch(error => console.warn('[NotesCatchUp] Run failed:', error))

    if (!listenersInstalled && typeof window !== 'undefined' && window.addEventListener) {
        listenersInstalled = true
        window.addEventListener('online', () => {
            setTimeout(() => {
                runNotesOfflineCatchUp().catch(error => console.warn('[NotesCatchUp] Run failed:', error))
            }, CATCH_UP_DELAY_AFTER_RECONNECT_MS)
        })
    }
}
