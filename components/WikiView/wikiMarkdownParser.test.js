import { parseInline, parseWikiMarkdown } from './wikiMarkdownParser'

describe('parseInline', () => {
    it('reads emphasis, code and links', () => {
        expect(parseInline('Ein **wichtiger** und *kursiver* `code` [Link](https://alldone.app) Satz')).toEqual([
            { type: 'text', text: 'Ein ' },
            { type: 'bold', children: [{ type: 'text', text: 'wichtiger' }] },
            { type: 'text', text: ' und ' },
            { type: 'italic', children: [{ type: 'text', text: 'kursiver' }] },
            { type: 'text', text: ' ' },
            { type: 'code', text: 'code' },
            { type: 'text', text: ' ' },
            { type: 'link', url: 'https://alldone.app', children: [{ type: 'text', text: 'Link' }] },
            { type: 'text', text: ' Satz' },
        ])
    })

    it('turns wiki tokens into page links and source references', () => {
        expect(
            parseInline('Siehe [[Kunden & Partner]], [[entscheidungen|Beschlüsse]] und [[task:-Ab_1|Release]].')
        ).toEqual([
            { type: 'text', text: 'Siehe ' },
            { type: 'pageLink', slug: 'kunden-partner', label: 'Kunden & Partner' },
            { type: 'text', text: ', ' },
            { type: 'pageLink', slug: 'entscheidungen', label: 'Beschlüsse' },
            { type: 'text', text: ' und ' },
            { type: 'source', key: 'task:-Ab_1', objectType: 'task', id: '-Ab_1', label: 'Release' },
            { type: 'text', text: '.' },
        ])
    })

    it('keeps the node type of a source reference apart from the object type it points at', () => {
        expect(parseInline('[[note:n1]]')).toEqual([
            { type: 'source', key: 'note:n1', objectType: 'note', id: 'n1', label: '' },
        ])
    })

    it('never makes a link out of anything but http(s)', () => {
        const nodes = parseInline('[klick](javascript:alert(1)) und [mail](mailto:a@b.c)')
        expect(nodes.some(node => node.type === 'link')).toBe(false)
        expect(nodes).toEqual([{ type: 'text', text: 'klick) und mail' }])
    })

    it('links bare URLs without swallowing trailing punctuation', () => {
        expect(parseInline('Doku: https://docs.alldone.app/wiki.')).toEqual([
            { type: 'text', text: 'Doku: ' },
            {
                type: 'link',
                url: 'https://docs.alldone.app/wiki',
                children: [{ type: 'text', text: 'https://docs.alldone.app/wiki' }],
            },
            { type: 'text', text: '.' },
        ])
    })

    it('leaves snake_case words and lone asterisks alone', () => {
        expect(parseInline('user_memory_note und 2 * 3')).toEqual([
            { type: 'text', text: 'user_memory_note und 2 * 3' },
        ])
    })

    it('shows HTML as text', () => {
        expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
            { type: 'text', text: '<img src=x onerror=alert(1)>' },
        ])
    })
})

describe('parseWikiMarkdown', () => {
    it('reads the block structure an ingest run writes', () => {
        const blocks = parseWikiMarkdown(
            [
                '# Kunden',
                '',
                'Acme ist **Pilotkunde** [[task:t1]].',
                'Der Vertrag läuft bis März.',
                '',
                '## Offene Fragen',
                '- Preis für Stufe 2',
                '  - mit Rabatt?',
                '- Start im Q1',
                '',
                '1. Angebot',
                '2. Vertrag',
                '',
                '> Wichtig: Acme hat gekündigt [[correction:c1]].',
                '',
                '---',
                '',
                '| Kunde | Status |',
                '| --- | --- |',
                '| Acme | aktiv |',
                '',
                '```',
                'npm run deploy',
                '```',
            ].join('\n')
        )

        expect(blocks.map(block => block.type)).toEqual([
            'heading',
            'paragraph',
            'heading',
            'list',
            'list',
            'quote',
            'rule',
            'table',
            'code',
        ])
        expect(blocks[0]).toEqual({ type: 'heading', level: 1, inline: [{ type: 'text', text: 'Kunden' }] })
        expect(blocks[1].inline.map(node => node.type)).toEqual(['text', 'bold', 'text', 'source', 'text'])
        expect(blocks[1].inline[4].text).toBe('. Der Vertrag läuft bis März.')
        expect(blocks[3]).toMatchObject({ ordered: false, items: [{ children: [{ type: 'list' }] }, { children: [] }] })
        expect(blocks[3].items[0].children[0].items[0].inline).toEqual([{ type: 'text', text: 'mit Rabatt?' }])
        expect(blocks[4]).toMatchObject({ ordered: true })
        expect(blocks[4].items).toHaveLength(2)
        expect(blocks[5].blocks[0].type).toBe('paragraph')
        expect(blocks[7].header).toHaveLength(2)
        expect(blocks[7].rows[0][0]).toEqual([{ type: 'text', text: 'Acme' }])
        expect(blocks[8]).toEqual({ type: 'code', text: 'npm run deploy' })
    })

    it('caps headings at level 4 and survives an unclosed fence', () => {
        const blocks = parseWikiMarkdown('###### Klein\n```\nnicht geschlossen')
        expect(blocks[0]).toMatchObject({ type: 'heading', level: 4 })
        expect(blocks[1]).toEqual({ type: 'code', text: 'nicht geschlossen' })
    })

    it('returns nothing for an empty page', () => {
        expect(parseWikiMarkdown('')).toEqual([])
        expect(parseWikiMarkdown(undefined)).toEqual([])
    })
})
