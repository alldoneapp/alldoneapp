const { deltaToMarkdown } = require('./deltaToMarkdown')

describe('deltaToMarkdown embeds', () => {
    test('reads the email address from the field the email blot actually stores', () => {
        expect(deltaToMarkdown([{ insert: 'Mail ' }, { insert: { email: { text: 'ada@example.com' } } }])).toBe(
            'Mail ada@example.com'
        )
    })

    test('names embeds it has no dedicated rendering for instead of dropping them', () => {
        expect(
            deltaToMarkdown([
                { insert: 'See ' },
                { insert: { taskTagFormat: { taskId: 't1', objectUrl: 'https://app/t1' } } },
            ])
        ).toBe('See [task: https://app/t1]')
    })
})
