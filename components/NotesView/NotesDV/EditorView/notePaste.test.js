/**
 * @jest-environment jsdom
 *
 * AT-2469. "When I copy + paste in a note it still sometimes happens that after the paste the
 * cursor is at the beginning of the line and not at the end (+ whitespace). For example when I
 * copy + paste a bullet point."
 *
 * Root cause, and the reason it is intermittent rather than racy: quill 2's `Clipboard.convert`
 * ends by dropping the pasted content's trailing newline, but ONLY while that newline carries no
 * attributes:
 *
 *     if (deltaEndsWith(delta, '\n') && (delta.ops[delta.ops.length - 1].attributes == null || ...))
 *         return delta.compose(new Delta().retain(delta.length() - 1).delete(1))
 *
 * A line break is exactly where quill stores a BLOCK format, so a copied paragraph pastes as bare
 * text (trim applies, caret lands after it — "normal" paste always looked right), while a copied
 * bullet arrives as `insert('item') + insert('\n', { list: 'bullet' })`. Those attributes are what
 * make it a bullet, so the trim is skipped, the newline is inserted for real, and the paste
 * produces one line more than was copied. The caret is placed after everything that was inserted
 * and therefore lands at the START of that surplus line. Same for ordered lists, headings, quotes
 * and code blocks.
 *
 * These tests drive a REAL quill 2. The defect lives in how quill's clipboard conversion and
 * `applyDelta` compose with the app's caret arithmetic, so a mocked editor cannot express it: the
 * whole question is what the document length does, and which line a retained block format lands
 * on.
 */
import Quill from 'quill'

import { applyPastedDeltaToEditor, blockAttributesOf, settlePastedBlockTail } from './notePaste'
import { markdownToDelta } from './markdownToDelta'

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

/**
 * The arithmetic every notes paste branch used before AT-2469, kept so the tests can show that the
 * old code really does reproduce the reported symptom on the same input.
 */
const applyPastedDeltaTheOldWay = (editor, contentDelta) => {
    const ops = [...contentDelta.ops]
    const selection = editor.getSelection(true)
    if (selection.length > 0) ops.unshift({ delete: selection.length })
    if (selection.index > 0) ops.unshift({ retain: selection.index })

    const previousLength = editor.getLength()
    editor.updateContents({ ops }, 'user')
    const newLength = editor.getLength()
    editor.setSelection(selection.index + newLength - previousLength + selection.length, 0, 'user')
}

/** What quill's clipboard actually hands the notes paste handler for a given clipboard payload. */
const convertHtml = (editor, html) => editor.clipboard.convert({ html })

describe('settlePastedBlockTail', () => {
    it('turns a pasted bullet terminator into a format of the destination line', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('item').insert('\n', { list: 'bullet' })

        const { delta, caretBackstep } = settlePastedBlockTail(pasted, editor, 5, Delta)

        expect(delta.ops).toEqual([{ insert: 'item' }, { retain: 1, attributes: { list: 'bullet' } }])
        expect(caretBackstep).toBe(0)
    })

    it('drops an unformatted trailing newline outright, the way quill already does', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('one\ntwo\n')

        const { delta, caretBackstep } = settlePastedBlockTail(pasted, editor, 5, Delta)

        expect(delta.ops).toEqual([{ insert: 'one\ntwo' }])
        expect(caretBackstep).toBe(0)
    })

    it('splits a merged text-and-newline op so only the terminator is retained', () => {
        // Quill emits ONE op for a multi-item list: insert('one\ntwo\n', { list: 'bullet' }).
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('one\ntwo\n', { list: 'bullet' })

        const { delta } = settlePastedBlockTail(pasted, editor, 5, Delta)

        expect(delta.ops).toEqual([
            { insert: 'one\ntwo', attributes: { list: 'bullet' } },
            { retain: 1, attributes: { list: 'bullet' } },
        ])
    })

    it('leaves a mid-line block paste to quill and only asks for a caret backstep', () => {
        // The retained character has to BE the line terminator: quill applies a block format to
        // the line containing the retained range, so retaining an ordinary character formats the
        // wrong line and the bullet is lost entirely.
        const editor = buildEditor(new Delta().insert('hello world\n'), 5)
        const pasted = new Delta().insert('item').insert('\n', { list: 'bullet' })

        const { delta, caretBackstep } = settlePastedBlockTail(pasted, editor, 5, Delta)

        expect(delta).toBe(pasted)
        expect(caretBackstep).toBe(1)
    })

    it('never retains an inline format onto the line terminator', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('item\n', { bold: true, list: 'bullet' })

        const { delta } = settlePastedBlockTail(pasted, editor, 5, Delta)

        expect(delta.ops).toEqual([
            { insert: 'item', attributes: { bold: true, list: 'bullet' } },
            { retain: 1, attributes: { list: 'bullet' } },
        ])
    })

    it('leaves a delta that does not end in a newline alone', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('item')

        expect(settlePastedBlockTail(pasted, editor, 5, Delta)).toEqual({ delta: pasted, caretBackstep: 0 })
    })

    it('leaves a clipboard holding nothing but a line break alone', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('\n')

        expect(settlePastedBlockTail(pasted, editor, 5, Delta)).toEqual({ delta: pasted, caretBackstep: 0 })
    })

    it('leaves an embed-terminated delta alone', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const pasted = new Delta().insert('item').insert({ image: 'x.png' })

        expect(settlePastedBlockTail(pasted, editor, 5, Delta)).toEqual({ delta: pasted, caretBackstep: 0 })
    })

    it('reports no block attributes for an editor that registers none of them', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        expect(blockAttributesOf({ bold: true }, editor)).toBeNull()
        expect(blockAttributesOf(null, editor)).toBeNull()
        expect(blockAttributesOf({ list: 'bullet' }, editor)).toEqual({ list: 'bullet' })
    })
})

describe('applyPastedDeltaToEditor — a pasted bullet (AT-2469)', () => {
    it('leaves the caret behind the pasted text and adds no line', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
        expect(editor.getFormat(9)).toEqual({ list: 'bullet' })
    })

    it('is the exact case the previous arithmetic got wrong', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaTheOldWay(editor, convertHtml(editor, '<ul><li>item</li></ul>'))

        // A surplus empty line, with the caret parked at the beginning of it.
        expect(editor.getText()).toBe('helloitem\n\n')
        expect(editor.getSelection().index).toBe(10)
    })

    it('pastes into an empty note without opening a second line', () => {
        const editor = buildEditor(new Delta().insert('\n'), 0)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        expect(editor.getText()).toBe('item\n')
        expect(editor.getSelection().index).toBe(4)
    })

    it('appends to a bullet that is already there', () => {
        const editor = buildEditor(new Delta().insert('first').insert('\n', { list: 'bullet' }), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        expect(editor.getText()).toBe('firstitem\n')
        expect(editor.getSelection().index).toBe(9)
        expect(editor.getFormat(9)).toEqual({ list: 'bullet' })
    })

    it('keeps every item of a multi-item list and stops after the last one', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>one</li><li>two</li></ul>'), Delta)

        expect(editor.getText()).toBe('helloone\ntwo\n')
        expect(editor.getSelection().index).toBe(12)
        expect(editor.getContents().ops).toEqual([
            { insert: 'helloone' },
            { insert: '\n', attributes: { list: 'bullet' } },
            { insert: 'two' },
            { insert: '\n', attributes: { list: 'bullet' } },
        ])
    })

    it('keeps a nested item at its indent level', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>one</li><ul><li>two</li></ul></ul>'), Delta)

        expect(editor.getText()).toBe('helloone\ntwo\n')
        expect(editor.getFormat(12)).toEqual({ list: 'bullet', indent: 1 })
        expect(editor.getSelection().index).toBe(12)
    })

    it('replaces a selection at the end of a line', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 2, 3)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        expect(editor.getText()).toBe('heitem\n')
        expect(editor.getSelection().index).toBe(6)
    })

    it('still splits the line for a mid-line paste, but stops the caret at the pasted text', () => {
        const editor = buildEditor(new Delta().insert('hello world\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        // Structure is deliberately unchanged from before the fix — only the caret moved, from the
        // start of the remainder line (10) to the end of what was pasted (9).
        expect(editor.getText()).toBe('helloitem\n world\n')
        expect(editor.getFormat(9)).toEqual({ list: 'bullet' })
        expect(editor.getSelection().index).toBe(9)
    })
})

describe('applyPastedDeltaToEditor — the other block formats', () => {
    const cases = [
        ['an ordered list', '<ol><li>item</li></ol>', 'helloitem\n', 9, { list: 'ordered' }],
        ['a heading', '<h2>Title</h2>', 'helloTitle\n', 10, { header: 2 }],
        ['a quote', '<blockquote>quoted</blockquote>', 'helloquoted\n', 11, { blockquote: true }],
        ['a code block', '<pre>code</pre>', 'hellocode\n', 9, { 'code-block': 'plain' }],
    ]

    cases.forEach(([name, html, text, caret, format]) => {
        it(`settles ${name} onto the destination line`, () => {
            const editor = buildEditor(new Delta().insert('hello\n'), 5)

            applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

            expect(editor.getText()).toBe(text)
            expect(editor.getSelection().index).toBe(caret)
            expect(editor.getFormat(caret)).toEqual(format)
        })
    })

    it('replaces the destination line format rather than leaving an orphan of it', () => {
        const editor = buildEditor(new Delta().insert('hello').insert('\n', { header: 2 }), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getFormat(9)).toEqual({ list: 'bullet' })
    })
})

describe('applyPastedDeltaToEditor — behaviour that must not change', () => {
    it('pastes a plain paragraph exactly as before', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<p>item</p>'), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('pastes several plain paragraphs exactly as before', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<p>one</p><p>two</p>'), Delta)

        expect(editor.getText()).toBe('helloone\ntwo\n')
        expect(editor.getSelection().index).toBe(12)
    })

    it('pastes inline text exactly as before', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, 'item'), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('keeps the inline formats of the pasted content', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li><strong>item</strong></li></ul>'), Delta)

        expect(editor.getContents().ops).toEqual([
            { insert: 'hello' },
            { insert: 'item', attributes: { bold: true } },
            { insert: '\n', attributes: { list: 'bullet' } },
        ])
    })

    it('preserves the pasted content when the caret is between two lines', () => {
        const editor = buildEditor(new Delta().insert('a\nb\n'), 1)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)

        expect(editor.getText()).toBe('aitem\nb\n')
        expect(editor.getSelection().index).toBe(5)
    })

    it('does not leave a blank line behind plain text copied with its trailing newline', () => {
        // Copying a whole line out of another app usually puts "item\n" on the clipboard, and the
        // notes plain-text branch turns that into insert('item\n') — the same surplus line, minus
        // the block format.
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, new Delta().insert('item\n'), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('settles a bullet arriving through the markdown branch', () => {
        // "- item" on the clipboard takes markdownToDelta, not quill's clipboard, and ends in the
        // same block-formatted terminator.
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, markdownToDelta('- item', Delta), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
        expect(editor.getFormat(9)).toEqual({ list: 'bullet' })
    })

    it('settles a markdown heading through the markdown branch', () => {
        const editor = buildEditor(new Delta().insert('\n'), 0)

        applyPastedDeltaToEditor(editor, markdownToDelta('## Title', Delta), Delta)

        expect(editor.getText()).toBe('Title\n')
        expect(editor.getSelection().index).toBe(5)
        expect(editor.getFormat(5)).toEqual({ header: 2 })
    })

    it('undoes the whole paste in one step and nothing more (AT-2440)', () => {
        const editor = buildEditor(new Delta().insert('\n'), 0)
        editor.insertText(0, 'typed', 'user')
        editor.setSelection(5, 0)

        applyPastedDeltaToEditor(editor, convertHtml(editor, '<ul><li>item</li></ul>'), Delta)
        expect(editor.getText()).toBe('typeditem\n')

        editor.history.undo()

        expect(editor.getText()).toBe('typed\n')
        expect(editor.getFormat(0, 5)).toEqual({})
    })
})
