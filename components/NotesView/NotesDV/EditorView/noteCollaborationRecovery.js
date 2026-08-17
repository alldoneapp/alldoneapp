import * as Y from 'yjs'

const SYNC_TIMEOUT = 10000

export const waitForProviderSync = (provider, timeout = SYNC_TIMEOUT) => {
    if (provider.synced) return Promise.resolve()

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeoutHandle)
            provider.off('synced', onSynced)
        }
        const onSynced = synced => {
            if (synced) {
                cleanup()
                resolve()
            }
        }
        const timeoutHandle = setTimeout(() => {
            cleanup()
            reject(new Error('Timed out while synchronizing note content'))
        }, timeout)

        provider.on('synced', onSynced)
        if (provider.synced) onSynced(true)
    })
}

export const hasDestructiveCollaborationSync = (storedLength, syncedLength) => {
    return storedLength > 1 && syncedLength <= 1
}

/**
 * Would merging the offline document's state into the canonical Storage copy
 * change it? Detected by applying the local state onto a throwaway doc built
 * from the Storage bytes and comparing encodings — this catches deletions too
 * (a delete-set difference changes the encoding), which a bare state-vector
 * diff would over-report on every open. Deterministic because Yjs encodes the
 * same internal state to the same bytes.
 */
const storageIsMissingLocalState = (localDocument, storageUpdate) => {
    if (localDocument.getText('quill').length === 0 && localDocument.store.clients.size === 0) return false
    if (storageUpdate.length === 0) return true
    const storageDocument = new Y.Doc()
    try {
        Y.applyUpdate(storageDocument, storageUpdate)
        const before = Y.encodeStateAsUpdate(storageDocument)
        Y.applyUpdate(storageDocument, Y.encodeStateAsUpdate(localDocument))
        const after = Y.encodeStateAsUpdate(storageDocument)
        if (before.length !== after.length) return true
        return before.some((byte, index) => byte !== after[index])
    } finally {
        storageDocument.destroy()
    }
}

/**
 * `storageData` may be null (OFFLINE_SUPPORT_PLAN.md Stage 6): the Firebase
 * Storage download failed — offline, most likely. The document then opens from
 * the local IndexedDB state (`createLocalPersistence`) and/or the collaboration
 * server. Only a document with nothing at all to show still throws, keeping the
 * caller's locked-and-retry behavior for the genuinely empty case.
 */
export const prepareSyncedNoteDocument = async (storageData, createProvider, options = {}) => {
    const { createLocalPersistence, syncTimeout } = options
    let document = new Y.Doc()
    let provider
    let localPersistence = null

    try {
        if (createLocalPersistence) {
            // Local persistence is an enhancement, never a blocker: a browser
            // without IndexedDB (factory returns null) or a failing open just
            // means no offline durability for this session.
            try {
                localPersistence = createLocalPersistence(document) || null
                if (localPersistence) await localPersistence.whenSynced
            } catch (error) {
                console.warn('Note local persistence unavailable, continuing without it:', error)
                if (localPersistence && typeof localPersistence.destroy === 'function') localPersistence.destroy()
                localPersistence = null
            }
        }

        const update = storageData ? new Uint8Array(storageData) : new Uint8Array(0)

        // Decided BEFORE merging Storage in, while `document` holds only the
        // local offline state: does the canonical Storage copy lack anything a
        // previous offline session wrote? The caller then uploads the merged
        // state once, so the server copy catches up even if the user never
        // edits again.
        const storageNeedsLocalCatchUp = localPersistence ? storageIsMissingLocalState(document, update) : false

        if (update.length > 0) Y.applyUpdate(document, update)

        const storedText = document.getText('quill')
        const storedLength = storedText.length
        const storedDelta = storedText.toDelta()

        provider = createProvider(document)
        try {
            await waitForProviderSync(provider, syncTimeout)
        } catch (syncError) {
            // The collaboration server is unreachable (offline). The document
            // already holds the Storage and/or local IndexedDB content — open
            // from it; y-websocket keeps reconnecting and CRDT-merges with the
            // room when connectivity returns.
            if (storedLength === 0 && !storageData) throw syncError
            return {
                document,
                provider,
                localPersistence,
                recovered: false,
                syncedWithServer: false,
                storageNeedsLocalCatchUp,
            }
        }

        let recovered = false
        if (hasDestructiveCollaborationSync(storedLength, document.getText('quill').length)) {
            const syncedText = document.getText('quill')
            document.transact(() => {
                if (syncedText.length > 0) syncedText.delete(0, syncedText.length)
                syncedText.applyDelta(storedDelta)
            }, 'storage-recovery')
            recovered = true

            if (syncedText.length !== storedLength) {
                throw new Error('Collaboration recovery did not restore the stored note content')
            }
        }

        return { document, provider, localPersistence, recovered, syncedWithServer: true, storageNeedsLocalCatchUp }
    } catch (error) {
        provider?.destroy()
        if (localPersistence && typeof localPersistence.destroy === 'function') localPersistence.destroy()
        document.destroy()
        throw error
    }
}
