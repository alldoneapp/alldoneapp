import { containsMarkdown, markdownToDelta } from './markdownToDelta'

class MockDelta {
    constructor() {
        this.ops = []
    }

    insert(insert, attributes) {
        const op = { insert }
        if (attributes) op.attributes = attributes
        this.ops.push(op)
        return this
    }
}

const convert = markdown => markdownToDelta(markdown, MockDelta)

describe('note editor Markdown heading conversion', () => {
    test('converts the exact screenshot H4 headings into Quill header operations', () => {
        const markdown = [
            ' #### 4. Partnerperspektiven konkret einbauen',
            'Mögliche Belege aus der Co-Creation:',
            '',
            '- **Roger / Zigarrenschachtel:** tägliche Prüfung',
            '',
            '#### 5. Trust, control and learning',
            'Zeigen, warum dies kein autonomer Black-Box-Agent ist:',
        ].join('\n')

        const delta = convert(markdown)
        const renderedText = delta.ops
            .filter(op => typeof op.insert === 'string')
            .map(op => op.insert)
            .join('')

        expect(containsMarkdown(markdown)).toBe(true)
        expect(renderedText).not.toContain('####')
        expect(delta.ops).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '4. Partnerperspektiven konkret einbauen' }),
                expect.objectContaining({ insert: '5. Trust, control and learning' }),
                expect.objectContaining({ insert: 'Roger / Zigarrenschachtel:', attributes: expect.any(Object) }),
            ])
        )
        expect(delta.ops.filter(op => op.insert === '\n' && op.attributes?.header === 4)).toHaveLength(2)
    })

    test.each([
        ['# Heading', 1],
        ['## Heading', 2],
        ['### Heading', 3],
        ['#### Heading', 4],
        ['##### Heading', 5],
        ['###### Heading', 6],
        [' # Heading', 1],
        ['  #### Heading', 4],
        ['   ###### Heading', 6],
        ['####', 4],
    ])('supports permitted ATX syntax %p', (markdown, level) => {
        const delta = convert(markdown)

        expect(containsMarkdown(markdown)).toBe(true)
        expect(delta.ops).toEqual(expect.arrayContaining([{ insert: '\n', attributes: { header: level } }]))
    })

    test.each(['    #### indented code', '\t#### tab-indented code', '####missing separator', '####### invalid'])(
        'does not detect invalid or code-block syntax %p',
        markdown => {
            expect(containsMarkdown(markdown)).toBe(false)
            expect(convert(markdown)).toBeNull()
        }
    )

    test('preserves invalid heading-like lines when other Markdown triggers conversion', () => {
        const delta = convert(['# Valid heading', '    #### indented code', '####### invalid'].join('\n'))

        expect(delta.ops).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ insert: '    #### indented code' }),
                expect.objectContaining({ insert: '####### invalid' }),
            ])
        )
        expect(delta.ops.filter(op => op.insert === '\n' && op.attributes?.header)).toEqual([
            { insert: '\n', attributes: { header: 1 } },
        ])
    })
})
