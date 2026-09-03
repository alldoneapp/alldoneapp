/**
 * AT-2498 — a new note is indexed by the CREATE trigger, and that indexing is the
 * only thing standing between an assistant-created note and search. It has to be
 * awaited.
 *
 * `onCreateNote` collected its work into a `promises` array and then never
 * awaited it, so `createRecord` — which downloads the note body from Storage and
 * upserts it into Typesense — was fire-and-forget. Two consequences: Cloud Run
 * may freeze the container the moment the function returns, and any indexing
 * failure surfaced as an unhandled rejection rather than a failed invocation.
 * The second is why a production `storage.objects.get denied` on literally every
 * note create went unnoticed for days.
 */

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({})),
}))

jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    NOTES_OBJECTS_TYPE: 'notes',
    createRecord: jest.fn(() => Promise.resolve()),
}))

jest.mock('../NotesRevisionHistory', () => ({
    processCreatedNoteForRevisionHistory: jest.fn(() => Promise.resolve()),
}))

const { createRecord } = require('../AlgoliaGlobalSearchHelper')
const { processCreatedNoteForRevisionHistory } = require('../NotesRevisionHistory')
const { onCreateNote } = require('./onCreateNoteFunctions')

const note = { id: 'note-1', title: 'a note' }

describe('onCreateNote', () => {
    beforeEach(() => jest.clearAllMocks())

    it('indexes the new note', async () => {
        await onCreateNote('p1', note)

        expect(createRecord).toHaveBeenCalledWith('p1', 'note-1', note, 'notes', expect.anything(), false, null)
    })

    it('does not resolve until indexing has actually finished', async () => {
        let releaseIndexing
        let indexingFinished = false
        createRecord.mockReturnValueOnce(
            new Promise(resolve => {
                releaseIndexing = () => {
                    indexingFinished = true
                    resolve()
                }
            })
        )

        let handlerFinished = false
        const handler = onCreateNote('p1', note).then(() => {
            handlerFinished = true
        })

        await Promise.resolve()
        expect(handlerFinished).toBe(false)

        releaseIndexing()
        await handler

        expect(indexingFinished).toBe(true)
        expect(handlerFinished).toBe(true)
    })

    it('waits for revision history too', async () => {
        let releaseRevision
        processCreatedNoteForRevisionHistory.mockReturnValueOnce(
            new Promise(resolve => {
                releaseRevision = resolve
            })
        )

        let handlerFinished = false
        const handler = onCreateNote('p1', note).then(() => {
            handlerFinished = true
        })

        await Promise.resolve()
        expect(handlerFinished).toBe(false)

        releaseRevision()
        await handler
        expect(handlerFinished).toBe(true)
    })

    it('reports an indexing failure to the platform instead of swallowing it', async () => {
        // A rejection here used to be an unhandled rejection on a function that had
        // already returned "success" — the shape of the AT-2498 outage.
        createRecord.mockRejectedValueOnce(new Error('storage.objects.get denied'))

        await expect(onCreateNote('p1', note)).rejects.toThrow('storage.objects.get denied')
    })
})
