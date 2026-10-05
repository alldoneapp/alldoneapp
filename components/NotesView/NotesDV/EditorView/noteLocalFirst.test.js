import * as Y from 'yjs'
import { createLocalFirstNoteSession } from './noteLocalFirst'
jest.mock('../../../../utils/connectionState', () => ({ isBrowserOffline: () => false }))

const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((r, j) => {
        resolve = r
        reject = j
    })
    return { promise, resolve, reject }
}
const seed = text => {
    const doc = new Y.Doc()
    doc.getText('quill').insert(0, text)
    return doc
}
const offlineProvider = () => ({ synced: false, on: jest.fn(), off: jest.fn(), destroy: jest.fn() })

it('shows the cached note while Storage and WebSocket are still pending, then unions concurrent edits', async () => {
    const cached = seed('Original')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(cached))
    remote.getText('quill').insert(0, 'Remote ')
    cached.getText('quill').insert(cached.getText('quill').length, ' Cached')
    const download = deferred()
    const refresh = jest.fn()
    const session = createLocalFirstNoteSession({
        createLocalPersistence: doc => {
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(cached))
            return { whenSynced: Promise.resolve(), destroy: jest.fn() }
        },
        createProvider: offlineProvider,
        loadStorage: () => download.promise,
        onRefresh: refresh,
    })
    const ready = await session.ready
    expect(ready.document.getText('quill').toString()).toBe('Original Cached')
    expect(refresh).not.toHaveBeenCalled()
    ready.document.getText('quill').insert(ready.document.getText('quill').length, ' Local')
    download.resolve(Y.encodeStateAsUpdate(remote))
    await session.refreshed
    expect(ready.document.getText('quill').toString()).toBe('Remote Original Cached Local')
    expect(refresh).toHaveBeenCalledWith({ verified: true, needsUpload: true })
    session.dispose()
    cached.destroy()
    remote.destroy()
})
it('keeps local deletions when the downloaded state is stale', async () => {
    const original = seed('abcdef')
    const storage = Y.encodeStateAsUpdate(original)
    original.getText('quill').delete(1, 3)
    const session = createLocalFirstNoteSession({
        createLocalPersistence: doc => {
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(original))
            return { whenSynced: Promise.resolve(), destroy: jest.fn() }
        },
        createProvider: offlineProvider,
        loadStorage: () => storage,
    })
    const ready = await session.ready
    await session.refreshed
    expect(ready.document.getText('quill').toString()).toBe('aef')
    session.dispose()
    original.destroy()
})
it('opens a known empty note offline but keeps an uncached existing note locked on both failures', async () => {
    const empty = createLocalFirstNoteSession({
        createProvider: offlineProvider,
        loadStorage: () => null,
        allowEmptyOpen: true,
    })
    await expect(empty.ready).resolves.toHaveProperty('document')
    empty.dispose()
    const absent = createLocalFirstNoteSession({
        createProvider: offlineProvider,
        loadStorage: () => null,
        syncTimeout: 5,
    })
    await expect(absent.ready).rejects.toThrow()
    absent.dispose()
})
it('does not call old-note continuations after a switch during background download', async () => {
    const download = deferred()
    const refresh = jest.fn()
    const session = createLocalFirstNoteSession({
        createProvider: offlineProvider,
        loadStorage: () => download.promise,
        allowEmptyOpen: true,
        onRefresh: refresh,
    })
    await session.ready
    session.dispose()
    session.dispose()
    const remote = seed('old note')
    download.resolve(Y.encodeStateAsUpdate(remote))
    await session.refreshed
    expect(refresh).not.toHaveBeenCalled()
    remote.destroy()
})
it('allows Storage to open a cold note without waiting for the room and tolerates unavailable IndexedDB', async () => {
    const remote = seed('cold')
    const session = createLocalFirstNoteSession({
        createLocalPersistence: () => null,
        createProvider: offlineProvider,
        loadStorage: () => Y.encodeStateAsUpdate(remote),
        syncTimeout: 5,
    })
    const ready = await session.ready
    expect(ready.document.getText('quill').toString()).toBe('cold')
    session.dispose()
    remote.destroy()
})
it('marks a cached offline read as unverified rather than as a new edit', async () => {
    const cached = seed('cached')
    const refresh = jest.fn()
    const session = createLocalFirstNoteSession({
        createLocalPersistence: doc => {
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(cached))
            return { whenSynced: Promise.resolve(), destroy: jest.fn() }
        },
        createProvider: offlineProvider,
        loadStorage: () => null,
        onRefresh: refresh,
    })
    await session.ready
    await session.refreshed
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ verified: false, needsUpload: false }))
    session.dispose()
    cached.destroy()
})
it('cancels a note switch while IndexedDB is still restoring, without creating a provider', async () => {
    const restore = deferred()
    const createProvider = jest.fn(offlineProvider)
    const session = createLocalFirstNoteSession({
        createLocalPersistence: () => ({ whenSynced: restore.promise, destroy: jest.fn() }),
        createProvider,
        loadStorage: () => null,
        allowEmptyOpen: true,
    })
    session.dispose()
    restore.resolve()
    await expect(session.ready).rejects.toThrow('disposed')
    expect(createProvider).not.toHaveBeenCalled()
})
it('honors remote deletion tombstones instead of resurrecting an older cached note', async () => {
    const original = seed('delete me')
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(original))
    remote.getText('quill').delete(0, 9)
    const session = createLocalFirstNoteSession({
        createLocalPersistence: doc => {
            Y.applyUpdate(doc, Y.encodeStateAsUpdate(original))
            return { whenSynced: Promise.resolve(), destroy: jest.fn() }
        },
        createProvider: offlineProvider,
        loadStorage: () => Y.encodeStateAsUpdate(remote),
    })
    const ready = await session.ready
    await session.refreshed
    expect(ready.document.getText('quill').toString()).toBe('')
    session.dispose()
    original.destroy()
    remote.destroy()
})
