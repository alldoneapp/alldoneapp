/**
 * @jest-environment jsdom
 *
 * AT-2950 - links written by the iOS app (Capacitor serves the bundle from capacitor://localhost)
 * must be treated as the app links they are, and new links must never be written with that origin.
 */
jest.mock('./backends/firestore', () => ({
    getAppUrlHost: () => 'my.alldone.app',
    getHostingUrl: () => 'https://my.alldone.app/',
}))
jest.mock('../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({ __esModule: true, default: {} }))

import {
    getAppLinkOrigin,
    getAppLinkPathname,
    getInternalLinkType,
    getUrlObject,
    isValidNoteLink,
    isValidProjectLink,
    isValidTaskLink,
} from './LinkingHelper'

const NOTE_PATH = '/projects/p1/notes/n1/editor'

describe('links stored by the iOS shell', () => {
    const iosLink = `capacitor://localhost${NOTE_PATH}`

    it('are app links of their project', () => {
        expect(isValidNoteLink(iosLink, 'p1')).toBeTruthy()
        expect(isValidNoteLink(iosLink, 'p2')).toBeFalsy()
        expect(isValidTaskLink('capacitor://localhost/projects/p1/tasks/t1/properties', 'p1')).toBeTruthy()
        expect(isValidProjectLink('capacitor://localhost/project/p1/properties', 'p1')).toBeTruthy()
        expect(getUrlObject(iosLink, 'capacitor:', 'p1', 'editor-1').type).toBe('note')
    })

    it('resolve to the app route', () => {
        expect(getAppLinkPathname(iosLink)).toBe(NOTE_PATH)
        expect(getAppLinkPathname(`https://my.alldone.app${NOTE_PATH}`)).toBe(NOTE_PATH)
    })

    it('are only accepted from the shell itself, never from another host or scheme', () => {
        expect(isValidNoteLink(`capacitor://evil.example${NOTE_PATH}`, 'p1')).toBeFalsy()
        expect(isValidNoteLink(`https://example.com${NOTE_PATH}`, 'p1')).toBeFalsy()
        expect(isValidNoteLink(`javascript://localhost${NOTE_PATH}`, 'p1')).toBeFalsy()
        expect(getAppLinkPathname(`https://example.com${NOTE_PATH}`)).toBeNull()
        expect(getAppLinkPathname(`javascript://localhost${NOTE_PATH}`)).toBeNull()
        expect(getAppLinkPathname('my.alldone.app/projects/p1/notes/n1')).toBeNull()
        expect(getAppLinkPathname(undefined)).toBeNull()
    })
})

describe('getInternalLinkType', () => {
    it('types a chip from the link itself, whatever editor it sits in', () => {
        // Stored as `plain` by an editor of another project, by an assistant, or by the iOS shell.
        expect(getInternalLinkType(`https://my.alldone.app${NOTE_PATH}`)).toBe('note')
        expect(getInternalLinkType(`capacitor://localhost${NOTE_PATH}`)).toBe('note')
        expect(getInternalLinkType('https://my.alldone.app/projects/p9/tasks/t1/properties')).toBe('task')
        expect(getInternalLinkType('https://my.alldone.app/projects/p9/goals/g1/properties')).toBe('goal')
        expect(getInternalLinkType('https://my.alldone.app/projects/p9/chats/c1/chat')).toBe('topic')
    })

    it('leaves ordinary links alone', () => {
        expect(getInternalLinkType('https://example.com/projects/p1/notes/n1/editor')).toBeNull()
        expect(getInternalLinkType('https://www.google.com/search?q=alldone')).toBeNull()
        expect(getInternalLinkType('https://my.alldone.app/project/p1/properties')).toBeNull()
        expect(getInternalLinkType('')).toBeNull()
        expect(getInternalLinkType(null)).toBeNull()
    })
})

describe('getAppLinkOrigin', () => {
    afterEach(() => {
        delete window.Capacitor
    })

    it('is the page origin in a browser', () => {
        expect(getAppLinkOrigin()).toBe(window.location.origin)
    })

    it('is the hosting URL inside the iOS shell, so the stored link works on every device', () => {
        window.Capacitor = { isNativePlatform: () => true }
        expect(getAppLinkOrigin()).toBe('https://my.alldone.app')
    })
})
