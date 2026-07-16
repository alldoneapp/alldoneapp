const { containsMarkdown, insertMarkdownToYjs } = require('./markdownToYjs')

class MockYText {
    constructor() {
        this.ops = []
    }

    insert(position, insert, attributes) {
        const op = { position, insert }
        if (attributes) op.attributes = attributes
        this.ops.push(op)
    }
}

const convert = markdown => {
    const ytext = new MockYText()
    insertMarkdownToYjs(ytext, 0, markdown)
    return ytext.ops
}

describe('assistant note Markdown heading conversion', () => {
    test('serializes the exact screenshot H4 headings as Quill-compatible Yjs headers', () => {
        const markdown = [
            ' #### 4. Partnerperspektiven konkret einbauen',
            'Mögliche Belege aus der Co-Creation:',
            '',
            '- **Roger / Zigarrenschachtel:** tägliche Prüfung',
            '',
            '#### 5. Trust, control and learning',
        ].join('\n')

        const ops = convert(markdown)
        const renderedText = ops
            .filter(op => typeof op.insert === 'string')
            .map(op => op.insert)
            .join('')

        expect(containsMarkdown(markdown)).toBe(true)
        expect(renderedText).not.toContain('####')
        expect(ops).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '4. Partnerperspektiven konkret einbauen' }),
                expect.objectContaining({ insert: '5. Trust, control and learning' }),
            ])
        )
        expect(ops.filter(op => op.insert === '\n' && op.attributes?.header === 4)).toHaveLength(2)
    })

    test.each([
        ['# Heading', 1],
        ['#### Heading', 4],
        ['###### Heading', 6],
        [' # Heading', 1],
        ['  #### Heading', 4],
        ['   ###### Heading', 6],
        ['####', 4],
    ])('supports permitted ATX syntax %p', (markdown, level) => {
        const ops = convert(markdown)

        expect(containsMarkdown(markdown)).toBe(true)
        expect(ops).toEqual(
            expect.arrayContaining([{ position: expect.any(Number), insert: '\n', attributes: { header: level } }])
        )
    })

    test.each(['    #### indented code', '\t#### tab-indented code', '####missing separator', '####### invalid'])(
        'does not detect invalid or code-block syntax %p',
        markdown => {
            expect(containsMarkdown(markdown)).toBe(false)
            expect(convert(markdown)).toEqual([{ position: 0, insert: markdown }])
        }
    )

    test('preserves invalid heading-like lines when other Markdown triggers conversion', () => {
        const ops = convert(['# Valid heading', '    #### indented code', '####### invalid'].join('\n'))

        expect(ops).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '    #### indented code' }),
                expect.objectContaining({ insert: '####### invalid' }),
            ])
        )
        expect(ops.filter(op => op.insert === '\n' && op.attributes?.header)).toHaveLength(1)
        expect(ops.find(op => op.insert === '\n' && op.attributes?.header).attributes.header).toBe(1)
    })
})
