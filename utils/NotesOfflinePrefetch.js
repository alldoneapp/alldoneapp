/**
 * Offline cache warming for note content (OFFLINE_SUPPORT_PLAN.md, notes
 * follow-ups). Note bodies live in Firebase Storage, which has no offline
 * cache — before this, only notes the user had OPENED on a device were
 * readable offline. While online and idle, this module downloads the most
 * recently edited notes the user can see and writes their Yjs state into the
 * same per-note y-indexeddb stores the live editor uses
 * (`createNoteLocalPersistence`), so a flight no longer requires having opened
 * each note first.
 *
 * Deliberate bounds: NOTES_PER_PROJECT newest per project, MAX_NOTES_PER_RUN
 * overall (newest across projects win), one run per RUN_COOLDOWN_MS, sequential
 * downloads with a small gap so the warm-up never competes with the user. A
 * localStorage marker (noteId → lastEditionDate) skips notes whose content the
 * store already has at that edition, so steady-state runs are nearly free.
 *
 * Never touches a note that is currently open (the live editor owns that
 * note's IndexedDB store), and aborts as soon as the browser goes offline —
 * warming a cache offline is by definition impossible.
 */
import * as Y from 'yjs'

import store from '../redux/store'
import Backend from './BackendBridge'
import { getDb } from './backends/firestore'
import { isBrowserOffline } from './connectionState'
import { createNoteLocalPersistence } from '../components/NotesView/NotesDV/EditorView/noteLocalPersistence'
import { FEED_PUBLIC_FOR_ALL } from '../components/Feeds/Utils/FeedsConstants'
import { getPerformanceDiagnostics } from './performance/performanceDiagnostics'
import { logPerformanceMeasurement, performanceNow, startPerformanceTrace } from './performance/performanceLogger'

export const NOTES_PER_PROJECT = 5
export const MAX_NOTES_PER_RUN = 30
const PREFETCH_DELAY_AFTER_LOGIN_MS = 15000
const RUN_COOLDOWN_MS = 10 * 60 * 1000
const DELAY_BETWEEN_NOTES_MS = 250
// Above this size the y-indexeddb write itself gets heavy; the note is still
// available offline once the user opens it normally.
const MAX_NOTE_CONTENT_BYTES = 2 * 1024 * 1024
const MARKER_STORAGE_KEY = 'alldone_notes_prefetch_v1'
const MARKER_LIMIT = 200

let running = false
let lastRunAt = 0
let listenersInstalled = false
let diagnosticSkipLogged = false

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export const readPrefetchMarkers = () => {
    try {
        const raw = localStorage.getItem(MARKER_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : {}
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
        return {}
    }
}

const writePrefetchMarkers = markers => {
    try {
        const entries = Object.entries(markers)
        // Keep the marker map bounded; the newest editions are the ones that
        // matter, and losing a marker only costs one redundant download.
        const bounded = entries.length > MARKER_LIMIT ? entries.slice(entries.length - MARKER_LIMIT) : entries
        localStorage.setItem(MARKER_STORAGE_KEY, JSON.stringify(Object.fromEntries(bounded)))
    } catch (error) {
        // Storage can be unavailable (private mode); prefetch just re-downloads.
    }
}

/**
 * Pure selection: newest first across projects, capped, skipping notes whose
 * content the local store already has at this edition and the note that is
 * open in the live editor right now.
 */
export const selectNotesToPrefetch = (candidates, markers, { limit = MAX_NOTES_PER_RUN, activeNoteId = '' } = {}) => {
    return candidates
        .filter(candidate => candidate.noteId && candidate.noteId !== activeNoteId)
        .filter(candidate => String(markers[candidate.noteId]) !== String(candidate.lastEditionDate))
        .sort((a, b) => (b.lastEditionDate || 0) - (a.lastEditionDate || 0))
        .slice(0, limit)
}

const fetchRecentNoteCandidates = async () => {
    const { loggedUser } = store.getState()
    if (!loggedUser || !loggedUser.uid || loggedUser.isAnonymous) return []
    const projectIds = Array.isArray(loggedUser.projectIds) ? loggedUser.projectIds : []

    const perProject = await Promise.all(
        projectIds.map(projectId =>
            getDb()
                .collection(`noteItems/${projectId}/notes`)
                // Same shape as watchAllTabNotes, so the composite index exists.
                .orderBy('lastEditionDate', 'desc')
                .where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUser.uid])
                .limit(NOTES_PER_PROJECT)
                .get()
                .then(snapshot =>
                    snapshot.docs.map(doc => ({
                        projectId,
                        noteId: doc.id,
                        lastEditionDate: doc.data().lastEditionDate || 0,
                    }))
                )
                .catch(error => {
                    console.warn(`[NotesPrefetch] Listing notes for project ${projectId} failed:`, error)
                    return []
                })
        )
    )
    return perProject.flat()
}

const persistNoteContentLocally = async (noteId, contentBytes) => {
    const document = new Y.Doc()
    const persistence = createNoteLocalPersistence(noteId, document)
    if (!persistence) {
        document.destroy()
        return false
    }
    try {
        await persistence.whenSynced
        Y.applyUpdate(document, contentBytes)
        // Give y-indexeddb's transaction a moment to commit before closing.
        await wait(300)
        return true
    } finally {
        persistence.destroy()
        document.destroy()
    }
}

export const runNotesOfflinePrefetch = async ({ force = false } = {}) => {
    const diagnostics = getPerformanceDiagnostics()
    if (diagnostics.disableNotesPrefetch) {
        if (!diagnosticSkipLogged) {
            diagnosticSkipLogged = true
            logPerformanceMeasurement(
                'notes_offline_prefetch',
                'diagnostic_disabled',
                0,
                { diagnostic_mode: true, outcome: 'skipped' },
                { sampleRate: 1 }
            )
        }
        return
    }
    if (running) return
    if (isBrowserOffline()) return
    if (!force && Date.now() - lastRunAt < RUN_COOLDOWN_MS) return
    const { loggedUser } = store.getState()
    if (!loggedUser || !loggedUser.uid || loggedUser.isAnonymous) return

    running = true
    lastRunAt = Date.now()
    const projectCount = Array.isArray(loggedUser.projectIds) ? loggedUser.projectIds.length : 0
    const trace = startPerformanceTrace('notes_offline_prefetch', { project_count: projectCount })
    let networkDurationMs = 0
    let indexedDbDurationMs = 0
    let byteCount = 0
    let errorCount = 0
    try {
        const listingStartedAt = performanceNow()
        const candidates = await fetchRecentNoteCandidates()
        networkDurationMs += performanceNow() - listingStartedAt
        const markers = readPrefetchMarkers()
        const { activeNoteId } = store.getState()
        const toPrefetch = selectNotesToPrefetch(candidates, markers, { activeNoteId })
        trace.mark('candidates_selected', {
            candidate_count: candidates.length,
            note_count: toPrefetch.length,
            network_duration_ms: Math.round(networkDurationMs),
        })
        if (toPrefetch.length === 0) {
            trace.end('nothing_to_prefetch', { outcome: 'success' })
            return
        }

        let warmed = 0
        for (const { projectId, noteId, lastEditionDate } of toPrefetch) {
            if (isBrowserOffline()) break
            if (store.getState().activeNoteId === noteId) continue
            try {
                const downloadStartedAt = performanceNow()
                const data = await Backend.getNoteData(projectId, noteId)
                networkDurationMs += performanceNow() - downloadStartedAt
                const bytes = data ? new Uint8Array(data) : new Uint8Array(0)
                byteCount += bytes.length
                if (bytes.length > 0 && bytes.length <= MAX_NOTE_CONTENT_BYTES) {
                    const persistenceStartedAt = performanceNow()
                    const persisted = await persistNoteContentLocally(noteId, bytes)
                    indexedDbDurationMs += performanceNow() - persistenceStartedAt
                    if (!persisted) {
                        trace.end('indexeddb_unavailable', {
                            outcome: 'skipped',
                            note_count: warmed,
                            byte_count: byteCount,
                        })
                        return // no IndexedDB in this browser — nothing more to do
                    }
                    warmed++
                }
                // An empty (never-saved) note needs no local copy; either way the
                // marker prevents re-checking this edition on the next run.
                markers[noteId] = lastEditionDate
            } catch (error) {
                errorCount++
                console.warn(`[NotesPrefetch] Warming note ${noteId} failed:`, error)
            }
            await wait(DELAY_BETWEEN_NOTES_MS)
        }
        writePrefetchMarkers(markers)
        if (warmed > 0) console.log(`[NotesPrefetch] Warmed ${warmed} note(s) for offline use`)
        trace.end('complete', {
            outcome: errorCount > 0 ? 'partial' : 'success',
            note_count: warmed,
            candidate_count: candidates.length,
            byte_count: byteCount,
            error_count: errorCount,
            network_duration_ms: Math.round(networkDurationMs),
            indexeddb_duration_ms: Math.round(indexedDbDurationMs),
        })
    } catch (error) {
        trace.fail('failed', {
            note_count: 0,
            byte_count: byteCount,
            error_count: errorCount + 1,
            network_duration_ms: Math.round(networkDurationMs),
            indexeddb_duration_ms: Math.round(indexedDbDurationMs),
        })
        throw error
    } finally {
        running = false
    }
}

/**
 * Called once after login completes: first run after a short idle delay, then
 * a re-run (cooldown-limited) whenever connectivity returns — the moment the
 * offline copies are most likely stale.
 */
export const scheduleNotesOfflinePrefetch = () => {
    if (getPerformanceDiagnostics().disableNotesPrefetch) {
        runNotesOfflinePrefetch()
        return
    }
    setTimeout(() => {
        runNotesOfflinePrefetch().catch(error => console.warn('[NotesPrefetch] Run failed:', error))
    }, PREFETCH_DELAY_AFTER_LOGIN_MS)

    if (!listenersInstalled && typeof window !== 'undefined' && window.addEventListener) {
        listenersInstalled = true
        window.addEventListener('online', () => {
            setTimeout(() => {
                runNotesOfflinePrefetch().catch(error => console.warn('[NotesPrefetch] Run failed:', error))
            }, 5000)
        })
    }
}
