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
