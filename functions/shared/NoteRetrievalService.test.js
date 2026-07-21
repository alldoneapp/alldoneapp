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
                preview: expect.any(String),
            })
        )
        expect(result).not.toHaveProperty('content')
        expect(result.preview.length).toBeLessThanOrEqual(NOTE_PREVIEW_MAX_LENGTH + 1)
        expect(result.preview).not.toContain('\n')
    })
})
