import * as Y from 'yjs'

import { hasDestructiveCollaborationSync, prepareSyncedNoteDocument } from './noteCollaborationRecovery'

const createSyncedProviderFactory = roomUpdate => {
    const providers = []
    const createProvider = document => {
        Y.applyUpdate(document, roomUpdate)
        const provider = {
            synced: true,
            destroy: jest.fn(),
        }
        providers.push(provider)
        return provider
    }
    return { createProvider, providers }
}

const createStoredAndDeletedRoomUpdates = text => {
    const storedDocument = new Y.Doc()
    storedDocument.getText('quill').insert(0, text)
    const storageUpdate = Y.encodeStateAsUpdate(storedDocument)

    const roomDocument = new Y.Doc()
    Y.applyUpdate(roomDocument, storageUpdate)
    roomDocument.getText('quill').delete(0, text.length)
    const roomUpdate = Y.encodeStateAsUpdate(roomDocument)

    storedDocument.destroy()
    roomDocument.destroy()
    return { storageUpdate, roomUpdate }
}

describe('noteCollaborationRecovery', () => {
    it('detects when collaboration removes a non-empty stored note', () => {
        expect(hasDestructiveCollaborationSync(280, 1)).toBe(true)
        expect(hasDestructiveCollaborationSync(280, 100)).toBe(false)
        expect(hasDestructiveCollaborationSync(0, 0)).toBe(false)
    })

    it('recreates stored content with fresh Yjs identities after a destructive room sync', async () => {
        const { storageUpdate, roomUpdate } = createStoredAndDeletedRoomUpdates('Stored note content')
        const { createProvider, providers } = createSyncedProviderFactory(roomUpdate)

        const result = await prepareSyncedNoteDocument(storageUpdate, createProvider)

        expect(result.recovered).toBe(true)
        expect(result.document.getText('quill').toString()).toBe('Stored note content')
        expect(providers).toHaveLength(1)
        expect(providers[0].destroy).not.toHaveBeenCalled()

        result.provider.destroy()
        result.document.destroy()
    })

    it('keeps the original Yjs document when collaboration does not remove its content', async () => {
        const storedDocument = new Y.Doc()
        storedDocument.getText('quill').insert(0, 'Stored note content')
        const storageUpdate = Y.encodeStateAsUpdate(storedDocument)
        const emptyRoom = Y.encodeStateAsUpdate(new Y.Doc())
        const { createProvider, providers } = createSyncedProviderFactory(emptyRoom)

        const result = await prepareSyncedNoteDocument(storageUpdate, createProvider)

        expect(result.recovered).toBe(false)
        expect(result.document.getText('quill').toString()).toBe('Stored note content')
        expect(providers).toHaveLength(1)

        result.provider.destroy()
        result.document.destroy()
        storedDocument.destroy()
    })
})

describe('offline open with local persistence (OFFLINE_SUPPORT_PLAN.md Stage 6)', () => {
    const SYNC_TIMEOUT_FOR_TESTS = 20

    const createOfflineProvider = () => ({
        synced: false,
        on: jest.fn(),
        off: jest.fn(),
        destroy: jest.fn(),
    })

    const createLocalPersistenceStub = seedUpdate => {
        const persistence = { destroy: jest.fn() }
        const factory = document => {
            if (seedUpdate) Y.applyUpdate(document, seedUpdate)
            persistence.whenSynced = Promise.resolve()
            return persistence
        }
        return { factory, persistence }
    }

    const encodeText = text => {
        const doc = new Y.Doc()
        doc.getText('quill').insert(0, text)
        const update = Y.encodeStateAsUpdate(doc)
        doc.destroy()
        return update
    }

    it('opens from Storage content when the collaboration server is unreachable', async () => {
        const storageUpdate = encodeText('Stored note content')

        const result = await prepareSyncedNoteDocument(storageUpdate, createOfflineProvider, {
            syncTimeout: SYNC_TIMEOUT_FOR_TESTS,
        })

        expect(result.syncedWithServer).toBe(false)
        expect(result.document.getText('quill').toString()).toBe('Stored note content')
        result.provider.destroy()
        result.document.destroy()
    })

    it('opens from local IndexedDB state when Storage AND the server are unreachable', async () => {
        const { factory } = createLocalPersistenceStub(encodeText('Offline note content'))

        const result = await prepareSyncedNoteDocument(null, createOfflineProvider, {
            createLocalPersistence: factory,
            syncTimeout: SYNC_TIMEOUT_FOR_TESTS,
        })

        expect(result.syncedWithServer).toBe(false)
        expect(result.document.getText('quill').toString()).toBe('Offline note content')
        result.provider.destroy()
        result.document.destroy()
    })

    it('opens EMPTY when the caller vouches the note was never saved (allowEmptyOpen)', async () => {
        const { factory } = createLocalPersistenceStub(null)

        const result = await prepareSyncedNoteDocument(null, createOfflineProvider, {
            createLocalPersistence: factory,
            syncTimeout: SYNC_TIMEOUT_FOR_TESTS,
            allowEmptyOpen: true,
        })

        expect(result.syncedWithServer).toBe(false)
        expect(result.document.getText('quill').toString()).toBe('')
        result.provider.destroy()
        result.document.destroy()
    })

    it('still locks the editor when there is truly nothing to show', async () => {
        const { factory, persistence } = createLocalPersistenceStub(null)

        await expect(
            prepareSyncedNoteDocument(null, createOfflineProvider, {
                createLocalPersistence: factory,
                syncTimeout: SYNC_TIMEOUT_FOR_TESTS,
            })
        ).rejects.toThrow()
        expect(persistence.destroy).toHaveBeenCalled()
    })

    it('flags a catch-up save when Storage lacks offline additions', async () => {
        const storageUpdate = encodeText('Base')
        const localDoc = new Y.Doc()
        Y.applyUpdate(localDoc, storageUpdate)
        localDoc.getText('quill').insert(4, ' plus offline edit')
        const { factory } = createLocalPersistenceStub(Y.encodeStateAsUpdate(localDoc))
        localDoc.destroy()

        const { createProvider } = createSyncedProviderFactory(storageUpdate)
        const result = await prepareSyncedNoteDocument(storageUpdate, createProvider, {
            createLocalPersistence: factory,
        })

        expect(result.storageNeedsLocalCatchUp).toBe(true)
        expect(result.document.getText('quill').toString()).toBe('Base plus offline edit')
        result.provider.destroy()
        result.document.destroy()
    })

    it('flags a catch-up save when the offline edit was a deletion', async () => {
        const storageUpdate = encodeText('Delete me')
        const localDoc = new Y.Doc()
        Y.applyUpdate(localDoc, storageUpdate)
        localDoc.getText('quill').delete(0, 7)
        const { factory } = createLocalPersistenceStub(Y.encodeStateAsUpdate(localDoc))
        localDoc.destroy()

        const { createProvider } = createSyncedProviderFactory(storageUpdate)
        const result = await prepareSyncedNoteDocument(storageUpdate, createProvider, {
            createLocalPersistence: factory,
        })

        expect(result.storageNeedsLocalCatchUp).toBe(true)
        result.provider.destroy()
        result.document.destroy()
    })

    it('does not flag a catch-up save when Storage already has everything', async () => {
        const storageUpdate = encodeText('Stored note content')
        const { factory } = createLocalPersistenceStub(storageUpdate)

        const { createProvider } = createSyncedProviderFactory(storageUpdate)
        const result = await prepareSyncedNoteDocument(storageUpdate, createProvider, {
            createLocalPersistence: factory,
        })

        expect(result.storageNeedsLocalCatchUp).toBe(false)
        result.provider.destroy()
        result.document.destroy()
    })

    // AT-2340. Offline the Storage download is skipped entirely, so `storageData`
    // is null — which is "could not read", NOT "is empty". Treating the two the
    // same made every offline OPEN of a cached note report "storage is missing
    // everything", which fired a full autosave: preview + lastEditionDate +
    // lastEditorId, the edited-today list, the started-editing feed, the
    // linked-parent write and tryAddFollower. Reading a note on a plane was
    // recorded as having edited it, once those queued writes flushed.
    it('does NOT flag a catch-up save when the canonical copy could not be read', async () => {
        const localState = encodeText('Content only this device has seen')
        const { factory } = createLocalPersistenceStub(localState)

        const result = await prepareSyncedNoteDocument(null, createOfflineProvider, {
            createLocalPersistence: factory,
            syncTimeout: SYNC_TIMEOUT_FOR_TESTS,
        })

        expect(result.storageNeedsLocalCatchUp).toBe(false)
        // ...but the question is remembered, not dropped: the caller re-asks it
        // against the real Storage copy on reconnect.
        expect(result.storageCatchUpUnverified).toBe(true)
        result.provider.destroy()
        result.document.destroy()
    })

    it('does not defer a decision for a note with no local state at all', async () => {
        const { factory } = createLocalPersistenceStub(null)

        const result = await prepareSyncedNoteDocument(null, createOfflineProvider, {
            createLocalPersistence: factory,
            syncTimeout: SYNC_TIMEOUT_FOR_TESTS,
            allowEmptyOpen: true,
        })

        expect(result.storageNeedsLocalCatchUp).toBe(false)
        expect(result.storageCatchUpUnverified).toBe(false)
        result.provider.destroy()
        result.document.destroy()
    })

    it('still flags a catch-up when Storage was READ and is genuinely empty', async () => {
        // An empty ArrayBuffer is a successful read of a never-saved note, and is
        // decidable: local really is ahead. Only `null` is undecidable.
        const localState = encodeText('Written offline before the first save')
        const { factory } = createLocalPersistenceStub(localState)

        // An empty room: the provider syncs but contributes nothing (applying a
        // zero-length update is not a valid Yjs decode).
        const createEmptyRoomProvider = () => ({ synced: true, on: jest.fn(), off: jest.fn(), destroy: jest.fn() })
        const result = await prepareSyncedNoteDocument(new Uint8Array(0), createEmptyRoomProvider, {
            createLocalPersistence: factory,
        })

        expect(result.storageNeedsLocalCatchUp).toBe(true)
        expect(result.storageCatchUpUnverified).toBe(false)
        result.provider.destroy()
        result.document.destroy()
    })

    it('continues without local persistence when the factory throws', async () => {
        const storageUpdate = encodeText('Stored note content')
        const { createProvider } = createSyncedProviderFactory(storageUpdate)

        const result = await prepareSyncedNoteDocument(storageUpdate, createProvider, {
            createLocalPersistence: () => {
                throw new Error('IndexedDB unavailable')
            },
        })

        expect(result.localPersistence).toBeNull()
        expect(result.document.getText('quill').toString()).toBe('Stored note content')
        result.provider.destroy()
        result.document.destroy()
    })
})
