import {
    clearAllPendingNoteUploads,
    clearPendingNoteUpload,
    hasPendingNoteUpload,
    readPendingNoteUploads,
    registerPendingNoteUpload,
} from './pendingNoteUploads'

describe('pendingNoteUploads', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('records a note whose content upload failed, with its project', () => {
        registerPendingNoteUpload('project-1', 'note-a')

        expect(hasPendingNoteUpload('note-a')).toBe(true)
        expect(readPendingNoteUploads()).toEqual([
            expect.objectContaining({ noteId: 'note-a', projectId: 'project-1' }),
        ])
    })

    it('clears an entry once the content reaches Storage', () => {
        registerPendingNoteUpload('project-1', 'note-a')
        clearPendingNoteUpload('note-a')

        expect(hasPendingNoteUpload('note-a')).toBe(false)
        expect(readPendingNoteUploads()).toEqual([])
    })

    it('keeps the original registration time across repeated failures', () => {
        registerPendingNoteUpload('project-1', 'note-a')
        const [first] = readPendingNoteUploads()

        registerPendingNoteUpload('project-1', 'note-a')
        const [second] = readPendingNoteUploads()

        // Re-stamping would let a note that keeps failing outlive older entries
        // forever once the registry hits its bound.
        expect(second.registeredAt).toBe(first.registeredAt)
        expect(readPendingNoteUploads()).toHaveLength(1)
    })

    it('ignores incomplete registrations rather than producing unusable entries', () => {
        registerPendingNoteUpload('', 'note-a')
        registerPendingNoteUpload('project-1', '')

        expect(readPendingNoteUploads()).toEqual([])
    })

    it('survives unreadable storage contents', () => {
        localStorage.setItem('alldone_notes_pending_upload_v1', 'not json')

        expect(readPendingNoteUploads()).toEqual([])
        expect(hasPendingNoteUpload('note-a')).toBe(false)
    })

    it('clears everything on request', () => {
        registerPendingNoteUpload('project-1', 'note-a')
        registerPendingNoteUpload('project-2', 'note-b')
        clearAllPendingNoteUploads()

        expect(readPendingNoteUploads()).toEqual([])
    })
})
