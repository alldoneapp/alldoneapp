import { hasContentBeforeLine, MARKDOWN_HEADING_TOP_MARGIN } from './markdownLayout'

describe('markdown heading layout', () => {
    const lines = [
        { type: 'h1', text: 'Opening heading' },
        { type: 'text', text: '' },
        { type: 'text', text: 'Paragraph' },
        { type: 'bullet', text: 'List item' },
        { type: 'h2', text: 'Later heading' },
    ]

    test('keeps a heading at the beginning of content free of extra top spacing', () => {
        expect(hasContentBeforeLine(lines, 0)).toBe(false)
        expect(MARKDOWN_HEADING_TOP_MARGIN).toBe(16)
    })

    test('ignores leading blank lines when deciding whether content precedes a heading', () => {
        expect(hasContentBeforeLine([{ type: 'text', text: '' }, lines[0]], 1)).toBe(false)
    })

    test('detects paragraph, list, and earlier rendered sections before a heading', () => {
        expect(hasContentBeforeLine(lines, 4)).toBe(true)
        expect(hasContentBeforeLine([lines[4]], 0, true)).toBe(true)
    })
})
