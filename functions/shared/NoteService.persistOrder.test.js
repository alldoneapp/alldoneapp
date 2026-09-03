'use strict'

/**
 * AT-2498 — a created note's body must be in Storage BEFORE its Firestore
 * document exists.
 *
 * The document write is what fires `onCreateNote`, and that trigger indexes the
 * note by downloading `notesData/{projectId}/{noteId}`. `persistNote` used to
 * write the document first and merely kick the upload off alongside it, so the
 * two raced: a trigger that won found no file, indexed the note with an empty
 * body, and — since nothing re-indexes a note until its document changes again —
 * left the body unsearchable for good. Assistant-created notes (`create_note`,
 * contact notes, user memory, menubar/meeting notes) are all created through
 * this one method.
 */

jest.mock('firebase-admin', () => {
    const save = jest.fn(() => Promise.resolve())
    const file = jest.fn(() => ({ save }))
    const bucket = jest.fn(() => ({ file }))
    return {
        storage: jest.fn(() => ({ bucket })),
        __mock: { save, file, bucket },
    }
})

const admin = require('firebase-admin')
const { NoteService } = require('./NoteService')

const noteResult = () => ({
    note: {
        id: 'note-1',
        title: 'assistant note',
        extendedTitle: 'Assistant note',
        userId: 'user-1',
        isPublicFor: [0],
    },
    noteContent: Buffer.from([1, 2, 3]),
    feedData: null,
    noteId: 'note-1',
    success: true,
})

const createService = (calls, overrides = {}) =>
    new NoteService({
        enableFeeds: false,
        enableValidation: false,
        isCloudFunction: true,
        storageBucket: 'notescontentdev',
        authoritativeStorageBucket: true,
        database: {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    set: jest.fn(async () => {
                        calls.push('firestore.set')
                    }),
                })),
            })),
            doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })),
        },
        ...overrides,
    })

describe('persistNote ordering', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.__mock.save.mockImplementation(() => Promise.resolve())
    })

    it('uploads the note body before creating the document that triggers indexing', async () => {
        const calls = []
        admin.__mock.save.mockImplementation(async () => {
            calls.push('storage.save')
        })

        await createService(calls).persistNote(noteResult(), { projectId: 'project-1' })

        expect(calls).toEqual(['storage.save', 'firestore.set'])
    })

    it('writes the body to the resolved notes bucket at the canonical path', async () => {
        await createService([]).persistNote(noteResult(), { projectId: 'project-1' })

        expect(admin.__mock.bucket).toHaveBeenCalledWith('notescontentdev')
        expect(admin.__mock.file).toHaveBeenCalledWith('notesData/project-1/note-1')
        expect(admin.__mock.save).toHaveBeenCalledWith(expect.any(Buffer))
    })

    it('still creates the document when there is no body to store', async () => {
        const calls = []
        await createService(calls).persistNote(
            { ...noteResult(), noteContent: Buffer.alloc(0) },
            { projectId: 'project-1' }
        )

        expect(admin.__mock.save).not.toHaveBeenCalled()
        expect(calls).toEqual(['firestore.set'])
    })

    it('keeps failing the persist when the upload fails, and creates no document', async () => {
        // Unchanged from before the reorder: a rejected upload rejects out of
        // persistNote. What is new is that it can no longer leave behind a note
        // document whose body was never stored.
        const calls = []
        admin.__mock.save.mockRejectedValueOnce(new Error('storage unavailable'))

        await expect(createService(calls).persistNote(noteResult(), { projectId: 'project-1' })).rejects.toThrow(
            /storage unavailable/
        )
        expect(calls).toEqual([])
    })
})
