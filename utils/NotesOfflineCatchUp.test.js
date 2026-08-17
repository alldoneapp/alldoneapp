/**
 * AT-2340. Firebase Storage has no offline write queue, so a note edited offline
 * and then CLOSED used to sit stale on the server until the user happened to
 * reopen that exact note. These tests drive the reconnect sweep with real Yjs
 * documents — the merge/compare semantics are the whole point, and a mocked
 * CRDT would prove nothing.
 */
import * as Y from 'yjs'

const mockGetNoteData = jest.fn()
const mockPut = jest.fn()
const mockChild = jest.fn(() => ({ put: mockPut }))
let mockStoreState = { activeNoteId: '' }
let mockBrowserOffline = false
let mockSeededLocalStateByNote = {}

jest.mock('./BackendBridge', () => ({
    __esModule: true,
    default: { getNoteData: (...args) => mockGetNoteData(...args) },
}))
jest.mock('./backends/firestore', () => ({ notesStorage: { ref: () => ({ child: (...args) => mockChild(...args) }) } }))
jest.mock('../redux/store', () => ({ __esModule: true, default: { getState: () => mockStoreState } }))
jest.mock('./connectionState', () => ({ isBrowserOffline: () => mockBrowserOffline }))
jest.mock('../components/NotesView/NotesDV/EditorView/noteLocalPersistence', () => ({
    createNoteLocalPersistence: (noteId, document) => {
        const seed = mockSeededLocalStateByNote[noteId]
        if (seed === undefined) return null
        if (seed) require('yjs').applyUpdate(document, seed)
        return { whenSynced: Promise.resolve(), destroy: jest.fn() }
    },
}))

const { runNotesOfflineCatchUp, resolveNoteCatchUpState } = require('./NotesOfflineCatchUp')
const { registerPendingNoteUpload, readPendingNoteUploads } = require('./Notes/pendingNoteUploads')

const encodeText = text => {
    const document = new Y.Doc()
    document.getText('quill').insert(0, text)
    const update = Y.encodeStateAsUpdate(document)
    document.destroy()
    return update
}

const textOf = update => {
    const document = new Y.Doc()
    Y.applyUpdate(document, update)
    const text = document.getText('quill').toString()
    document.destroy()
    return text
}

describe('NotesOfflineCatchUp', () => {
    beforeEach(() => {
        localStorage.clear()
        jest.clearAllMocks()
        mockStoreState = { activeNoteId: '' }
        mockBrowserOffline = false
        mockSeededLocalStateByNote = {}
        mockPut.mockResolvedValue(undefined)
    })

    it('uploads a note the canonical copy is behind on, and clears it from the registry', async () => {
        const storageState = encodeText('Base')
        const localDocument = new Y.Doc()
        Y.applyUpdate(localDocument, storageState)
        localDocument.getText('quill').insert(4, ' plus an offline edit')
        mockSeededLocalStateByNote['note-a'] = Y.encodeStateAsUpdate(localDocument)
        localDocument.destroy()

        mockGetNoteData.mockResolvedValue(storageState)
        registerPendingNoteUpload('project-1', 'note-a')

        await runNotesOfflineCatchUp()

        expect(mockChild).toHaveBeenCalledWith('notesData/project-1/note-a')
        expect(mockPut).toHaveBeenCalledTimes(1)
        expect(textOf(mockPut.mock.calls[0][0])).toBe('Base plus an offline edit')
        expect(readPendingNoteUploads()).toEqual([])
    })

    it('writes nothing when the server already has the local state', async () => {
        const storageState = encodeText('Already synced')
        mockSeededLocalStateByNote['note-a'] = storageState
        mockGetNoteData.mockResolvedValue(storageState)
        registerPendingNoteUpload('project-1', 'note-a')

        await runNotesOfflineCatchUp()

        expect(mockPut).not.toHaveBeenCalled()
        // Verified as unnecessary, so the entry is retired rather than retried forever.
        expect(readPendingNoteUploads()).toEqual([])
    })

    it('merges the canonical copy in rather than clobbering an edit made elsewhere', async () => {
        // We were offline; someone else edited the same note through the collab
        // server, and their change reached Storage. A blind re-upload of our
        // local state would erase it.
        const base = encodeText('Base')

        const ourDocument = new Y.Doc()
        Y.applyUpdate(ourDocument, base)
        ourDocument.getText('quill').insert(4, ' OURS')
        mockSeededLocalStateByNote['note-a'] = Y.encodeStateAsUpdate(ourDocument)
        ourDocument.destroy()

        const theirDocument = new Y.Doc()
        Y.applyUpdate(theirDocument, base)
        theirDocument.getText('quill').insert(0, 'THEIRS ')
        mockGetNoteData.mockResolvedValue(Y.encodeStateAsUpdate(theirDocument))
        theirDocument.destroy()

        registerPendingNoteUpload('project-1', 'note-a')
        await runNotesOfflineCatchUp()

        const uploaded = textOf(mockPut.mock.calls[0][0])
        expect(uploaded).toContain('OURS')
        expect(uploaded).toContain('THEIRS')
    })

    it('never touches the note open in the live editor', async () => {
        mockSeededLocalStateByNote['note-a'] = encodeText('Being edited right now')
        mockStoreState = { activeNoteId: 'note-a' }
        registerPendingNoteUpload('project-1', 'note-a')

        await runNotesOfflineCatchUp()

        expect(mockGetNoteData).not.toHaveBeenCalled()
        expect(mockPut).not.toHaveBeenCalled()
        // Left registered: the editor owns that store and does its own verified
        // catch-up, but if it closes without one this sweep still gets a turn.
        expect(readPendingNoteUploads()).toHaveLength(1)
    })

    it('keeps the entry when the canonical copy cannot be read', async () => {
        mockSeededLocalStateByNote['note-a'] = encodeText('Offline edit')
        mockGetNoteData.mockRejectedValue(new Error('network down'))
        registerPendingNoteUpload('project-1', 'note-a')

        await runNotesOfflineCatchUp()

        expect(mockPut).not.toHaveBeenCalled()
        expect(readPendingNoteUploads()).toHaveLength(1)
    })

    it('keeps the entry when the upload itself fails', async () => {
        mockSeededLocalStateByNote['note-a'] = encodeText('Offline edit')
        mockGetNoteData.mockResolvedValue(new Uint8Array(0))
        mockPut.mockRejectedValue(new Error('storage unreachable'))
        registerPendingNoteUpload('project-1', 'note-a')

        await runNotesOfflineCatchUp()

        expect(readPendingNoteUploads()).toHaveLength(1)
    })

    it('does nothing while the browser is offline', async () => {
        mockBrowserOffline = true
        mockSeededLocalStateByNote['note-a'] = encodeText('Offline edit')
        registerPendingNoteUpload('project-1', 'note-a')

        await runNotesOfflineCatchUp()

        expect(mockGetNoteData).not.toHaveBeenCalled()
        expect(readPendingNoteUploads()).toHaveLength(1)
    })

    it('does no work at all when nothing is pending', async () => {
        await runNotesOfflineCatchUp()

        expect(mockGetNoteData).not.toHaveBeenCalled()
        expect(mockPut).not.toHaveBeenCalled()
    })

    it('reports nothing to upload when the browser has no local durability', async () => {
        // createNoteLocalPersistence returns null (no IndexedDB): there is no
        // local copy that could be ahead of anything.
        expect(await resolveNoteCatchUpState('unknown-note', new Uint8Array(0))).toBeNull()
    })
})
