/**
 * @jest-environment jsdom
 *
 * AT-2416. Pasting a task link into a task input ("standard") or the comment popup
 * ("popup") left the caret in the wrong place, so you could not just keep typing.
 *
 * Two independent defects stacked up, both introduced by the quill 1 -> quill 2 migration:
 *
 * 1. `transformedMatchOps` turned every task URL into a `taskTagFormat` embed, but that blot
 *    lives only in the NOTES editor's format whitelist. Quill 2 scopes an editor's registry to
 *    its `formats` option, so inserting it into a text input threw
 *    `[Parchment] Unable to create taskTagFormat blot` from inside the `text-change` listener.
 *    Quill 1's `Scroll.insertAt` skipped a non-whitelisted blot silently, so the same code was
 *    merely inert before. The throw abandons the update: no chip, and the caret placement quill
 *    had queued for after the paste never runs.
 *
 * 2. `Clipboard.onPaste` places the caret at `delta.length() - range.length` — computed from
 *    the delta it is about to apply, before the autoformat `text-change` listener collapses the
 *    46-character URL into a one-character embed. The index is then ~45 characters too far
 *    right. Pasting at the END of the text hid it (quill clamps the overshoot to the last
 *    index), which is why this reads as "sometimes it works".
 *
 * These tests drive a REAL quill 2 with the REAL quill2Setup clipboard, the REAL autoformat
 * module and the REAL ALLOWED_FORMATS whitelist — the whitelist is the load-bearing part of
 * defect 1, and a mocked editor cannot have a scoped registry at all.
 */
jest.mock('../../../utils/BackendBridge', () => ({ getObjectFromUrl: jest.fn() }))
jest.mock('../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: jest.fn(() => false) }))
jest.mock('../../../redux/store', () => ({
    getState: () => ({ quillEditorProjectId: 'PROJ1' }),
    dispatch: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({ setSelectedSidebarTab: jest.fn() }))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../utils/backends/firestore', () => ({ getAppUrlHost: () => 'alldone.app' }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getCurrentProject: () => ({ id: 'PROJ1' }),
}))
jest.mock('../../NotesView/NotesDV/EditorView/mentionsHelper', () => ({ loadQuill: jest.fn() }))
// The real module pulls the whole app graph in through DateFormatPickerModal -> firestore.
jest.mock('../Utils/HelperFunctions', () => ({
    ATTACHMENT_TRIGGER: 'EbDsQTD14ahtSR5',
    IMAGE_TRIGGER: 'O2TI5plHBf1QfdY',
    VIDEO_TRIGGER: 'ptPQsef7OeB5eWd',
    KARMA_TRIGGER: 'pMP4SB2IsTQr8LN',
    MILESTONE_TAG_TRIGGER: 'qM54HU5TsTOe3Yw',
    MENTION_SPACE_CODE: 'M2mVOSjAVPPKweL',
    REGEX_KARMA: /^pMP4SB2IsTQr8LN[\S]+/,
    REGEX_MILESTONE_TAG: /^qM54HU5TsTOe3Yw[\S]+qM54HU5TsTOe3Yw[\S]+/,
    REGEX_VIDEO: /^ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+/,
    REGEX_IMAGE: /^O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+/,
    REGEX_ATTACHMENT: /^EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+/,
    REGEX_GENERIC: /^(&[\S]+)$/i,
    REGEX_HASHTAG: /(^|\s)(#[\S]+)$/i,
    REGEX_MENTION: /^(@[\S]+)$/i,
    REGEX_EMAIL: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)([,.])?/i,
    REGEX_URL: /^((https?|ftp):\/\/[\S]+|(www\.[\S]+)|([\S]+\.[a-zA-Z]{2,}[\S]*))$/i,
    tryToextractPeopleForMention: jest.fn(() => null),
}))

import Quill from 'quill'

import './quill2Setup'
import Autoformat from './autoformat/modules/autoformat'
import {
    ALLOWED_FORMATS,
    createPlaceholder,
    QUILL_EDITOR_NOTE_TYPE,
    QUILL_EDITOR_TEXT_INPUT_TYPE,
} from './textInputHelper'

const PROJECT_ID = 'PROJ1'
const TASK_URL = `https://alldone.app/projects/${PROJECT_ID}/tasks/TASK9`
const NOTE_FORMATS = [...ALLOWED_FORMATS, 'taskTagFormat']

// The real url/taskTagFormat blots render React through redux and the Firebase bridge. This
// suite is about delta geometry and caret indices, so the blots are stubbed — but they are
// registered GLOBALLY, exactly as the app registers them (EditorToolbar), so that a text
// input's scoped registry is the only thing keeping taskTagFormat out of reach. That is the
// condition defect 1 lives in.
const Embed = Quill.import('blots/embed')
const registerStubBlot = blotName => {
    class StubBlot extends Embed {
        static create(value) {
            const node = super.create(value)
            node.setAttribute('data-id', value.id || '')
            node.setAttribute('href', value.url || value.objectUrl || '')
            return node
        }
        static value(node) {
            return { id: node.getAttribute('data-id'), url: node.getAttribute('href') }
        }
    }
    StubBlot.blotName = blotName
    StubBlot.className = `ql-${blotName}`
    StubBlot.tagName = 'span'
    Quill.register(StubBlot, true)
}
;['url', 'taskTagFormat', 'hashtag', 'mention', 'email'].forEach(registerStubBlot)
Quill.register('modules/autoformat', Autoformat, true)

// jsdom has Range/Selection but measures nothing; quill calls getBounds on every setSelection.
const EMPTY_RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
Range.prototype.getBoundingClientRect = () => EMPTY_RECT
Range.prototype.getClientRects = () => [EMPTY_RECT]
Element.prototype.getBoundingClientRect = () => EMPTY_RECT

const buildEditor = (kind = 'input') => {
    const node = document.createElement('div')
    document.body.appendChild(node)
    return new Quill(node, {
        modules: { editorMeta: true, toolbar: false, autoformat: Autoformat.DEFAULTS, clipboard: true },
        formats: kind === 'input' ? ALLOWED_FORMATS : NOTE_FORMATS,
        placeholder: createPlaceholder(
            'Type to add task',
            kind === 'input' ? QUILL_EDITOR_TEXT_INPUT_TYPE : QUILL_EDITOR_NOTE_TYPE,
            'editor-1'
        ),
    })
}

// Where the link chip ended up, so assertions read as "the caret sits behind the chip"
// instead of hard-coding indices that shift when the surrounding text changes.
const embedIndexOf = (quill, blotName) => {
    let index = 0
    for (const op of quill.getContents().ops) {
        if (typeof op.insert === 'string') index += op.insert.length
        else if (op.insert[blotName]) return index
        else index += 1
    }
    return -1
}

const pasteInto = (quill, { at, selected = 0, text, html = '' }) => {
    quill.setSelection(at, selected)
    quill.clipboard.onPaste({ index: at, length: selected }, { text, html })
}

describe('AT-2416 pasting a task link keeps the caret behind the link', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    describe('defect 1 — taskTagFormat is not in a text input’s format whitelist', () => {
        it('is the condition being guarded: text inputs must not allow taskTagFormat', () => {
            expect(ALLOWED_FORMATS).not.toContain('taskTagFormat')
            expect(NOTE_FORMATS).toContain('taskTagFormat')
        })

        it('converts a typed task link in a text input without throwing', () => {
            const quill = buildEditor('input')
            quill.setText('hello ')
            quill.setSelection(6, 0)
            quill.insertText(6, TASK_URL, 'user')
            quill.setSelection(6 + TASK_URL.length, 0)
            // The space is the autoformat trigger — this threw ParchmentError before the fix.
            expect(() => quill.insertText(6 + TASK_URL.length, ' ', 'user')).not.toThrow()
            expect(embedIndexOf(quill, 'url')).toBe(6)
            expect(embedIndexOf(quill, 'taskTagFormat')).toBe(-1)
        })

        it('still uses the rich task tag in the notes editor, which does allow it', () => {
            const quill = buildEditor('note')
            quill.setText('hello ')
            quill.setSelection(6, 0)
            quill.insertText(6, TASK_URL, 'user')
            quill.setSelection(6 + TASK_URL.length, 0)
            quill.insertText(6 + TASK_URL.length, ' ', 'user')
            expect(embedIndexOf(quill, 'taskTagFormat')).toBe(6)
        })

        it('converts a task link pasted as plain text in a text input without throwing', () => {
            const quill = buildEditor('input')
            quill.setText('hello ')
            expect(() => pasteInto(quill, { at: 6, text: `${TASK_URL} ` })).not.toThrow()
            expect(embedIndexOf(quill, 'url')).toBeGreaterThan(-1)
        })
    })

    describe('defect 2 — the caret quill computes goes stale when the URL collapses to a chip', () => {
        it('leaves the caret directly behind the link pasted mid-sentence, not at the end of the line', () => {
            const quill = buildEditor('input')
            quill.setText('alpha beta gamma')

            pasteInto(quill, { at: 6, text: `${TASK_URL} ` })

            const chip = embedIndexOf(quill, 'url')
            expect(chip).toBeGreaterThan(-1)
            // chip, then the space the parser appends, then the caret.
            expect(quill.getSelection().index).toBe(chip + 2)
            // The pre-fix index was the end of "gamma"; pin that it is no longer past the link.
            expect(quill.getSelection().index).toBeLessThan(quill.getLength() - 1)
            expect(quill.getText(chip + 2)).toBe('beta gamma\n')
        })

        it('leaves the caret behind the link when the clipboard carries text/html too', () => {
            const quill = buildEditor('input')
            quill.setText('alpha beta gamma')

            pasteInto(quill, { at: 6, text: TASK_URL, html: TASK_URL })

            const chip = embedIndexOf(quill, 'url')
            expect(quill.getSelection().index).toBe(chip + 2)
            expect(quill.getText(chip + 2)).toBe('beta gamma\n')
        })

        it('leaves the caret behind the link when the paste replaces a selection', () => {
            const quill = buildEditor('input')
            quill.setText('alpha XXXX gamma')

            pasteInto(quill, { at: 6, selected: 4, text: TASK_URL, html: TASK_URL })

            const chip = embedIndexOf(quill, 'url')
            expect(quill.getSelection().index).toBe(chip + 2)
        })

        it('leaves the caret behind the link pasted into an empty input', () => {
            const quill = buildEditor('input')

            pasteInto(quill, { at: 0, text: TASK_URL, html: TASK_URL })

            const chip = embedIndexOf(quill, 'url')
            expect(chip).toBe(0)
            expect(quill.getSelection().index).toBe(chip + 2)
        })

        it('leaves the caret behind the link pasted at the end of existing text', () => {
            const quill = buildEditor('input')
            quill.setText('alpha ')

            pasteInto(quill, { at: 6, text: TASK_URL, html: TASK_URL })

            const chip = embedIndexOf(quill, 'url')
            expect(quill.getSelection().index).toBe(chip + 2)
        })

        it('does not move the caret for an ordinary paste that nothing rewrites', () => {
            const quill = buildEditor('input')
            quill.setText('alpha beta')

            pasteInto(quill, { at: 6, text: 'xy ' })

            // Unchanged from quill's own arithmetic: right after the inserted characters.
            expect(quill.getSelection().index).toBe(9)
            expect(quill.getText()).toBe('alpha xy beta\n')
        })
    })
})
