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

describe('meeting transcript markdown conversion', () => {
    test('converts headers, underscore italics, and uploaded screenshots', () => {
        const ytext = new MockYText()
        const imageUrl = 'https://firebasestorage.googleapis.com/example.jpg?token=abc'

        insertMarkdownToYjs(ytext, 0, `# Meeting Notes\n\n_Duration: 1 min_\n\n![Screenshot at 0:04](<${imageUrl}>)`, {
            editorId: 'note-1',
        })

        expect(ytext.ops).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '\n', attributes: { header: 1 } }),
                expect.objectContaining({
                    insert: 'Duration: 1 min',
                    attributes: expect.objectContaining({ italic: true }),
                }),
                expect.objectContaining({
                    insert: {
                        customImageFormat: expect.objectContaining({
                            text: 'Screenshot at 0:04',
                            uri: imageUrl,
                            resizedUri: imageUrl,
                            isNew: '0',
                            isLoading: '1',
                            editorId: 'note-1',
                        }),
                    },
                }),
            ])
        )
    })
})
