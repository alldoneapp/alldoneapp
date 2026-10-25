/**
 * Offline-support browser harness (OFFLINE_SUPPORT_PLAN.md, Stage 8).
 *
 * Bundles the REAL offline modules — the connectionState listener wired to the
 * real redux store, the cached-snapshot gate with its default (store-backed)
 * offline check, and prepareSyncedNoteDocument with the real y-indexeddb
 * persistence — and exposes scenario helpers for run.js to drive through
 * Playwright's context.setOffline(), which flips navigator.onLine and fires
 * the real window online/offline events.
 *
 * Why a real browser: jsdom has no IndexedDB (the y-indexeddb round trip in
 * these scenarios is untestable there — the jest suites inject stubs), and the
 * offline transition path here is the real event → debounce → store → consumer
 * composition rather than injected fakes.
 */
import * as Y from 'yjs'

import store from '../../redux/store'
import { installConnectionStateListener, isBrowserOffline } from '../../utils/connectionState'
import { createCachedSnapshotGate, CACHED_SNAPSHOT_GRACE_MS } from '../../utils/backends/cachedSnapshotGate'
import { prepareSyncedNoteDocument } from '../../components/NotesView/NotesDV/EditorView/noteCollaborationRecovery'
import { createNoteLocalPersistence } from '../../components/NotesView/NotesDV/EditorView/noteLocalPersistence'

installConnectionStateListener()

const HARNESS_NOTE_ID = 'offline-harness-note'

const makeCachedSnapshot = () => ({
    docs: [],
    size: 0,
    empty: true,
    forEach: () => {},
    docChanges: () => [{ type: 'added' }],
    metadata: { fromCache: true, hasPendingWrites: false },
})

const createGateScenario = () => {
    const delivered = []
    const gate = createCachedSnapshotGate(() => handler)
    function handler(querySnapshot) {
        if (gate.shouldBuffer(querySnapshot)) return
        delivered.push(querySnapshot.metadata)
    }
    return { gate, handler, delivered }
}

const createOfflineProvider = () => ({
    synced: false,
    on: () => {},
    off: () => {},
    destroy: () => {},
})

window.harness = {
    CACHED_SNAPSHOT_GRACE_MS,

    getConnectionState: () => store.getState().connectionState,
    isBrowserOffline: () => isBrowserOffline(),

    // A cached snapshot must deliver IMMEDIATELY while the store says offline
    // (the gate's default isOffline reads the real redux slice).
    deliverCachedSnapshotNow: () => {
        const { handler, delivered } = createGateScenario()
        handler(makeCachedSnapshot())
        return delivered.length
    },

    // Online but cache-only: buffered first, flushed by the grace timer.
    deliverCachedSnapshotAfterGrace: () =>
        new Promise(resolve => {
            const { handler, delivered } = createGateScenario()
            handler(makeCachedSnapshot())
            const immediate = delivered.length
            setTimeout(() => resolve({ immediate, afterGrace: delivered.length }), CACHED_SNAPSHOT_GRACE_MS + 500)
        }),

    // Session 1: write note content with ONLY the local y-indexeddb persistence
    // (no Storage, no collaboration server), then tear everything down.
    noteOfflineWrite: async text => {
        const document = new Y.Doc()
        const persistence = createNoteLocalPersistence(HARNESS_NOTE_ID, document)
        if (!persistence) throw new Error('IndexedDB unavailable in the harness browser')
        await persistence.whenSynced
        document.getText('quill').insert(0, text)
        // Let y-indexeddb finish committing the update transaction.
        await new Promise(resolve => setTimeout(resolve, 400))
        persistence.destroy()
        document.destroy()
        return true
    },

    // Session 2: reopen through the REAL load path with a null storageData
    // (failed download) and an unreachable collaboration server — the content
    // must come back from IndexedDB, flagged for a Storage catch-up.
    noteOfflineReopen: async () => {
        const result = await prepareSyncedNoteDocument(null, createOfflineProvider, {
            createLocalPersistence: document => createNoteLocalPersistence(HARNESS_NOTE_ID, document),
            syncTimeout: 100,
        })
        const text = result.document.getText('quill').toString()
        const { syncedWithServer, storageNeedsLocalCatchUp } = result
        if (result.localPersistence) result.localPersistence.destroy()
        result.provider.destroy()
        result.document.destroy()
        return { text, syncedWithServer, storageNeedsLocalCatchUp }
    },

    // A note with no Storage, no local state and no server must keep the
    // caller's locked-and-retry behavior (the promise rejects).
    noteWithNothingToShowRejects: async () => {
        try {
            const result = await prepareSyncedNoteDocument(null, createOfflineProvider, {
                createLocalPersistence: document => createNoteLocalPersistence('offline-harness-empty', document),
                syncTimeout: 100,
            })
            result.provider.destroy()
            if (result.localPersistence) result.localPersistence.destroy()
            result.document.destroy()
            return false
        } catch (error) {
            return true
        }
    },
}

window.__ready = true
