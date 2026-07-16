import {
    containsMarkdown,
    getMarkdownTableAt,
    getMarkdownTableColumnWidths,
    parseMarkdownLines,
    splitMarkdownTableRow,
} from './markdownParserFunctions'
import {
    containsMarkdown as notesContainsMarkdown,
    getMarkdownTableAt as getNotesMarkdownTableAt,
} from '../../../NotesView/NotesDV/EditorView/markdownToDelta'

describe('markdownParserFunctions', () => {
    describe('markdown tables', () => {
        it('groups a markdown table into one normalized block', () => {
            const text = [
                'For now I would treat browser voice as:',
                '',
                '| Platform | Lock-screen mic reliability |',
                '| --- | --- |',
                '| Desktop web | Good |',
                '| Android Chrome web | Sometimes possible, not guaranteed |',
                '| iOS Safari / PWA | Not reliable / effectively unsupported |',
                '| Native Android/iOS | Reliable if implemented correctly |',
                '',
                'So yes, there is one thing we should still do.',
            ].join('\n')

            const lines = parseMarkdownLines(text)

            expect(lines[2]).toEqual({
                type: 'table',
                rows: [
                    ['Platform', 'Lock-screen mic reliability'],
                    ['Desktop web', 'Good'],
                    ['Android Chrome web', 'Sometimes possible, not guaranteed'],
                    ['iOS Safari / PWA', 'Not reliable / effectively unsupported'],
                    ['Native Android/iOS', 'Reliable if implemented correctly'],
                ],
                alignments: [null, null],
                endIndex: 7,
            })
            expect(lines[3]).toEqual({ type: 'text', text: '' })
            expect(lines[4]).toEqual({
                type: 'text',
                text: 'So yes, there is one thing we should still do.',
                segments: [
                    {
                        text: 'So yes, there is one thing we should still do.',
                        bold: false,
                        italic: false,
                        strikethrough: false,
                    },
                ],
            })
        })

        it('normalizes rows with missing cells to the table column count', () => {
            const lines = parseMarkdownLines('| One | Two | Three |\n| --- | --- | --- |\n| Value | Only two |')

            expect(lines[0].rows).toEqual([
                ['One', 'Two', 'Three'],
                ['Value', 'Only two', ''],
            ])
        })

        it('accepts malformed two-dash delimiter cells from assistant output', () => {
            const text = [
                '| Month | Earn | Spend | Refund | Adjust (top-ups) | Net | Txns | Spend/day |',
                '|---|--:|--:|--:|--:|--:|--:|--:|',
                '| 2026-06 | 24,910 | 1,337,924 | 294 | 1,730,639 | +417,919 | 7,997 | ~44,597 |',
            ].join('\n')

            expect(parseMarkdownLines(text)[0]).toEqual({
                type: 'table',
                rows: [
                    ['Month', 'Earn', 'Spend', 'Refund', 'Adjust (top-ups)', 'Net', 'Txns', 'Spend/day'],
                    ['2026-06', '24,910', '1,337,924', '294', '1,730,639', '+417,919', '7,997', '~44,597'],
                ],
                alignments: [null, 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                endIndex: 2,
            })
        })

        it('splits escaped pipe characters inside cells', () => {
            expect(splitMarkdownTableRow('| Platform | Browser \\| PWA |')).toEqual(['Platform', 'Browser | PWA'])
        })

        it('does not treat pipe text without a separator row as markdown', () => {
            const text = 'Use Anna | Ask Anna when discussing naming.'

            expect(containsMarkdown(text)).toBe(false)
            expect(parseMarkdownLines(text)[0].type).toBe('text')
        })

        it('calculates one shared width per table column', () => {
            expect(
                getMarkdownTableColumnWidths([
                    ['A', 'Long header'],
                    ['Short', 'Value'],
                ])
            ).toHaveLength(2)
        })

        it('uses the same table block parsing for notes markdown conversion', () => {
            const lines = ['| Platform | Reliability |', '| --- | --- |', '| Desktop web | Good |']

            expect(notesContainsMarkdown(lines.join('\n'))).toBe(true)
            expect(getNotesMarkdownTableAt(lines, 0)).toEqual(getMarkdownTableAt(lines, 0))
        })
    })
})
