const { containsMarkdown, getMarkdownTableAt, insertMarkdownToYjs } = require('./markdownToYjs')
const { deltaToMarkdown } = require('./deltaToMarkdown')

class MockYText {
    constructor() {
        this.ops = []
    }

    insert(position, insert, attributes) {
        const op = { position, insert }
        if (attributes) {
            op.attributes = attributes
        }
        this.ops.push(op)
    }
}

describe('assistant markdown table conversion', () => {
    const tableMarkdown = ['| Name | Status | Score |', '| :--- | :---: | ---: |', '| Alpha | Done | 10 |'].join('\n')

    test('detects and parses markdown tables', () => {
        expect(containsMarkdown(tableMarkdown)).toBe(true)
        expect(getMarkdownTableAt(tableMarkdown.split('\n'), 0)).toEqual({
            rows: [
                ['Name', 'Status', 'Score'],
                ['Alpha', 'Done', '10'],
            ],
            alignments: ['left', 'center', 'right'],
            endIndex: 2,
        })
    })

    test('inserts markdown tables as Quill-compatible embeds', () => {
        const ytext = new MockYText()

        insertMarkdownToYjs(ytext, 0, tableMarkdown)

        expect(ytext.ops).toEqual([
            {
                position: 0,
                insert: {
                    markdownTable: {
                        rows: [
                            ['Name', 'Status', 'Score'],
                            ['Alpha', 'Done', '10'],
                        ],
                        alignments: ['left', 'center', 'right'],
                    },
                },
            },
        ])
    })

    test('exports markdown table embeds back to markdown', () => {
        const markdown = deltaToMarkdown([
            {
                insert: {
                    markdownTable: {
                        rows: [
                            ['Name', 'Status'],
                            ['Alpha', 'Done'],
                        ],
                        alignments: ['left', 'center'],
                    },
                },
            },
        ])

        expect(markdown).toBe(['| Name | Status |', '| :--- | :---: |', '| Alpha | Done |'].join('\n'))
    })
})
