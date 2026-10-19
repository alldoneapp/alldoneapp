import { parseFeedComment } from './feedCommentParser'

const TEAMS_MESSAGE_URL =
    'https://teams.microsoft.com/l/message/19:31a6fbacdfd24ed9b4204b6984dce10e@thread.v2/1792410546073?context=%7B%22contextType%22%3A%22chat%22%7D'

it.each([
    TEAMS_MESSAGE_URL,
    'https://example.com/people/user@example.com',
    'https://example.com/search?email=user@example.com',
    'ftp://user@example.com/file.txt',
    'www.example.com/people/user@example.com',
])('preserves a complete URL containing an email-shaped substring: %s', link => {
    expect(parseFeedComment(`See ${link} mail@example.com,`, false, false)).toEqual([
        { type: 'text', text: 'See', bold: false },
        { type: 'url', link },
        { type: 'email', text: 'mail@example.com', email: 'mail@example.com' },
        { type: 'text', text: ',', bold: false },
    ])
})

it('keeps wrapping punctuation outside a Teams URL', () => {
    expect(parseFeedComment(`(${TEAMS_MESSAGE_URL}).`, false, false)).toEqual([
        { type: 'text', text: '(', bold: false },
        { type: 'url', link: TEAMS_MESSAGE_URL },
        { type: 'text', text: ').', bold: false },
    ])
})

it('keeps task-list parsing of text, mentions, hashtags and emails', () => {
    expect(parseFeedComment('Discuss @Karsten#user-1 #release mail@example.com,', false, false)).toEqual([
        { type: 'text', text: 'Discuss', bold: false },
        { type: 'mention', text: 'Karsten#user-1' },
        { type: 'hash', text: 'release' },
        { type: 'email', text: 'mail@example.com', email: 'mail@example.com' },
        { type: 'text', text: ',', bold: false },
    ])
})

it('keeps generic task references and bold text behavior', () => {
    expect(parseFeedComment('&Comment &another', true, true)).toEqual([
        { type: 'generic', text: 'Comment' },
        { type: 'text', text: '&another', bold: true },
    ])
})

it('retains URL destinations, Markdown extraction and surrounding punctuation', () => {
    expect(
        parseFeedComment('(https://example.com/path?q=1). [Release notes](https://example.org/edit?)', false, false)
    ).toEqual([
        { type: 'text', text: '(', bold: false },
        { type: 'url', link: 'https://example.com/path?q=1' },
        { type: 'text', text: ').', bold: false },
        { type: 'url', link: 'https://example.org/edit?' },
    ])
})

it('keeps encoded attachment metadata intact for existing renderers', () => {
    const text = 'EbDsQTD14ahtSR5https://example.com/file.pdfEbDsQTD14ahtSR5Plan.pdfEbDsQTD14ahtSR50'
    expect(parseFeedComment(text, false, false)).toEqual([{ type: 'attachment', text }])
})
