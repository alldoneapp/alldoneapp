jest.mock('firebase-admin', () => ({}))
jest.mock('../QuillHelper', () => ({ getNoteDelta: jest.fn() }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ getBaseUrl: () => 'https://my.alldone.app' }))
jest.mock('./deltaToMarkdown', () => ({ deltaToMarkdown: jest.fn() }))

const { resolveNoteContextUrl } = require('./noteContextHelper')

describe('resolveNoteContextUrl', () => {
    test('builds a note link from the environment-aware app base URL', () => {
        expect(resolveNoteContextUrl('project-1', 'note-1', null, 'https://my.alldone.app')).toBe(
            'https://my.alldone.app/projects/project-1/notes/note-1/editor'
        )
        expect(resolveNoteContextUrl('project-1', 'note-1', null, 'https://mystaging.alldone.app')).toBe(
            'https://mystaging.alldone.app/projects/project-1/notes/note-1/editor'
        )
    })

    test('preserves an explicit note URL from a mention', () => {
        const explicitUrl = 'https://example.test/custom-note-link'
        expect(resolveNoteContextUrl('project-1', 'note-1', explicitUrl, 'https://my.alldone.app')).toBe(explicitUrl)
    })
})
