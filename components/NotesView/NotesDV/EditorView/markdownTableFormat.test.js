/**
 * @jest-environment jsdom
 *
 * Migration Stage 4: the markdown-table blot must be a BLOCK embed under quill 2.
 * The quill-1 era inline Embed (span) put the cursor-guard text nodes inside a
 * contenteditable=false span, which broke caret placement on the lines around a
 * pasted table (staging QA: clicking above the table could not position the
 * cursor). Rendered through a real quill 2 instance, the table must be its own
 * block-level line with editable paragraphs around it, and the embed value must
 * round-trip through getContents unchanged.
 */
import Quill from 'quill'

import MarkdownTableFormat from './MarkdownTableFormat'

Quill.register('formats/markdownTable', MarkdownTableFormat, true)

// This jest's jsdom has no usable Selection API; quill's Selection module tolerates a
// null native selection, so stub it out for construction.
document.getSelection = () => null

const TABLE_VALUE = {
    rows: [
        ['Header A', 'Header B'],
        ['cell **bold**', 'cell 2'],
    ],
    alignments: ['left', 'right'],
}

const buildEditor = () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    return new Quill(container)
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('MarkdownTableFormat under quill 2', () => {
    it('renders as a block-level line of the editor, not inline content', () => {
        const quill = buildEditor()
        quill.setContents([{ insert: 'above\n' }, { insert: { markdownTable: TABLE_VALUE } }, { insert: 'below\n' }])

        const editor = quill.root
        const tableNode = editor.querySelector('.ql-markdownTable')
        expect(tableNode).not.toBeNull()
        expect(tableNode.tagName).toBe('DIV')
        // Block embed: a direct child line of the editor root, so the paragraphs
        // above and below stay separate, clickable lines.
        expect(tableNode.parentElement).toBe(editor)
        const childTags = Array.from(editor.children).map(el => el.tagName)
        expect(childTags[0]).toBe('P')
        expect(childTags).toContain('DIV')
        expect(editor.children[0].textContent).toBe('above')
        expect(tableNode.querySelector('table.ql-markdown-table')).not.toBeNull()
        expect(tableNode.querySelectorAll('th')).toHaveLength(2)
    })

    it('round-trips the table value through getContents', () => {
        const quill = buildEditor()
        quill.setContents([{ insert: { markdownTable: TABLE_VALUE } }, { insert: 'tail\n' }])
        const ops = quill.getContents().ops
        const tableOp = ops.find(op => op.insert && op.insert.markdownTable)
        expect(tableOp.insert.markdownTable).toEqual({ rows: TABLE_VALUE.rows, alignments: TABLE_VALUE.alignments })
    })

    it('keeps legacy documents loadable (table followed by its old newline separator)', () => {
        const quill = buildEditor()
        // Old inline-embed docs stored the table INSIDE a line, i.e. followed by a
        // '\n' op; as a block embed that newline becomes a small empty paragraph
        // after the table — content must stay intact and ordered.
        quill.setContents([
            { insert: 'above\n' },
            { insert: { markdownTable: TABLE_VALUE } },
            { insert: '\n' },
            { insert: 'below\n' },
        ])
        const text = quill.getText()
        expect(text).toContain('above')
        expect(text).toContain('below')
        const editor = quill.root
        const order = Array.from(editor.children).map(el =>
            el.classList.contains('ql-markdownTable') ? 'table' : el.textContent
        )
        expect(order[0]).toBe('above')
        expect(order[1]).toBe('table')
        expect(order[order.length - 1]).toBe('below')
    })
})
