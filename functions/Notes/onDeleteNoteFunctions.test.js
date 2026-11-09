/**
 * NV-39 (security audit 2026-11) — a note's daily copy outlives the note document.
 *
 * storage.rules no longer lets any client reach a note version copy once its note document is
 * gone (the membership fallback is reserved for the live body in the notes bucket), so the daily
 * copy of a deleted or moved note is dead data holding the pre-restore body. onDeleteNote removes
 * it with the live body instead of leaving it to the next midnight run.
 */

const mockFiles = {}
const mockBucketNames = []

const mockFile = path => {
    if (!mockFiles[path]) {
        mockFiles[path] = {
            exists: jest.fn(() => Promise.resolve([false])),
            delete: jest.fn(() => Promise.resolve()),
        }
    }
    return mockFiles[path]
}

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: () => ({ where: () => ({ get: () => Promise.resolve({ docs: [] }) }) }),
        doc: () => ({ delete: () => Promise.resolve(), update: () => Promise.resolve() }),
    })),
    storage: jest.fn(() => ({
        bucket: jest.fn(name => {
            mockBucketNames.push(name)
            return { file: path => mockFile(`${name || 'default'}:${path}`) }
        }),
    })),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { arrayRemove: jest.fn() } }))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({ NOTES_OBJECTS_TYPE: 'notes', deleteRecord: jest.fn() }))
jest.mock('../Backlinks/backlinksHelper', () => ({ removeObjectFromBacklinks: jest.fn() }))
jest.mock('../Chats/chatsFirestoreCloud', () => ({ deleteChat: jest.fn() }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getProject: jest.fn(() => Promise.resolve(null)) }))
jest.mock('../NotesRevisionHistory', () => ({ processDeletedNoteForRevisionHistory: jest.fn() }))
jest.mock('./notesFirestoreCloud', () => ({ deleteNote: jest.fn() }))
jest.mock('../shared/notesStorageBucket', () => ({ getNotesBucketName: () => 'notescontenttest' }))

const { onDeleteNote, removeNoteDailyCopy } = require('./onDeleteNoteFunctions')

describe('onDeleteNote and the daily note copy', () => {
    beforeEach(() => {
        Object.keys(mockFiles).forEach(key => delete mockFiles[key])
        mockBucketNames.length = 0
    })

    it('deletes the daily copy of a deleted note from the default bucket', async () => {
        await onDeleteNote('p1', { id: 'n1' })

        const dailyCopy = mockFiles['default:noteDailyVersionsData/p1/n1']
        expect(dailyCopy).toBeDefined()
        expect(dailyCopy.delete).toHaveBeenCalledWith({ ignoreNotFound: true })
    })

    it('deletes the old project copy of a moved note as well', async () => {
        await onDeleteNote('p1', { id: 'n1', movingToOtherProjectId: 'p2' })

        expect(mockFiles['default:noteDailyVersionsData/p1/n1'].delete).toHaveBeenCalled()
        expect(mockFiles['default:noteDailyVersionsData/p2/n1']).toBeUndefined()
    })

    it('never throws into the trigger when the delete fails', async () => {
        mockFile('default:noteDailyVersionsData/p1/n1').delete.mockRejectedValueOnce(new Error('boom'))
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(removeNoteDailyCopy('p1', 'n1')).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    it('leaves the version snapshots to their one-week retention', async () => {
        await onDeleteNote('p1', { id: 'n1' })

        expect(Object.keys(mockFiles).some(key => key.includes('noteVersionsData/'))).toBe(false)
    })
})
