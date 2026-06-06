// Mock the HelperFunctions dependency to avoid native module issues in tests
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    BREAKLINE_CODE: 'BREAKLINE',
}))

import {
    parseMarkdownLines,
    containsMarkdown,
    getMarkdownTableAt,
    splitMarkdownTableRow,
} from './markdownParserFunctions'

describe('markdown table detection in chat/feed', () => {
    // The exact problematic example from the bug report
    const assistantOutput = [
        'Product recommendation',
        '',
        'For now I\u2019d treat browser voice as:',
        '',
        '| Platform | Lock-screen mic reliability |',
        '|---|---|',
        '| Desktop web | Good |',
        '| Android Chrome web | Sometimes possible, not guaranteed |',
        '| iOS Safari / PWA | Not reliable / effectively unsupported |',
        '| Native Android/iOS | Reliable if implemented correctly |',
    ].join('\n')

    test('containsMarkdown detects the table in assistant output', () => {
        expect(containsMarkdown(assistantOutput)).toBe(true)
    })

    test('parseMarkdownLines produces a table block for the assistant output', () => {
        const parsed = parseMarkdownLines(assistantOutput)

        // Find the table entry
        const tableEntry = parsed.find(line => line.type === 'table')
        expect(tableEntry).toBeDefined()
        expect(tableEntry.rows).toEqual([
            ['Platform', 'Lock-screen mic reliability'],
            ['Desktop web', 'Good'],
            ['Android Chrome web', 'Sometimes possible, not guaranteed'],
            ['iOS Safari / PWA', 'Not reliable / effectively unsupported'],
            ['Native Android/iOS', 'Reliable if implemented correctly'],
        ])
        expect(tableEntry.alignments).toEqual([null, null])
    })

    test('text before and after the table is preserved as separate entries', () => {
        const parsed = parseMarkdownLines(assistantOutput)
        // First line should be normal text
        expect(parsed[0].type).toBe('text')
        expect(parsed[0].text).toBe('Product recommendation')
        // Should have some text lines, then the table
        const types = parsed.map(p => p.type)
        expect(types).toContain('table')
        expect(types).toContain('text')
    })

    test('detects table with alignment markers', () => {
        const tableText = ['| Name | Status | Score |', '| :--- | :---: | ---: |', '| Alpha | Done | 10 |'].join('\n')

        expect(containsMarkdown(tableText)).toBe(true)

        const parsed = parseMarkdownLines(tableText)
        const tableEntry = parsed.find(line => line.type === 'table')
        expect(tableEntry).toBeDefined()
        expect(tableEntry.rows).toEqual([
            ['Name', 'Status', 'Score'],
            ['Alpha', 'Done', '10'],
        ])
        expect(tableEntry.alignments).toEqual(['left', 'center', 'right'])
    })

    test('detects table with extra whitespace around pipes', () => {
        const tableText = ['|  Platform  |  Status  |', '|  ---  |  ---  |', '|  Web  |  OK  |'].join('\n')

        const parsed = parseMarkdownLines(tableText)
        const tableEntry = parsed.find(line => line.type === 'table')
        expect(tableEntry).toBeDefined()
        expect(tableEntry.rows).toEqual([
            ['Platform', 'Status'],
            ['Web', 'OK'],
        ])
    })

    test('detects table with compact separator (|---|---|)', () => {
        const tableText = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')

        const parsed = parseMarkdownLines(tableText)
        const tableEntry = parsed.find(line => line.type === 'table')
        expect(tableEntry).toBeDefined()
        expect(tableEntry.rows).toEqual([
            ['A', 'B'],
            ['1', '2'],
        ])
    })

    test('detects table with long separator dashes', () => {
        const tableText = ['| Col1 | Col2 |', '|---------|---------|', '| a | b |'].join('\n')

        const parsed = parseMarkdownLines(tableText)
        const tableEntry = parsed.find(line => line.type === 'table')
        expect(tableEntry).toBeDefined()
    })

    test('does not false-positive on prose containing pipes', () => {
        const proseText = 'The value is 5 | 10 depending on conditions.'
        expect(containsMarkdown(proseText)).toBe(false)

        const parsed = parseMarkdownLines(proseText)
        expect(parsed.every(line => line.type !== 'table')).toBe(true)
    })

    test('does not false-positive on single pipe lines', () => {
        const text = 'a | b\nc | d'
        const parsed = parseMarkdownLines(text)
        // These are just prose lines with pipes, not a table (no separator row)
        expect(parsed.every(line => line.type !== 'table')).toBe(true)
    })

    test('does not treat separator-only rows as a table without header', () => {
        const text = '|---|---|\n| a | b |'
        const parsed = parseMarkdownLines(text)
        // A table must have header + separator, not separator as first row
        expect(parsed.every(line => line.type !== 'table')).toBe(true)
    })

    test('handles table with only header and separator (no data rows)', () => {
        const tableText = ['| H1 | H2 |', '|---|---|'].join('\n')

        const parsed = parseMarkdownLines(tableText)
        const tableEntry = parsed.find(line => line.type === 'table')
        expect(tableEntry).toBeDefined()
        expect(tableEntry.rows).toEqual([['H1', 'H2']])
    })

    test('handles table embedded between other markdown', () => {
        const text = ['# Title', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '- bullet item'].join('\n')

        const parsed = parseMarkdownLines(text)
        const types = parsed.map(p => p.type)
        expect(types).toContain('h1')
        expect(types).toContain('table')
        expect(types).toContain('bullet')
    })

    test('handles multiple tables in the same text', () => {
        const text = [
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |',
            '',
            'Some text between',
            '',
            '| X | Y |',
            '| --- | --- |',
            '| 3 | 4 |',
        ].join('\n')

        const parsed = parseMarkdownLines(text)
        const tables = parsed.filter(p => p.type === 'table')
        expect(tables).toHaveLength(2)
        expect(tables[0].rows[0]).toEqual(['A', 'B'])
        expect(tables[1].rows[0]).toEqual(['X', 'Y'])
    })
})

describe('table helper functions', () => {
    test('getMarkdownTableAt returns null for non-table lines', () => {
        const lines = ['Just some text', 'Another line']
        expect(getMarkdownTableAt(lines, 0)).toBeNull()
    })

    test('getMarkdownTableAt parses correctly at offset', () => {
        const lines = ['preamble', '| A | B |', '|---|---|', '| 1 | 2 |']
        expect(getMarkdownTableAt(lines, 0)).toBeNull()
        const table = getMarkdownTableAt(lines, 1)
        expect(table).not.toBeNull()
        expect(table.rows).toEqual([
            ['A', 'B'],
            ['1', '2'],
        ])
        expect(table.endIndex).toBe(3)
    })

    test('splitMarkdownTableRow handles escaped pipes', () => {
        const cells = splitMarkdownTableRow('| hello \\| world | foo |')
        expect(cells).toEqual(['hello | world', 'foo'])
    })

    test('splitMarkdownTableRow handles cells without outer pipes', () => {
        const cells = splitMarkdownTableRow('A | B | C')
        expect(cells).toEqual(['A', 'B', 'C'])
    })
})
