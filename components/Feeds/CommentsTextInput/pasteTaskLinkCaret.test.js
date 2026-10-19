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
    processPastedText,
    processPastedTextWithBreakLines,
} from './textInputHelper'
import { parseFeedComment } from '../Utils/feedCommentParser'

const PROJECT_ID = 'PROJ1'
const TASK_URL = `https://alldone.app/projects/${PROJECT_ID}/tasks/TASK9`
const ATLASSIAN_URL = 'https://jtl-software.atlassian.net/wiki/spaces/AD/pages/edit-v2/1527349338?'
const TEAMS_DOCUMENT_URL = 'https://company.sharepoint.com/:t:/s/PlatformTeam/IQDdocument123?e=share123&web=1'
const TEAMS_DOCUMENT_LABEL = 'MCP Server Q4 Execution Plan.md'
const TEAMS_MESSAGE_URL =
    'https://teams.microsoft.com/l/message/19:31a6fbacdfd24ed9b4204b6984dce10e@thread.v2/1792410546073?context=%7B%22contextType%22%3A%22chat%22%7D'
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
            node.setAttribute('data-text', value.text || '')
            return node
        }
        static value(node) {
            return {
                id: node.getAttribute('data-id'),
                url: node.getAttribute('href'),
                text: node.getAttribute('data-text'),
            }
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

const embedValueOf = (quill, blotName) =>
    quill.getContents().ops.find(op => typeof op.insert === 'object' && op.insert[blotName])?.insert[blotName]

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

    describe('defect 3 — a text/plain clipboard never reached the app’s paste matcher', () => {
        // This is how the app's own "Copy link" button fills the clipboard
        // (copyTextToClipboard -> navigator.clipboard.writeText writes text/plain only).
        const copyLinkClipboard = { text: TASK_URL }

        it('turns a task link copied with "Copy link" into a chip on paste, not on the next space', () => {
            const quill = buildEditor('input')
            quill.setText('alpha beta gamma')

            pasteInto(quill, { at: 6, ...copyLinkClipboard })

            const chip = embedIndexOf(quill, 'url')
            expect(chip).toBe(6)
            expect(quill.getSelection().index).toBe(chip + 2)
            expect(quill.getText(chip + 2)).toBe('beta gamma\n')
        })

        it('does the same in an empty input', () => {
            const quill = buildEditor('input')

            pasteInto(quill, { at: 0, ...copyLinkClipboard })

            expect(embedIndexOf(quill, 'url')).toBe(0)
            expect(quill.getSelection().index).toBe(2)
        })

        it.each([
            ['plain text', { text: ATLASSIAN_URL }],
            ['HTML text', { text: ATLASSIAN_URL, html: ATLASSIAN_URL }],
        ])(
            'keeps a trailing question mark inside a pasted %s URL and places the caret after the link (AT-2620)',
            (_clipboardType, clipboard) => {
                const quill = buildEditor('input')

                pasteInto(quill, { at: 0, ...clipboard })

                expect(embedValueOf(quill, 'url').url).toBe(ATLASSIAN_URL)
                expect(quill.getSelection().index).toBe(embedIndexOf(quill, 'url') + 2)
            }
        )

        it('keeps the line breaks of a multi-line plain-text paste', () => {
            const quill = buildEditor('input')
            const multiline = 'line one\nline two\nline three'

            pasteInto(quill, { at: 0, text: multiline })

            // processPastedText (the HTML-text-node parser) splits on /\s/ and rejoins with
            // single spaces, so the plain-text hook has to use the break-line-preserving
            // variant or every multi-line paste into a comment collapses onto one line.
            expect(quill.getText()).toBe(`${multiline}\n`)
            expect(quill.getSelection().index).toBe(multiline.length)
        })

        it('keeps ordinary plain text and its spacing untouched', () => {
            const quill = buildEditor('input')
            quill.setText('alpha beta')

            pasteInto(quill, { at: 6, text: 'one two three ' })

            expect(quill.getText()).toBe('alpha one two three beta\n')
            expect(quill.getSelection().index).toBe(20)
        })

        it('leaves the notes editor’s own paste pipeline alone', () => {
            const quill = buildEditor('note')
            quill.setText('alpha ')

            pasteInto(quill, { at: 6, ...copyLinkClipboard })

            // The notes editor sets no hook (quill.enablePasteListener is false there and it
            // attaches its own markdown/html paste handling), so text stays verbatim.
            expect(quill.getText()).toBe(`alpha ${TASK_URL}\n`)
        })

        it('degrades instead of throwing when the parser emits a blot this editor cannot render', () => {
            const quill = buildEditor('input')
            quill.setText('alpha ')

            // milestoneTag is in no text input's ALLOWED_FORMATS; before the guard this threw
            // ParchmentError and destroyed the whole paste along with the caret.
            expect(() => pasteInto(quill, { at: 6, text: 'qM54HU5TsTOe3YwSprint7qM54HU5TsTOe3YwMS1' })).not.toThrow()
            expect(embedIndexOf(quill, 'milestoneTag')).toBe(-1)
            expect(quill.getSelection()).not.toBeNull()
        })
    })

    describe('named HTML hyperlinks preserve their destination', () => {
        const escapedTeamsUrl = TEAMS_DOCUMENT_URL.replace('&', '&amp;')

        it.each([
            ['filename label', TEAMS_DOCUMENT_LABEL],
            ['nested formatting', '<strong>MCP Server</strong> <span>Q4 Execution Plan.md</span>'],
            ['URL label pointing elsewhere', 'https://example.com/visible-label'],
        ])('keeps the SharePoint destination for a %s instead of parsing the label', (_kind, label) => {
            const quill = buildEditor('input')

            pasteInto(quill, {
                at: 0,
                text: TEAMS_DOCUMENT_URL,
                html: `<a href="${escapedTeamsUrl}">${label}</a>`,
            })

            const urls = quill
                .getContents()
                .ops.filter(op => op.insert.url)
                .map(op => op.insert.url.url)
            expect(urls).toEqual([TEAMS_DOCUMENT_URL])
            expect(quill.getText().trim()).toBe('')
            expect(quill.getSelection().index).toBe(embedIndexOf(quill, 'url') + 2)
        })

        it('preserves surrounding text, multiple links, and the caret when replacing a selection', () => {
            const quill = buildEditor('input')
            quill.setText('alpha XXXX omega')

            pasteInto(quill, {
                at: 6,
                selected: 4,
                text: 'See plan and task today',
                html: `<p>See <a href="${escapedTeamsUrl}">${TEAMS_DOCUMENT_LABEL}</a> and <a href="${TASK_URL}">My task</a> today</p>`,
            })

            const urls = quill
                .getContents()
                .ops.filter(op => op.insert.url)
                .map(op => op.insert.url.url)
            expect(urls).toEqual([TEAMS_DOCUMENT_URL, TASK_URL])
            expect(quill.getText()).toMatch(/^alpha See\s+and\s+today omega\n$/)
            const caret = quill.getSelection().index
            expect(quill.getText(caret)).toBe(' omega\n')
            quill.insertText(caret, '!', 'user')
            expect(quill.getText()).toMatch(/today! omega\n$/)
        })

        it('does not turn a non-web href into a URL embed', () => {
            const quill = buildEditor('input')

            pasteInto(quill, {
                at: 0,
                text: 'Open document',
                html: '<a href="javascript:alert(1)">Open document</a>',
            })

            expect(embedIndexOf(quill, 'url')).toBe(-1)
            expect(quill.getText()).toBe('Open document\n')
        })
    })

    describe('Teams URLs stay links throughout paste, typing and saved-text reconstruction', () => {
        it.each(['div', 'p', 'span'])('converts a link inside a %s wrapper exactly once', tag => {
            const quill = buildEditor('input')
            quill.setText('alpha XXXX omega')
            pasteInto(quill, {
                at: 6,
                selected: 4,
                text: TEAMS_MESSAGE_URL,
                html: `<${tag}><a href="${TEAMS_MESSAGE_URL}"><strong>teams</strong></a> after</${tag}>`,
            })

            const urls = quill.getContents().ops.filter(op => op.insert.url)
            expect(urls).toHaveLength(1)
            expect(urls[0].insert.url.url).toBe(TEAMS_MESSAGE_URL)
            expect(embedIndexOf(quill, 'email')).toBe(-1)
            expect(quill.getText()).toMatch(/^alpha\s+after\s+omega\n$/)
            expect(quill.getText(quill.getSelection().index)).toBe(' omega\n')
        })

        it('does not duplicate a link through multiple nested wrappers or retain native link attributes', () => {
            const quill = buildEditor('input')
            pasteInto(quill, {
                at: 0,
                text: TEAMS_MESSAGE_URL,
                html: `<div><p><span><a href="${TEAMS_MESSAGE_URL}">teams</a></span></p></div>`,
            })
            const ops = quill.getContents().ops
            expect(ops.filter(op => op.insert.url).map(op => op.insert.url.url)).toEqual([TEAMS_MESSAGE_URL])
            expect(ops.some(op => op.attributes?.link)).toBe(false)
        })

        it('keeps two hyperlinks that were actually present in the clipboard', () => {
            const quill = buildEditor('input')
            pasteInto(quill, {
                at: 0,
                text: `${TEAMS_MESSAGE_URL} ${TEAMS_MESSAGE_URL}`,
                html: `<div><a href="${TEAMS_MESSAGE_URL}">first</a> <a href="${TEAMS_MESSAGE_URL}">second</a></div>`,
            })
            expect(
                quill
                    .getContents()
                    .ops.filter(op => op.insert.url)
                    .map(op => op.insert.url.url)
            ).toEqual([TEAMS_MESSAGE_URL, TEAMS_MESSAGE_URL])
        })

        it('converts a wrapped person hyperlink to one mention', () => {
            const quill = buildEditor('input')
            jest.requireMock('../Utils/HelperFunctions').tryToextractPeopleForMention.mockReturnValueOnce({
                peopleName: 'Karsten',
                uid: 'user-1',
            })
            pasteInto(quill, {
                at: 0,
                text: 'Karsten',
                html: '<div><a href="https://alldone.app/person">Karsten</a></div>',
            })
            expect(quill.getContents().ops.filter(op => op.insert.mention)).toHaveLength(1)
            expect(embedIndexOf(quill, 'url')).toBe(-1)
        })

        it.each([
            ['plain text', ''],
            ['HTML text', TEAMS_MESSAGE_URL],
        ])('keeps a Teams URL pasted as %s through the saved-title parser', (_kind, html) => {
            const quill = buildEditor('input')
            pasteInto(quill, { at: 0, text: TEAMS_MESSAGE_URL, html })
            expect(embedIndexOf(quill, 'email')).toBe(-1)
            expect(embedValueOf(quill, 'url').url).toBe(TEAMS_MESSAGE_URL)
            // CustomTextInput3 serializes URL chips back to their complete destination on save.
            const savedText = quill
                .getContents()
                .ops.map(op => op.insert.url?.url || op.insert)
                .join('')
                .trim()
            expect(parseFeedComment(savedText, false, false)).toEqual([{ type: 'url', link: TEAMS_MESSAGE_URL }])
        })

        it.each(['input', 'note'])('autoformats a typed Teams URL as a URL in a %s editor', kind => {
            const quill = buildEditor(kind)
            const emailInsertions = []
            quill.on('text-change', delta => emailInsertions.push(...delta.ops.filter(op => op.insert?.email)))
            quill.setText('hello  omega')
            quill.setSelection(6)
            quill.insertText(6, TEAMS_MESSAGE_URL, 'user')
            quill.setSelection(6 + TEAMS_MESSAGE_URL.length)
            quill.insertText(6 + TEAMS_MESSAGE_URL.length, ' ', 'user')
            expect(embedIndexOf(quill, 'email')).toBe(-1)
            expect(embedValueOf(quill, 'url').url).toBe(TEAMS_MESSAGE_URL)
            expect(quill.getText()).toContain(' omega')
            expect(emailInsertions).toEqual([])
        })

        it.each([
            ['single-line parser', processPastedText],
            ['multi-line parser', processPastedTextWithBreakLines],
        ])('%s preserves Teams URLs alongside real emails when loading or pasting text', (_kind, parse) => {
            const delta = parse(`${TEAMS_MESSAGE_URL} mail@example.com,`, Quill.import('delta'), PROJECT_ID, 'editor-1')
            expect(delta.ops.filter(op => op.insert.url).map(op => op.insert.url.url)).toEqual([TEAMS_MESSAGE_URL])
            expect(delta.ops.filter(op => op.insert.email).map(op => op.insert.email.text)).toEqual([
                'mail@example.com',
            ])
        })

        it('uses an HTML hyperlink destination even when its visible label is an email address', () => {
            const delta = processPastedTextWithBreakLines(
                'mail@example.com',
                Quill.import('delta'),
                PROJECT_ID,
                'note-1',
                null,
                false,
                '',
                null,
                true,
                { link: TEAMS_MESSAGE_URL }
            )
            expect(delta.ops.filter(op => op.insert.url).map(op => op.insert.url.url)).toEqual([TEAMS_MESSAGE_URL])
            expect(delta.ops.some(op => op.insert.email)).toBe(false)
        })

        it('still autoformats a typed real email address', () => {
            const quill = buildEditor('input')
            quill.setText('hello ')
            quill.setSelection(6)
            quill.insertText(6, 'mail@example.com', 'user')
            quill.setSelection(22)
            quill.insertText(22, ' ', 'user')
            expect(embedValueOf(quill, 'email').text).toBe('mail@example.com')
            expect(embedIndexOf(quill, 'url')).toBe(-1)
        })
    })
})
