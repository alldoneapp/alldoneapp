/**
 * @jest-environment jsdom
 *
 * AT-2950 - @-mentioning a note in a note stores a link that resolves on every device.
 *
 * Mention links used to be built from `window.location.origin`. Inside the iOS app (Capacitor)
 * that is `capacitor://localhost`, so the stored chip was typed `plain` and pointed at an origin
 * that only exists inside that one app. Drives the REAL mention helper against a REAL quill 2.
 */
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    getElementOffset: () => ({ top: 0, left: 0 }),
    NOT_USER_MENTIONED: '0',
    MENTION_MODAL_WIDTH: 300,
    MENTION_MODAL_RIGHT_MARGIN: 16,
    MENTION_MODAL_TASKS_TAB: 0,
    MENTION_MODAL_GOALS_TAB: 1,
    MENTION_MODAL_NOTES_TAB: 2,
    MENTION_MODAL_CONTACTS_TAB: 3,
    MENTION_MODAL_TOPICS_TAB: 4,
}))
jest.mock('../../../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: 'user-1' } }) }))
jest.mock('../../../../utils/backends/firestore', () => ({
    getAppUrlHost: () => 'my.alldone.app',
    getHostingUrl: () => 'https://my.alldone.app',
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ __esModule: true, default: {} }))
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({ MENTION_SPACE_CODE: 'M2mVOSjAVPPKweL' }))
jest.mock('../../../../utils/backends/Contacts/contactsFirestore', () => ({}))
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({}))

import Quill from 'quill'
import Url from '../../../Feeds/CommentsTextInput/autoformat/formats/url'
import {
    handleTextChangeForMentions,
    loadMentionsData,
    onChangeSelection,
    resetMentionsData,
    selectItemToMention,
} from './mentionsHelper'

jest.mock('../../../Feeds/CommentsTextInput/autoformat/formats/url', () => {
    // A minimal embed with the real blot name: this suite is about the stored value, not about
    // how the chip renders (urlNoteMention.test.js covers that).
    const Quill = require('quill').default
    const Embed = Quill.import('blots/embed')
    class UrlStub extends Embed {
        static create(value) {
            const node = super.create(value)
            node.__value = value
            return node
        }
        static value(node) {
            return node.__value
        }
    }
    UrlStub.blotName = 'url'
    UrlStub.className = 'ql-url'
    UrlStub.tagName = 'span'
    return { __esModule: true, default: UrlStub }
})

Quill.register(Url, true)

const NOTE_ID = 'note-being-edited'
const MENTIONED = { id: 'n1', projectId: 'p1', title: 'Q4 Roadmap' }

let quill

const mentionNote = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    quill = new Quill(host)
    // jsdom has no layout; the popup's position is irrelevant here.
    quill.getBounds = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 })
    quill.setText('See @Q4\n')
    loadMentionsData(NOTE_ID, { current: quill }, 'p0')
    // The caret right after the `@`, where the popup opens; the typed name runs to the next space.
    onChangeSelection({ index: 5, length: 0 })
    handleTextChangeForMentions(null)
    selectItemToMention(MENTIONED, 2, 'p0')
    return quill.getContents().ops.find(op => op.insert && op.insert.url).insert.url
}

describe('AT-2950 - a note mention stores a link every device can resolve', () => {
    afterEach(() => {
        resetMentionsData()
        delete window.Capacitor
        document.body.innerHTML = ''
    })

    it('replaces the typed @-text with a note chip of the mentioned note project', () => {
        const url = mentionNote()

        // In a browser the page's own origin, as before.
        expect(url.url).toBe(`${window.location.origin}/projects/p1/notes/n1/editor`)
        const ops = quill.getContents().ops
        expect(ops[0].insert).toBe('See ')
        expect(ops[1].insert.url).toBe(url)
        expect(ops[2].insert).toBe(' \n')
    })

    it('uses the hosting URL inside the iOS app, never capacitor://localhost', () => {
        window.Capacitor = { isNativePlatform: () => true }

        const url = mentionNote()

        expect(url.url).toBe('https://my.alldone.app/projects/p1/notes/n1/editor')
        expect(url.type).toBe('note')
    })
})
