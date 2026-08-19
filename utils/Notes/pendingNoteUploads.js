/**
 * Registry of notes whose content did NOT reach Firebase Storage (AT-2340).
 *
 * Note bodies live in Firebase Storage, which has no offline queue of its own —
 * unlike Firestore, a failed `.put()` is simply lost. The local y-indexeddb copy
 * is durable, so nothing is destroyed, but the canonical copy stays behind until
 * something uploads it. Before this registry the only thing that ever did was
 * re-opening that exact note.
 *
 * Deliberately dependency-free (localStorage only, no store/Backend imports) so
 * `notesFirestore.setNoteData` can record a failure without pulling the
 * catch-up runner — and its Backend/Firestore graph — into that module.
 *
 * The registry is a hint, never a source of truth: a lost entry costs a delayed
 * upload (the next open of the note still catches up), and a stale entry costs
 * one Storage read that finds nothing to do.
 */
const PENDING_UPLOADS_STORAGE_KEY = 'alldone_notes_pending_upload_v1'
// Bounded so a long offline session cannot grow the entry unboundedly; the
// oldest entries are dropped first and are recovered by opening the note.
const PENDING_UPLOADS_LIMIT = 100

const readRawPendingNoteUploads = () => {
    try {
        if (typeof localStorage === 'undefined') return {}
        const raw = localStorage.getItem(PENDING_UPLOADS_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : {}
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
        return {}
    }
}

const writePendingNoteUploads = entries => {
    try {
        if (typeof localStorage === 'undefined') return
        const pairs = Object.entries(entries)
        const bounded =
            pairs.length > PENDING_UPLOADS_LIMIT
                ? pairs
                      .sort((a, b) => (a[1].registeredAt || 0) - (b[1].registeredAt || 0))
                      .slice(-PENDING_UPLOADS_LIMIT)
                : pairs
        localStorage.setItem(PENDING_UPLOADS_STORAGE_KEY, JSON.stringify(Object.fromEntries(bounded)))
    } catch (error) {
        // Storage unavailable (private mode): catch-up degrades to the
        // open-the-note path, which is what happened before this existed.
    }
}

export const readPendingNoteUploads = () => {
    const entries = readRawPendingNoteUploads()
    return Object.entries(entries)
        .filter(([noteId, entry]) => noteId && entry && entry.projectId)
        .map(([noteId, entry]) => ({ noteId, projectId: entry.projectId, registeredAt: entry.registeredAt || 0 }))
}

export const hasPendingNoteUpload = noteId => !!readRawPendingNoteUploads()[noteId]

export const registerPendingNoteUpload = (projectId, noteId) => {
    if (!projectId || !noteId) return
    const entries = readRawPendingNoteUploads()
    // Keep the first registration time: it is what the bounding sort orders on,
    // and re-stamping it on every failed retry would make a note that keeps
    // failing immortal at the expense of older ones.
    if (!entries[noteId]) entries[noteId] = { projectId, registeredAt: Date.now() }
    else entries[noteId] = { ...entries[noteId], projectId }
    writePendingNoteUploads(entries)
}

export const clearPendingNoteUpload = noteId => {
    if (!noteId) return
    const entries = readRawPendingNoteUploads()
    if (!entries[noteId]) return
    delete entries[noteId]
    writePendingNoteUploads(entries)
}

export const clearAllPendingNoteUploads = () => writePendingNoteUploads({})
