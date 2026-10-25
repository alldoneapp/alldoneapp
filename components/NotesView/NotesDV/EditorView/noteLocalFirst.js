import * as Y from 'yjs'
import { documentHasLocalState, storageIsMissingLocalState, waitForProviderSync } from './noteCollaborationRecovery'

/**
 * Start local restore and network download together. A cached document may be
 * shown before either network completes; the live Y.Doc is never replaced.
 * Call dispose even while ready is pending to cancel note-switch continuations.
 */
export const createLocalFirstNoteSession = ({
    createLocalPersistence,
    createProvider,
    loadStorage,
    allowEmptyOpen = false,
    onRefresh = () => {},
    syncTimeout = 10000,
}) => {
    const document = new Y.Doc()
    let provider = null
    let persistence = null
    let disposed = false
    let storageAvailable = false
    let localSeed = null
    const syncWait = new AbortController()
    const result = () => ({ document, provider, localPersistence: persistence, storagePending: !storageAvailable })
    // Start promptly, but hold its result until IndexedDB has populated the doc.
    const download = Promise.resolve()
        .then(loadStorage)
        .then(
            data => ({ data }),
            error => ({ error })
        )
    const local = (async () => {
        try {
            persistence = createLocalPersistence?.(document) || null
            if (persistence) await persistence.whenSynced
        } catch (error) {
            console.warn('Note local persistence unavailable:', error)
            persistence?.destroy()
            persistence = null
        }
        if (disposed) throw new Error('Note session disposed')
        localSeed = Y.encodeStateAsUpdate(document)
        provider = createProvider(document)
        return result()
    })()
    const refreshed = (async () => {
        await local
        const { data, error } = await download
        if (disposed) return null
        storageAvailable = true
        if (error || data == null) {
            const refresh = { verified: false, needsUpload: false, error }
            onRefresh(refresh)
            return refresh
        }
        const update = new Uint8Array(data)
        const cached = new Y.Doc()
        let needsUpload
        try {
            Y.applyUpdate(cached, localSeed)
            needsUpload = storageIsMissingLocalState(cached, update)
        } finally {
            cached.destroy()
        }
        // Updates include delete sets. Re-inserting plain text here would
        // resurrect deleted content and duplicate concurrent inserts.
        if (update.length) Y.applyUpdate(document, update, 'remote-storage-refresh')
        const refresh = { verified: true, needsUpload }
        onRefresh(refresh)
        return refresh
    })()
    // Attach a handler now: ready may return the cache while refresh is pending.
    refreshed.catch(() => {})
    const ready = (async () => {
        await local
        if (documentHasLocalState(document) || allowEmptyOpen) return result()
        // A cold note can arrive through either Storage or the collaboration
        // room. A failed download alone must not unlock an empty stale editor.
        const storageReady = refreshed.then(refresh => {
            if (disposed || !refresh?.verified) throw new Error('Note Storage unavailable')
            return result()
        })
        const roomReady = waitForProviderSync(provider, syncTimeout, syncWait.signal).then(() => {
            if (disposed || !documentHasLocalState(document)) throw new Error('Note room has no content')
            return result()
        })
        return Promise.any([storageReady, roomReady])
    })()
    ready.then(
        () => syncWait.abort(),
        () => syncWait.abort()
    )
    return {
        ready,
        refreshed,
        dispose() {
            if (disposed) return
            disposed = true
            syncWait.abort()
            provider?.destroy()
            persistence?.destroy()
            document.destroy()
        },
    }
}
