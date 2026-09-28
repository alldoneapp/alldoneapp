const {
    renderNoteEmbedAsText,
    buildNoteTextProjection,
    toYIndex,
    getProjectedHeadingTexts,
} = require('./noteTextProjection')

describe('renderNoteEmbedAsText', () => {
    test('renders the embeds a note can hold as readable text', () => {
        expect(renderNoteEmbedAsText({ url: { url: 'https://example.com/x', type: 'plain' } })).toBe(
            'https://example.com/x'
        )
        expect(renderNoteEmbedAsText({ mention: { text: 'Ada', userId: 'u1' } })).toBe('@Ada')
        // The email blot stores the address under `text`, not `email`.
        expect(renderNoteEmbedAsText({ email: { text: 'ada@example.com' } })).toBe('ada@example.com')
        expect(renderNoteEmbedAsText({ hashtag: { text: 'launch' } })).toBe('#launch')
        expect(renderNoteEmbedAsText({ taskTagFormat: { taskId: 't1', objectUrl: 'https://app/t1' } })).toBe(
            '[task: https://app/t1]'
        )
        expect(renderNoteEmbedAsText({ customImageFormat: { text: 'shot.png', uri: 'https://cdn/shot.png' } })).toBe(
            '![shot.png](https://cdn/shot.png)'
        )
    })

    test('never renders an embed as empty text', () => {
        expect(renderNoteEmbedAsText({ url: {} })).toBe('[link]')
        expect(renderNoteEmbedAsText({ somethingNew: { a: 1 } })).toBe('[somethingNew]')
        expect(renderNoteEmbedAsText(null)).toBe('[embed]')
    })
})

describe('buildNoteTextProjection / toYIndex', () => {
    // Y.Text positions: "ab" = 0..1, embed = 2, "cd" = 3..4
    const projection = buildNoteTextProjection([
        { insert: 'ab' },
        { insert: { url: { url: 'LINK' } } },
        { insert: 'cd' },
    ])

    test('renders the embed into the text and counts it as one Y.Text position', () => {
        expect(projection.text).toBe('abLINKcd')
        expect(projection.yLength).toBe(5)
    })

    test('maps offsets outside embeds linearly', () => {
        expect(toYIndex(projection, 0)).toBe(0)
        expect(toYIndex(projection, 2)).toBe(2)
        expect(toYIndex(projection, 6)).toBe(3)
        expect(toYIndex(projection, 7)).toBe(4)
        expect(toYIndex(projection, 8)).toBe(5)
    })

    test('snaps an offset inside an embed to the side the bias asks for', () => {
        expect(toYIndex(projection, 4, 'before')).toBe(2)
        expect(toYIndex(projection, 4, 'after')).toBe(3)
    })
})

describe('getProjectedHeadingTexts', () => {
    test('includes rendered embeds in heading text', () => {
        const projection = buildNoteTextProjection([
            { insert: 'Notes for ' },
            { insert: { mention: { text: 'Ada' } } },
            { insert: '\n', attributes: { header: 1 } },
            { insert: 'body\n' },
        ])
        expect([...getProjectedHeadingTexts(projection)]).toEqual(['Notes for @Ada'])
    })
})
