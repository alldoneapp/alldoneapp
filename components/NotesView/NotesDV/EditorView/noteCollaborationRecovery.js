import * as Y from 'yjs'

import { isBrowserOffline } from '../../../../utils/connectionState'

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
export const documentHasLocalState = document => document.getText('quill').length > 0 || document.store.clients.size > 0

export const storageIsMissingLocalState = (localDocument, storageUpdate) => {
    if (!documentHasLocalState(localDocument)) return false
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
    const { createLocalPersistence, syncTimeout, allowEmptyOpen = false } = options
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

        // `storageData == null` means the canonical copy could not be READ (we
        // are offline, or the download failed) — NOT that it is empty. The
        // distinction is the whole point: a null payload is indistinguishable
        // from an empty one to `storageIsMissingLocalState`, which reports
        // "storage is missing everything" and made the caller re-upload — and
        // therefore re-stamp lastEditionDate/lastEditorId, the edited-today
        // list, the started-editing feed and the follower — every single time a
        // cached note was opened offline. Merely READING a note on a plane was
        // recorded as editing it (AT-2340).
        const storageContentAvailable = storageData !== null && storageData !== undefined
        const update = storageContentAvailable ? new Uint8Array(storageData) : new Uint8Array(0)

        // Decided BEFORE merging Storage in, while `document` holds only the
        // local offline state: does the canonical Storage copy lack anything a
        // previous offline session wrote? The caller then uploads the merged
        // state once, so the server copy catches up even if the user never
        // edits again. Only answerable when we actually hold the Storage bytes.
        const storageNeedsLocalCatchUp =
            !!localPersistence && storageContentAvailable && storageIsMissingLocalState(document, update)
        // We hold local state but could not compare it: the decision is DEFERRED
        // to the moment the canonical copy becomes readable again (the caller
        // re-checks on reconnect) instead of being guessed as "yes, upload".
        const storageCatchUpUnverified =
            !!localPersistence && !storageContentAvailable && documentHasLocalState(document)

        if (update.length > 0) Y.applyUpdate(document, update)

        const storedText = document.getText('quill')
        const storedLength = storedText.length
        const storedDelta = storedText.toDelta()

        provider = createProvider(document)
        try {
            // Offline the collaboration server is unreachable by definition —
            // waiting the full sync timeout (10s) just holds the spinner. Take
            // the offline-open decision immediately; y-websocket keeps
            // reconnecting in the background either way.
            if (isBrowserOffline()) throw new Error('Browser is offline; opening from local state')
            await waitForProviderSync(provider, syncTimeout)
        } catch (syncError) {
            // The collaboration server is unreachable (offline). The document
            // already holds the Storage and/or local IndexedDB content — open
            // from it; y-websocket keeps reconnecting and CRDT-merges with the
            // room when connectivity returns. A document with nothing anywhere
            // stays locked UNLESS the caller vouches that empty is the correct
            // content (allowEmptyOpen — a note whose content was never saved,
            // e.g. one just created offline).
            if (storedLength === 0 && !storageContentAvailable && !allowEmptyOpen) throw syncError
            return {
                document,
                provider,
                localPersistence,
                recovered: false,
                syncedWithServer: false,
                storageNeedsLocalCatchUp,
                storageCatchUpUnverified,
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

        return {
            document,
            provider,
            localPersistence,
            recovered,
            syncedWithServer: true,
            storageNeedsLocalCatchUp,
            storageCatchUpUnverified,
        }
    } catch (error) {
        provider?.destroy()
        if (localPersistence && typeof localPersistence.destroy === 'function') localPersistence.destroy()
        document.destroy()
        throw error
    }
}
