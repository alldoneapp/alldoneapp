const { buildNoteUrl, ensureCreatedNoteLinksInResponse, normalizeCreatedNote } = require('./noteLinkHelper')

describe('assistant note links', () => {
    const canonicalUrl = 'https://my.alldone.app/projects/project-1/notes/note-1/editor'

    test('builds the canonical project-scoped editor URL', () => {
        expect(buildNoteUrl('project-1', 'note-1', 'https://my.alldone.app/')).toBe(canonicalUrl)
    })

    test('appends the canonical URL when the model omits it', () => {
        expect(
            ensureCreatedNoteLinksInResponse('Done — I created the note.', [
                { noteId: 'note-1', projectId: 'project-1', title: 'Launch plan', url: canonicalUrl },
            ])
        ).toBe(`Done — I created the note.\n\nOpen “Launch plan”: ${canonicalUrl}`)
    })

    test('replaces a fabricated note URL with the canonical URL', () => {
        expect(
            ensureCreatedNoteLinksInResponse('Here it is: https://alldone.app/notes/note-1', [
                { noteId: 'note-1', url: canonicalUrl },
            ])
        ).toBe(`Here it is: ${canonicalUrl}`)
    })

    test('normalizes persisted created-entity metadata', () => {
        expect(
            normalizeCreatedNote({
                type: 'note',
                id: 'note-1',
                projectId: 'project-1',
                title: 'Launch plan',
                url: canonicalUrl,
            })
        ).toEqual({
            type: 'note',
            id: 'note-1',
            noteId: 'note-1',
            projectId: 'project-1',
            title: 'Launch plan',
            url: canonicalUrl,
        })
    })

    test('ignores non-note created entities', () => {
        expect(normalizeCreatedNote({ type: 'task', id: 'task-1', url: canonicalUrl })).toBeNull()
    })
})
