/**
 * @jest-environment jsdom
 *
 * AT-2950 - a note mention is a `url` embed, and what it renders must follow the LINK.
 *
 * Drives the REAL `url` blot inside a REAL quill 2, with only the rendered wrapper and the
 * Firestore read replaced, because the question is what the blot decides from a stored value:
 *
 *  - a chip stored as `plain` that points at a note (written by the iOS shell, pasted from another
 *    project, or written by an assistant) must still be read as a note and get its title;
 *  - a read that FAILS must not demote the chip to a plain link, and must still render something
 *    (an unhandled rejection used to leave the embed empty);
 *  - only an answered "does not exist" turns it into a plain link, as before;
 *  - an ordinary external link never triggers a read at all.
 */
import Quill from 'quill'

const mockRenderedWrappers = []
jest.mock('../tags/UrlWrapper', () => {
    const React = require('react')
    return function MockUrlWrapper(props) {
        mockRenderedWrappers.push(props)
        return React.createElement('span', { className: 'mock-url-wrapper' }, props.objectName || props.value.url)
    }
})
jest.mock('../../../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({}), subscribe: () => () => {}, dispatch: () => {} },
}))
jest.mock('../../../../NotesView/NotesHelper', () => ({ isPrivateNote: () => false }))
jest.mock('../../../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { getObjectFromUrl: jest.fn() },
}))
jest.mock('../../../../../utils/backends/firestore', () => ({
    getAppUrlHost: () => 'my.alldone.app',
    getHostingUrl: () => 'https://my.alldone.app',
}))
jest.mock('../../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ __esModule: true, default: {} }))

import Backend from '../../../../../utils/BackendBridge'
import Url, { resolveUrlRenderValue } from './url'

Quill.register(Url, true)

const NOTE_PATH = '/projects/p1/notes/n1/editor'
const NOTE = { title: 'Q4 Roadmap', userIds: ['u1'], isPublicFor: [0] }

const buildEditor = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return new Quill(host)
}

const urlEmbed = (url, type) => ({
    url,
    type,
    urlBoundary: 'my.alldone.app...',
    id: `chip-${Math.random()}`,
    editorId: 'note-1',
    userIdAllowedToEditTags: 'u1',
    open: false,
})

const insertChip = embed => {
    const quill = buildEditor()
    quill.setContents([{ insert: { url: embed } }, { insert: ' \n' }])
    return quill
}

const lastWrapper = () => mockRenderedWrappers[mockRenderedWrappers.length - 1]

describe('AT-2950 - a note mention renders as its note', () => {
    beforeEach(() => {
        mockRenderedWrappers.length = 0
        Backend.getObjectFromUrl.mockReset()
        document.body.innerHTML = ''
    })

    it('reads a mention stored by the iOS shell as a note and passes its title on', () => {
        Backend.getObjectFromUrl.mockImplementation((type, url, callback) =>
            callback({ object: NOTE, objectName: NOTE.title })
        )
        const iosLink = `capacitor://localhost${NOTE_PATH}`

        const quill = insertChip(urlEmbed(iosLink, 'plain'))

        expect(Backend.getObjectFromUrl).toHaveBeenCalledWith('note', iosLink, expect.any(Function))
        expect(lastWrapper().value.type).toBe('note')
        expect(lastWrapper().objectName).toBe('Q4 Roadmap')
        // Nothing about the stored value changes: rendering never writes the document.
        expect(quill.getContents().ops[0].insert.url.type).toBe('plain')
    })

    it('reads a note link stored as plain by an editor of another project as a note', () => {
        Backend.getObjectFromUrl.mockImplementation((type, url, callback) =>
            callback({ object: NOTE, objectName: NOTE.title })
        )

        insertChip(urlEmbed(`https://my.alldone.app${NOTE_PATH}`, 'plain'))
        expect(Backend.getObjectFromUrl).toHaveBeenCalledWith(
            'note',
            `https://my.alldone.app${NOTE_PATH}`,
            expect.any(Function)
        )
        expect(lastWrapper().objectName).toBe('Q4 Roadmap')
    })

    it('keeps a chip whose read FAILED typed, and still renders it', () => {
        const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        })
        Backend.getObjectFromUrl.mockImplementation((type, url, callback) =>
            callback({ object: null, objectName: null, error: denied })
        )

        insertChip(urlEmbed(`https://my.alldone.app${NOTE_PATH}`, 'note'))

        expect(mockRenderedWrappers).toHaveLength(1)
        expect(lastWrapper().value.type).toBe('note')
        expect(lastWrapper().objectName).toBeNull()
    })

    it('still demotes a link to a note that does not exist to a plain link', () => {
        Backend.getObjectFromUrl.mockImplementation((type, url, callback) =>
            callback({ object: null, objectName: "Doesn't exist" })
        )

        insertChip(urlEmbed(`https://my.alldone.app${NOTE_PATH}`, 'note'))

        expect(lastWrapper().value.type).toBe('plain')
    })

    it('never reads anything for an ordinary external link', () => {
        insertChip(urlEmbed('https://www.example.com/projects/p1/notes/n1/editor', 'plain'))

        expect(Backend.getObjectFromUrl).not.toHaveBeenCalled()
        expect(lastWrapper().value.type).toBe('plain')
    })
})

describe('resolveUrlRenderValue', () => {
    it('only ever refines a plain chip, never re-types a typed one', () => {
        const typed = urlEmbed(`https://my.alldone.app${NOTE_PATH}`, 'task')
        expect(resolveUrlRenderValue(typed)).toBe(typed)
        const external = urlEmbed('https://example.com', 'plain')
        expect(resolveUrlRenderValue(external)).toBe(external)
    })
})
