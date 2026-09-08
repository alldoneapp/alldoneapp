/**
 * @jest-environment jsdom
 *
 * AT-2526. "If I copy + paste a list of bullet points into a note, the last bullet point sometimes
 * loses its bullet point formatting and is just pasted as plain text."
 *
 * The defect is on the COPY side, which is why it survived AT-2469 and AT-2519 — both of those
 * hardened the paste. A block format is stored on the line's terminating newline, and
 * `editor.getContents(index, length)` returns the selected range and nothing else, so a selection
 * that stops at the end of the last line's text leaves that line's `list: 'bullet'` behind. The
 * copied delta's last op is then bare text, `QuillDeltaToHtmlConverter` renders it as a `<p>` after
 * the `</ul>`, and the clipboard itself says the last item is a paragraph. Every consumer honours
 * that faithfully — Alldone's own paste pipeline, and Word, Teams and Gmail too.
 *
 * "Sometimes" is decided by a character the user cannot see:
 *
 *   - drag to the end of the last bullet's text  -> terminator excluded -> last bullet lost
 *   - drag PAST it into the line below           -> terminator included -> fine
 *
 * and select-all is not luck at all: quill clamps a selection to `getLength() - 1`, so a list that
 * ends the note can NEVER have its last terminator selected and always loses the bullet. That case
 * is pinned below, because it is the one a user reports as "it just doesn't work".
 *
 * A second, independent trigger for the same symptom lives in the paste tokenizer and is pinned in
 * its own block: `processPastedTextWithBreakLines` built each line terminator by appending '\n' to
 * whichever op it had emitted last, so a bullet line ending in an email address or a formatted link
 * — both of which insert an attribute-less trailing space — silently dropped its `list`.
 *
 * These tests drive a REAL quill 2, the REAL `onCopy` and the REAL delta-to-HTML converter. The
 * whole defect is what quill's own `getContents` does and does not include, so a mocked editor
 * cannot express it.
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

import { readFileSync } from 'fs'
import { join } from 'path'

import Quill from 'quill'
import { QuillDeltaToHtmlConverter } from 'quill-delta-to-html'

import { blockAttributesOf, resolveCopiedBlockTail } from './quillBlockFormats'
import { onCopy, processPastedTextWithBreakLines } from './textInputHelper'
import { applyPastedDeltaToEditor, normalizePastedLineEndings } from '../../NotesView/NotesDV/EditorView/notePaste'
import { containsMarkdown, markdownToDelta } from '../../NotesView/NotesDV/EditorView/markdownToDelta'

const Delta = Quill.import('delta')

// Quill measures the caret on every setSelection; jsdom has no layout.
const stubLayout = () => {
    const rect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 })
    Range.prototype.getBoundingClientRect = rect
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })
    Element.prototype.getBoundingClientRect = rect
    Element.prototype.scrollIntoView = () => {}
}

const buildEditor = (contents, index = 0, length = 0) => {
    stubLayout()
    const node = document.createElement('div')
    document.body.appendChild(node)
    const quill = new Quill(node, { modules: { toolbar: false, history: { userOnly: true } } })
    if (contents) quill.setContents(contents)
    quill.setSelection(index, length)
    return quill
}

const bulletList = () =>
    new Delta()
        .insert('one')
        .insert('\n', { list: 'bullet' })
        .insert('two')
        .insert('\n', { list: 'bullet' })
        .insert('three')
        .insert('\n', { list: 'bullet' })

/** Runs the REAL `onCopy` against a real editor and returns what it put on the clipboard. */
const copyFrom = (editor, { cut = false } = {}) => {
    const clipboard = {}
    onCopy(
        {
            clipboardData: { setData: (type, value) => (clipboard[type] = value) },
            preventDefault: () => {},
        },
        editor,
        'PROJ1',
        cut
    )
    return clipboard
}

/** What the clipboard would have carried before the fix, i.e. the selection with no restored tail. */
const clipboardHtmlWithoutTheFix = (editor, index, length) =>
    new QuillDeltaToHtmlConverter(editor.getContents(index, length).ops, {}).convert()

/**
 * NotesEditorView's `convertPastedClipboard`, replicated so a clipboard payload can be driven all
 * the way into a document. The handler itself cannot be imported (it is created inside a mount
 * effect, and NotesEditorView drags the whole app graph in), so the block at the bottom of this
 * file ratchets the real source against this replication.
 */
const convertPastedClipboard = (editor, textData, htmlData) => {
    if (textData && containsMarkdown(textData)) {
        const parsedDelta = markdownToDelta(textData, Delta)
        if (parsedDelta) return parsedDelta
    }

    if (htmlData) {
        const pastedDelta = editor.clipboard.convert({ html: htmlData })
        const finalDelta = { ops: [] }
        for (let i = 0; i < pastedDelta.ops.length; i++) {
            const op = pastedDelta.ops[i]
            const { retain, insert, attributes } = op
            if (retain || op.delete) {
                finalDelta.ops.push(op)
            } else if (insert) {
                if (typeof insert === 'string' && insert !== '') {
                    const delta = processPastedTextWithBreakLines(
                        insert,
                        Delta,
                        'PROJ1',
                        'NOTE1',
                        null,
                        false,
                        '',
                        editor,
                        true,
                        attributes,
                        true
                    )
                    finalDelta.ops = [...finalDelta.ops, ...delta.ops]
                } else {
                    finalDelta.ops.push(op)
                }
            }
        }
        return finalDelta
    }

    return processPastedTextWithBreakLines(textData, Delta, 'PROJ1', 'NOTE1', null, false, '', editor, true, null, true)
}

const pasteInto = (editor, clipboard) => {
    const textData = normalizePastedLineEndings(clipboard['text/plain'])
    const converted = convertPastedClipboard(editor, textData, clipboard['text/html'])
    applyPastedDeltaToEditor(editor, new Delta(converted.ops), Delta)
    return editor
}

/** The block format of each line of a document, in order — what the user actually sees. */
const lineFormats = editor =>
    editor
        .getLines()
        .map(line => (typeof line.formats === 'function' ? line.formats() : {}))
        .map(formats => formats.list || null)

describe('resolveCopiedBlockTail — the rule (AT-2526)', () => {
    it('restores the bullet a selection stopped just short of', () => {
        const editor = buildEditor(bulletList())
        // 'one\ntwo\nthree' — the last bullet's own terminator is NOT selected.
        const ops = editor.getContents(0, 13).ops

        expect(resolveCopiedBlockTail(editor, 0, 13, ops)).toEqual({
            insert: '\n',
            attributes: { list: 'bullet' },
        })
    })

    it('adds nothing when the selection already carries its terminator', () => {
        const editor = buildEditor(bulletList())
        const ops = editor.getContents(0, 8).ops // 'one\ntwo\n' — ends with the bullet terminator

        expect(resolveCopiedBlockTail(editor, 0, 8, ops)).toBeNull()
    })

    it('leaves a fragment copied from inside a single bullet alone', () => {
        // Deliberate: an inline fragment is not a list. Pasting two words out of a bullet must not
        // turn the destination paragraph into one — that is today's behaviour and it stays.
        const editor = buildEditor(bulletList())
        const ops = editor.getContents(4, 3).ops // 'two', no line break in the selection

        expect(resolveCopiedBlockTail(editor, 4, 3, ops)).toBeNull()
    })

    it('adds nothing for ordinary prose, so a normal copy is untouched', () => {
        const editor = buildEditor(new Delta().insert('first line\nsecond line\n'))
        const ops = editor.getContents(0, 22).ops

        expect(resolveCopiedBlockTail(editor, 0, 22, ops)).toBeNull()
    })

    it('adds nothing when nothing is selected', () => {
        const editor = buildEditor(bulletList())

        expect(resolveCopiedBlockTail(editor, 0, 0, [])).toBeNull()
    })

    it('carries the indent of a nested list item', () => {
        const editor = buildEditor(
            new Delta()
                .insert('one')
                .insert('\n', { list: 'bullet' })
                .insert('nested')
                .insert('\n', { list: 'bullet', indent: 1 })
        )

        expect(resolveCopiedBlockTail(editor, 0, 10, editor.getContents(0, 10).ops)).toEqual({
            insert: '\n',
            attributes: { list: 'bullet', indent: 1 },
        })
    })

    it.each([
        ['ordered list', { list: 'ordered' }],
        ['heading', { header: 2 }],
        ['blockquote', { blockquote: true }],
    ])('restores a %s tail too, since every block format lives on the same character', (_label, attributes) => {
        const editor = buildEditor(
            new Delta().insert('one').insert('\n', { list: 'bullet' }).insert('tail').insert('\n', attributes)
        )

        expect(resolveCopiedBlockTail(editor, 0, 8, editor.getContents(0, 8).ops)).toEqual({
            insert: '\n',
            attributes,
        })
    })

    it('never treats an inline format as a block format', () => {
        // Ops merge, so the attributes reaching this rule can describe a text run. Wrapping a block
        // in `bold` is not what the clipboard meant.
        const editor = buildEditor(new Delta().insert('one\n'))

        expect(blockAttributesOf({ bold: true, color: '#242424' }, editor)).toBeNull()
        expect(blockAttributesOf({ bold: true, list: 'bullet' }, editor)).toEqual({ list: 'bullet' })
    })
})

describe('onCopy — the clipboard a note copy produces (AT-2526)', () => {
    it('keeps the last bullet when the selection stops at the end of its text', () => {
        const editor = buildEditor(bulletList(), 0, 13)

        // The unfixed shape: this is exactly what the user was pasting.
        expect(clipboardHtmlWithoutTheFix(editor, 0, 13)).toBe('<ul><li>one</li><li>two</li></ul><p>three</p>')

        expect(copyFrom(editor)['text/html']).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>')
    })

    it('always kept it when the selection ran past the list, which is why it looked intermittent', () => {
        const editor = buildEditor(bulletList().insert('after\n'), 0, 14)

        expect(copyFrom(editor)['text/html']).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>')
    })

    it('fixes select-all, which quill clamps so the last terminator can never be selected', () => {
        const editor = buildEditor(bulletList())
        editor.setSelection(0, editor.getLength())

        // Not luck: quill refuses to include the document's final newline, so a list that ends the
        // note lost its last bullet on EVERY select-all.
        expect(editor.getSelection().length).toBe(editor.getLength() - 1)
        expect(copyFrom(editor)['text/html']).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>')
    })

    it('keeps a partially selected last bullet a bullet', () => {
        const editor = buildEditor(bulletList(), 0, 11) // 'one\ntwo\nthr'

        expect(copyFrom(editor)['text/html']).toBe('<ul><li>one</li><li>two</li><li>thr</li></ul>')
    })

    it('leaves text/plain exactly as it was', () => {
        const editor = buildEditor(bulletList(), 0, 13)

        // The restored terminator is for the HTML only — the plain-text flavour is what the
        // markdown route reads, and a trailing newline there would change an unrelated pipeline.
        expect(copyFrom(editor)['text/plain']).toBe('one\ntwo\nthree')
    })

    it('reads the source format before a CUT deletes the line it is reading', () => {
        const editor = buildEditor(bulletList(), 0, 13)

        expect(copyFrom(editor, { cut: true })['text/html']).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>')
    })

    it('leaves a copy of ordinary prose byte-identical', () => {
        const editor = buildEditor(new Delta().insert('first line\nsecond line\n'), 0, 22)

        // Unchanged, and it is the overwhelmingly common copy: prose has no block format, so the
        // rule resolves to null and onCopy runs exactly the code it always did (the outer <p> is
        // stripped by onCopy's own trailing rule, which is why this is not two paragraphs).
        expect(copyFrom(editor)['text/html']).toBe('first line<br/>second line')
    })

    it('leaves a fragment copied out of one bullet as plain text', () => {
        const editor = buildEditor(bulletList(), 4, 3)

        expect(copyFrom(editor)['text/html']).toBe('two')
    })
})

describe('copy then paste — the reported round trip (AT-2526)', () => {
    it('pastes three bullets, not two bullets and a paragraph', () => {
        const source = buildEditor(bulletList(), 0, 13)
        const clipboard = copyFrom(source)

        const target = pasteInto(buildEditor(new Delta().insert('\n')), clipboard)

        expect(target.getText()).toBe('one\ntwo\nthree\n')
        expect(lineFormats(target)).toEqual(['bullet', 'bullet', 'bullet'])
    })

    it('pastes three bullets after a select-all copy', () => {
        const source = buildEditor(bulletList())
        source.setSelection(0, source.getLength())
        const clipboard = copyFrom(source)

        const target = pasteInto(buildEditor(new Delta().insert('\n')), clipboard)

        expect(lineFormats(target)).toEqual(['bullet', 'bullet', 'bullet'])
    })

    it('pastes into an existing note without disturbing the line it lands on', () => {
        const source = buildEditor(bulletList(), 0, 13)
        const clipboard = copyFrom(source)

        const target = pasteInto(buildEditor(new Delta().insert('hello\nworld\n'), 6), clipboard)

        expect(target.getText()).toBe('hello\none\ntwo\nthree\nworld\n')
        expect(lineFormats(target)).toEqual([null, 'bullet', 'bullet', 'bullet', null])
    })

    it('still leaves the caret at the end of the pasted text, as AT-2469 requires', () => {
        const source = buildEditor(bulletList(), 0, 13)
        const clipboard = copyFrom(source)

        const target = pasteInto(buildEditor(new Delta().insert('\n')), clipboard)

        // End of 'three', not the start of a surplus line below it.
        expect(target.getSelection().index).toBe(13)
    })

    it('round-trips an ordered list the same way', () => {
        const ordered = new Delta()
            .insert('one')
            .insert('\n', { list: 'ordered' })
            .insert('two')
            .insert('\n', { list: 'ordered' })
        const clipboard = copyFrom(buildEditor(ordered, 0, 7))

        expect(lineFormats(pasteInto(buildEditor(new Delta().insert('\n')), clipboard))).toEqual(['ordered', 'ordered'])
    })

    it('keeps a fragment copied out of one bullet plain when pasted into prose', () => {
        const clipboard = copyFrom(buildEditor(bulletList(), 4, 3))

        const target = pasteInto(buildEditor(new Delta().insert('prefix \n'), 7), clipboard)

        expect(target.getText()).toBe('prefix two\n')
        expect(lineFormats(target)).toEqual([null])
    })
})

describe('processPastedTextWithBreakLines — the line terminator carries the LINE format (AT-2526)', () => {
    const tokenize = (text, attributes) =>
        processPastedTextWithBreakLines(text, Delta, 'P', 'E', null, false, '', null, true, attributes, true).ops

    it('keeps the bullet on a line that ends with an email address', () => {
        // The email branch inserts an attribute-less trailing space, and the terminator used to be
        // appended to whatever op came last — so it adopted that op's (missing) attributes.
        const ops = tokenize('one\na@b.com\nthree\n', { list: 'bullet' })
        const terminator = ops.find(op => typeof op.insert === 'string' && op.insert.startsWith('\n'))

        expect(terminator.attributes).toEqual({ list: 'bullet' })
        expect(ops.every(op => typeof op.insert !== 'string' || !/\n/.test(op.insert) || op.attributes)).toBe(true)
    })

    it('leaves an ordinary list byte-identical, because Delta merges a matching insert itself', () => {
        expect(tokenize('one\ntwo\nthree\n', { list: 'bullet' })).toEqual([
            { insert: 'one\ntwo\nthree\n', attributes: { list: 'bullet' } },
        ])
    })

    it('leaves unformatted text byte-identical', () => {
        expect(tokenize('one\ntwo\n', null)).toEqual([{ insert: 'one\ntwo\n' }])
    })

    it('keeps the bullet when the email sits mid-line, which always worked', () => {
        // The email is followed by more words, so the terminator merges into a run that already
        // carries the list. Pinned as behaviour that must not change.
        const ops = tokenize('one\nwrite a@b.com now\nthree\n', { list: 'bullet' })

        expect(ops[ops.length - 1]).toEqual({ insert: 'now\nthree\n', attributes: { list: 'bullet' } })
    })

    it('gives every line break in a formatted list the list attribute', () => {
        const ops = tokenize('one\na@b.com\nthree\n', { list: 'bullet' })
        const breaks = ops.filter(op => typeof op.insert === 'string' && op.insert.includes('\n'))

        expect(breaks.length).toBeGreaterThan(0)
        breaks.forEach(op => expect(op.attributes).toEqual({ list: 'bullet' }))
    })
})

describe('the copy handler wiring (AT-2526)', () => {
    const source = () => readFileSync(join(__dirname, 'textInputHelper.js'), 'utf8')

    it('resolves the block tail from the live editor before a cut deletes it', () => {
        // A source ratchet: `isCuting` calls `deleteFromDocument()`, so reading the source line's
        // format after that point would read a line that is already gone. The ordering is the fix
        // and it is not observable from the copy path alone once the delete has happened.
        const handler = source().slice(source().indexOf('export const onCopy'))
        const resolve = handler.indexOf('resolveCopiedBlockTail(')
        const cut = handler.indexOf('deleteFromDocument()')
        const append = handler.indexOf('selectedContent.ops.push(copiedBlockTail)')

        expect(resolve).toBeGreaterThan(-1)
        expect(cut).toBeGreaterThan(-1)
        expect(resolve).toBeLessThan(cut)
        expect(cut).toBeLessThan(append)
    })

    it('appends the tail only after text/plain has been built', () => {
        const handler = source().slice(source().indexOf('export const onCopy'))

        expect(handler.indexOf("setData('text/plain'")).toBeGreaterThan(
            handler.indexOf('selectedContent.ops.push(copiedBlockTail)')
        )
        // The plain flavour is accumulated in the loop, which must not see the restored terminator.
        expect(handler.indexOf('let parsedText')).toBeLessThan(
            handler.indexOf('selectedContent.ops.push(copiedBlockTail)')
        )
    })
})

describe('the notes paste handler wiring this suite replicates (AT-2526)', () => {
    const source = () => readFileSync(join(__dirname, '../../NotesView/NotesDV/EditorView/NotesEditorView.js'), 'utf8')

    it('still routes clipboard HTML through the tokenizer this suite drives', () => {
        const handler = source().slice(source().indexOf('const convertPastedClipboard'))

        expect(handler).toMatch(/editor\.clipboard\.convert\(\{ html: htmlData \}\)/)
        expect(handler).toMatch(/processPastedTextWithBreakLines\(/)
        expect(handler).toMatch(/containsMarkdown\(textData\)/)
    })
})
