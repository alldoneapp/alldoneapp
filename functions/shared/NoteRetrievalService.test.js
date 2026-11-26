'use strict'

const {
    NoteRetrievalService,
    DEFAULT_NOTE_LIMIT,
    MAX_NOTE_LIMIT,
    NOTE_PREVIEW_MAX_LENGTH,
} = require('./NoteRetrievalService')

describe('NoteRetrievalService list results', () => {
    test('uses a default of 20 and caps requested list results at 50', () => {
        expect(DEFAULT_NOTE_LIMIT).toBe(20)
        expect(MAX_NOTE_LIMIT).toBe(50)
        expect(NoteRetrievalService.normalizeLimit(undefined)).toBe(20)
        expect(NoteRetrievalService.normalizeLimit(500)).toBe(50)
    })

    test('a short note keeps its whole text as contentPreview, marked as not truncated', () => {
        const service = new NoteRetrievalService({ database: {} })
        const result = service.mapNote({ noteId: 'note-1', title: 'Short' }, { id: 'project-1' }, 'Just\nthis')

        expect(result.contentPreview).toBe('Just this')
        expect(result.contentPreviewTruncated).toBe(false)
        expect(result).not.toHaveProperty('contentPreviewUnavailable')
    })

    test('a note whose body could not be read has an empty preview marked unavailable, not an error text', () => {
        const service = new NoteRetrievalService({ database: {} })
        const result = service.mapNote({ noteId: 'note-1', title: 'Broken' }, { id: 'project-1' }, null)

        expect(result.contentPreview).toBe('')
        expect(result.contentPreviewUnavailable).toBe(true)
        expect(result.wordCount).toBe(0)
    })

    test('getNotes lists metadata with contentPreview only', async () => {
        const service = new NoteRetrievalService({ database: {} })
        jest.spyOn(service, 'resolveProjectTarget').mockResolvedValue({
            projects: [{ id: 'project-1', name: 'Product' }],
            targetProject: { id: 'project-1', name: 'Product' },
        })
        jest.spyOn(service, 'getProjectNotes').mockResolvedValue([
            { noteId: 'old', title: 'Old', lastEditionDate: 1 },
            { noteId: 'new', title: 'New', lastEditionDate: 2 },
        ])
        jest.spyOn(service, 'loadNoteContent').mockImplementation(async (projectId, noteId) =>
            noteId === 'new' ? 'x '.repeat(1000) : 'short'
        )

        const result = await service.getNotes({ userId: 'user-1', projectId: 'project-1' })

        expect(result.notes.map(note => note.id)).toEqual(['new', 'old'])
        expect(result.notes[0].contentPreviewTruncated).toBe(true)
        expect(result.notes[1]).toEqual(
            expect.objectContaining({ contentPreview: 'short', contentPreviewTruncated: false })
        )
        result.notes.forEach(note => {
            expect(note).not.toHaveProperty('content')
            expect(note).not.toHaveProperty('preview')
        })
    })

    test('returns note metadata and a short preview without full content', () => {
        const service = new NoteRetrievalService({ database: {} })
        const content = `First line\n\n${'word '.repeat(200)}`
        const result = service.mapNote(
            {
                noteId: 'note-1',
                extendedTitle: 'Launch plan',
                created: 100,
                lastEditionDate: 200,
            },
            { id: 'project-1', name: 'Product' },
            content
        )

        expect(result).toEqual(
            expect.objectContaining({
                id: 'note-1',
                projectId: 'project-1',
                projectName: 'Product',
                title: 'Launch plan',
                createdAt: 100,
                lastEditedAt: 200,
                contentPreview: expect.any(String),
                contentPreviewTruncated: true,
            })
        )
        expect(result).not.toHaveProperty('content')
        expect(result).not.toHaveProperty('preview')
        expect(result.contentPreview.length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX_LENGTH + 1)
        expect(result.contentPreview).not.toContain('\n')
        expect(result.contentPreview.endsWith('…')).toBe(true)
    })
})
