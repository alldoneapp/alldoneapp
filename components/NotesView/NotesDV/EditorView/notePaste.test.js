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
import { readFileSync } from 'fs'
import { join } from 'path'

import Quill from 'quill'

import {
    applyPastedClipboard,
    applyPastedDeltaToEditor,
    blockAttributesOf,
    countTrailingLineBreaks,
    dropSurplusTrailingLineBreaks,
    noteEditorOwnsPaste,
    normalizePastedLineEndings,
    settlePastedBlockTail,
} from './notePaste'
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

/**
 * AT-2519. "It still happens when I copy + paste a text e.g. from MS Teams into a note, the cursor
 * is not at the end of the pasted text but at the beginning .. I thought we fixed this already?"
 *
 * It is the same defect as AT-2469 and it was half fixed. Both quill's own trim and the block-tail
 * rewrite remove exactly ONE line terminator, which is only enough while the clipboard ends in
 * exactly one — and every rich-text application ends a copied block with an empty one (Teams and
 * Outlook append `<div><br></div>`, Word appends `<p><o:p>&nbsp;</o:p></p>`).
 *
 * What decides whether the symptom shows is not what was copied but WHERE FROM, which is why it
 * reads as intermittent and why "copy inside Alldone" always looked fixed. Quill's trim is skipped
 * whenever the trailing op carries attributes — inline ones included — and external HTML always
 * carries `color` / `background` / `font` on it. The two tests named "the deciding factor" below
 * paste byte-identical markup with and without a `style` attribute and show the fix closing the
 * gap between them.
 */
const STYLE = 'color: rgb(36, 36, 36); background-color: rgb(255, 255, 255)'

/**
 * The tail rule exactly as AT-2469 shipped it: one terminator, taken off the last op only. Kept so
 * the tests can show that the code before AT-2519 really does reproduce the reported symptom on
 * the very same clipboard payload.
 */
const settleTheAT2469Way = (pastedDelta, editor, pasteEndIndex) => {
    const ops = pastedDelta.ops
    const lastOp = ops[ops.length - 1]
    if (!lastOp || typeof lastOp.insert !== 'string' || !lastOp.insert.endsWith('\n'))
        return { delta: pastedDelta, caretBackstep: 0 }

    const blockAttributes = blockAttributesOf(lastOp.attributes, editor)
    if (blockAttributes && editor.getText(pasteEndIndex, 1) !== '\n') return { delta: pastedDelta, caretBackstep: 1 }

    const head = lastOp.insert.slice(0, -1)
    const settledOps = ops.slice(0, -1)
    if (head !== '')
        settledOps.push(lastOp.attributes ? { insert: head, attributes: lastOp.attributes } : { insert: head })
    if (blockAttributes) settledOps.push({ retain: 1, attributes: blockAttributes })
    if (settledOps.length === 0) return { delta: pastedDelta, caretBackstep: 0 }
    return { delta: new Delta(settledOps), caretBackstep: 0 }
}

const applyPastedDeltaTheAT2469Way = (editor, contentDelta) => {
    const selection = editor.getSelection(true) || { index: 0, length: 0 }
    const { delta, caretBackstep } = settleTheAT2469Way(contentDelta, editor, selection.index + selection.length)
    const ops = [...delta.ops]
    if (selection.length > 0) ops.unshift({ delete: selection.length })
    if (selection.index > 0) ops.unshift({ retain: selection.index })

    const lengthBefore = editor.getLength()
    editor.updateContents({ ops }, 'user')
    const inserted = editor.getLength() - lengthBefore + selection.length
    editor.setSelection(Math.max(selection.index, selection.index + inserted - caretBackstep), 0, 'user')
}

describe('countTrailingLineBreaks', () => {
    it('counts a run that quill split across ops', () => {
        // A pasted list: the terminator of the last item and the empty item after it are their own
        // ops, so a rule that only looks at the last op sees one newline where there are two.
        const ops = [
            { insert: 'one', attributes: { list: 'bullet' } },
            { insert: '\n', attributes: { list: 'bullet' } },
            { insert: '\n', attributes: { list: 'bullet' } },
        ]

        expect(countTrailingLineBreaks(ops)).toEqual({ count: 2, isOnlyLineBreaks: false })
    })

    it('counts a run merged into a single op', () => {
        expect(countTrailingLineBreaks([{ insert: 'Hello\n\n', attributes: { color: '#242424' } }])).toEqual({
            count: 2,
            isOnlyLineBreaks: false,
        })
    })

    it('stops at an embed, because an embed is content', () => {
        expect(countTrailingLineBreaks([{ insert: 'a\n' }, { insert: { image: 'x.png' } }])).toEqual({
            count: 0,
            isOnlyLineBreaks: false,
        })
    })

    it('reports a delta that is nothing but line breaks', () => {
        expect(countTrailingLineBreaks([{ insert: '\n' }, { insert: '\n' }])).toEqual({
            count: 2,
            isOnlyLineBreaks: true,
        })
    })

    it('counts nothing when the delta does not end in a newline', () => {
        expect(countTrailingLineBreaks([{ insert: 'hello' }])).toEqual({ count: 0, isOnlyLineBreaks: false })
    })
})

describe('dropSurplusTrailingLineBreaks', () => {
    it('keeps the terminator of the last line that carries content', () => {
        const ops = [{ insert: 'Hello\n\n', attributes: { color: '#242424' } }]

        expect(dropSurplusTrailingLineBreaks(ops)).toEqual([{ insert: 'Hello\n', attributes: { color: '#242424' } }])
    })

    it('drops whole ops when the surplus run is spread over several of them', () => {
        const ops = [
            { insert: 'one', attributes: { list: 'bullet' } },
            { insert: '\n', attributes: { list: 'bullet' } },
            { insert: '\n', attributes: { list: 'bullet' } },
            { insert: '\n' },
        ]

        expect(dropSurplusTrailingLineBreaks(ops)).toEqual([
            { insert: 'one', attributes: { list: 'bullet' } },
            { insert: '\n', attributes: { list: 'bullet' } },
        ])
    })

    it('returns the very same array when there is nothing surplus', () => {
        // Identity matters: `settlePastedBlockTail` uses it to keep returning the caller's own
        // delta object for every case AT-2469 already handled.
        const ops = [{ insert: 'Hello\n' }]

        expect(dropSurplusTrailingLineBreaks(ops)).toBe(ops)
    })

    it('leaves a clipboard that is nothing but line breaks alone', () => {
        const ops = [{ insert: '\n\n' }]

        expect(dropSurplusTrailingLineBreaks(ops)).toBe(ops)
    })

    it('never touches a blank line that sits INSIDE the pasted text', () => {
        const ops = [{ insert: 'A\n\nB\n', attributes: { color: '#242424' } }]

        expect(dropSurplusTrailingLineBreaks(ops)).toBe(ops)
    })
})

describe('normalizePastedLineEndings', () => {
    it('turns a Windows clipboard into the line endings every reader here splits on', () => {
        expect(normalizePastedLineEndings('one\r\ntwo\r\n')).toBe('one\ntwo\n')
    })

    it('handles a lone carriage return', () => {
        expect(normalizePastedLineEndings('one\rtwo')).toBe('one\ntwo')
    })

    it('passes anything that is not a string straight through', () => {
        expect(normalizePastedLineEndings(undefined)).toBeUndefined()
        expect(normalizePastedLineEndings(null)).toBeNull()
    })
})

describe('applyPastedDeltaToEditor — pasting out of another application (AT-2519)', () => {
    it('leaves the caret at the end of text copied from Teams, not on the blank line after it', () => {
        // Teams/Outlook shape: a styled block followed by the empty block they always append.
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const html = `<p style="${STYLE}">item</p><p style="${STYLE}"><br></p>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('is the exact case the AT-2469 rule still got wrong', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const html = `<p style="${STYLE}">item</p><p style="${STYLE}"><br></p>`

        applyPastedDeltaTheAT2469Way(editor, convertHtml(editor, html))

        // A surplus empty line, with the caret parked at the beginning of it — the report.
        expect(editor.getText()).toBe('helloitem\n\n')
        expect(editor.getSelection().index).toBe(10)
    })

    it('the deciding factor is the inline style, not the markup: unstyled always looked fine', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        // Byte-identical markup minus the style attribute. Quill's own trim applies here because
        // the trailing op carries no attributes, so AT-2469 already produced the right caret.
        applyPastedDeltaTheAT2469Way(editor, convertHtml(editor, '<p>item</p><p><br></p>'))

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('the deciding factor is the inline style, not the markup: styled is what broke', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        const styled = convertHtml(editor, `<p style="${STYLE}">item</p><p style="${STYLE}"><br></p>`)
        const plain = convertHtml(editor, '<p>item</p><p><br></p>')

        // Quill hands the two payloads a different number of terminators for the same markup, and
        // that difference is the whole bug.
        expect(countTrailingLineBreaks(styled.ops).count).toBe(2)
        expect(countTrailingLineBreaks(plain.ops).count).toBe(1)

        applyPastedDeltaToEditor(editor, styled, Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('stops after the last item of a list that ends with an empty one', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const html = `<ul><li><span style="${STYLE}">one</span></li><li></li></ul>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('helloone\n')
        expect(editor.getSelection().index).toBe(8)
        // The block format survives; the caret also carries the inline colours Teams copied.
        expect(editor.getFormat(8).list).toBe('bullet')
    })

    it('absorbs however many blank lines the clipboard trails', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const html = `<div><span style="${STYLE}">item</span></div><div><br></div><div><br></div>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('settles a styled heading onto the destination line', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const html = `<h2 style="${STYLE}">Title</h2><p style="${STYLE}"><br></p>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('helloTitle\n')
        expect(editor.getSelection().index).toBe(10)
        expect(editor.getFormat(10).header).toBe(2)
    })

    it('keeps the blank line a copied message has BETWEEN its paragraphs', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const html = `<p style="${STYLE}">one</p><p style="${STYLE}"><br></p><p style="${STYLE}">two</p>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('helloone\n\ntwo\n')
        expect(editor.getSelection().index).toBe(13)
    })

    it('drops the trailing blank line of text arriving through the plain-text branch', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, new Delta().insert('item\n\n'), Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('drops the trailing blank line of markdown arriving through the markdown branch', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)

        applyPastedDeltaToEditor(editor, markdownToDelta('- one\n- two\n\n', Delta), Delta)

        expect(editor.getText()).toBe('helloone\ntwo\n')
        expect(editor.getSelection().index).toBe(12)
        expect(editor.getFormat(12)).toEqual({ list: 'bullet' })
    })

    it('still splits the line for a mid-line paste and stops the caret at the pasted text', () => {
        const editor = buildEditor(new Delta().insert('hello world\n'), 5)
        const html = `<ul><li><span style="${STYLE}">item</span></li><li></li></ul>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('helloitem\n world\n')
        expect(editor.getFormat(9).list).toBe('bullet')
        expect(editor.getSelection().index).toBe(9)
    })

    it('pastes a styled Teams block into an empty note without opening a second line', () => {
        const editor = buildEditor(new Delta().insert('\n'), 0)
        const html = `<div><span style="${STYLE}">Line one</span></div><div><span style="${STYLE}">Line two</span></div><div><br></div>`

        applyPastedDeltaToEditor(editor, convertHtml(editor, html), Delta)

        expect(editor.getText()).toBe('Line one\nLine two\n')
        expect(editor.getSelection().index).toBe(17)
    })

    it('is still one undo step (AT-2440)', () => {
        const editor = buildEditor(new Delta().insert('\n'), 0)
        editor.insertText(0, 'typed', 'user')
        editor.setSelection(5, 0)

        applyPastedDeltaToEditor(
            editor,
            convertHtml(editor, `<p style="${STYLE}">item</p><p style="${STYLE}"><br></p>`),
            Delta
        )
        expect(editor.getText()).toBe('typeditem\n')

        editor.history.undo()

        expect(editor.getText()).toBe('typed\n')
    })
})

describe('noteEditorOwnsPaste (AT-2519)', () => {
    const enabled = { isEnabled: () => true }

    it('takes a paste that carries text', () => {
        expect(noteEditorOwnsPaste({ readOnly: false, editor: enabled, textData: 'x', htmlData: '' })).toBe(true)
    })

    it('takes a paste that carries only html', () => {
        expect(noteEditorOwnsPaste({ readOnly: false, editor: enabled, textData: '', htmlData: '<p>x</p>' })).toBe(true)
    })

    it('hands back a clipboard with neither, so an image still reaches the uploader', () => {
        expect(noteEditorOwnsPaste({ readOnly: false, editor: enabled, textData: '', htmlData: '' })).toBe(false)
    })

    it('hands back a read-only note', () => {
        expect(noteEditorOwnsPaste({ readOnly: true, editor: enabled, textData: 'x', htmlData: '' })).toBe(false)
    })

    it('hands back a DISABLED editor, which the read-only flag does not cover', () => {
        // Quill ignores a `user` update on a disabled editor and reports success, so owning the
        // paste there means consuming the event and inserting nothing.
        const disabled = { isEnabled: () => false }

        expect(noteEditorOwnsPaste({ readOnly: false, editor: disabled, textData: 'x', htmlData: '' })).toBe(false)
    })

    it('survives an editor that cannot answer', () => {
        expect(noteEditorOwnsPaste({ readOnly: false, editor: null, textData: 'x', htmlData: '' })).toBe(false)
        expect(noteEditorOwnsPaste({ readOnly: false, editor: {}, textData: 'x', htmlData: '' })).toBe(true)
    })
})

describe('applyPastedClipboard (AT-2519)', () => {
    it('applies what the conversion produced', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const convert = () => new Delta().insert('item')

        expect(applyPastedClipboard(editor, { textData: 'item', htmlData: '' }, convert, Delta)).toBe('converted')
        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
    })

    it('falls back to the plain text when the conversion throws, caret included', () => {
        // The failure this exists for: the handler used to call preventDefault() only after the
        // conversion, so a throw handed the paste to the BROWSER — the text appeared, inserted by
        // the browser itself, and the caret never moved off the paste position. That is
        // indistinguishable from a caret bug.
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const convert = () => {
            throw new Error('[Parchment] Unable to create nonsense blot')
        }
        const reported = jest.spyOn(console, 'error').mockImplementation(() => {})

        expect(applyPastedClipboard(editor, { textData: 'item', htmlData: '<x>' }, convert, Delta)).toBe(
            'plain-text-fallback'
        )
        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)
        expect(reported).toHaveBeenCalled()

        reported.mockRestore()
    })

    it('reports a failure it cannot even degrade, rather than pretending', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const convert = () => {
            throw new Error('boom')
        }
        const reported = jest.spyOn(console, 'error').mockImplementation(() => {})

        expect(applyPastedClipboard(editor, { textData: '', htmlData: '<x>' }, convert, Delta)).toBe('failed')
        expect(editor.getText()).toBe('hello\n')

        reported.mockRestore()
    })

    it('still trims the trailing blank lines on the fallback path', () => {
        const editor = buildEditor(new Delta().insert('hello\n'), 5)
        const convert = () => {
            throw new Error('boom')
        }
        const reported = jest.spyOn(console, 'error').mockImplementation(() => {})

        applyPastedClipboard(editor, { textData: 'item\n\n', htmlData: '<x>' }, convert, Delta)

        expect(editor.getText()).toBe('helloitem\n')
        expect(editor.getSelection().index).toBe(9)

        reported.mockRestore()
    })
})

describe('the notes paste handler wiring (AT-2519)', () => {
    const source = () => readFileSync(join(__dirname, 'NotesEditorView.js'), 'utf8')

    it('reads the clipboard text through the line-ending normalizer', () => {
        // A source ratchet: the CRLF defect is invisible from notePaste alone, because by the time
        // the delta reaches it `processPastedTextWithBreakLines` has already turned each stray
        // '\r' into a trailing space. The only thing to pin is that the handler never reads the
        // raw string again.
        //
        // Whitespace-insensitive: prettier reflows this call as soon as the line grows.
        expect(source()).toMatch(
            /normalizePastedLineEndings\(\s*\(event\.clipboardData \|\| window\.clipboardData\)\.getData\('text'\)\s*\)/
        )
    })

    it('claims the event before doing the work, never after', () => {
        // The ordering IS the fix, and it is not observable from notePaste: a `preventDefault()`
        // that runs after the conversion is exactly what lets a throw hand the paste back to the
        // browser. Pin that the listener decides, prevents, and only then converts.
        const listener = source().slice(source().indexOf("addEventListener('paste'"))
        const prevent = listener.indexOf('event.preventDefault()')
        const apply = listener.indexOf('applyPastedClipboard(')

        expect(prevent).toBeGreaterThan(-1)
        expect(apply).toBeGreaterThan(-1)
        expect(prevent).toBeLessThan(apply)
    })

    it('decides ownership through the shared rule rather than its own flag check', () => {
        const listener = source().slice(source().indexOf("addEventListener('paste'"))

        expect(listener).toMatch(/if \(!noteEditorOwnsPaste\(/)
    })
})
