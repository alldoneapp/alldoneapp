jest.mock('../firebaseConfig', () => ({ app_url: 'https://alldone.app/' }))

const { parseRichText, buildTag } = require('./RichText')

const TEAMS_MESSAGE_URL =
    'https://teams.microsoft.com/l/message/19:31a6fbacdfd24ed9b4204b6984dce10e@thread.v2/1792410546073?context=%7B%22contextType%22%3A%22chat%22%7D'

describe('notification email links', () => {
    test.each([
        TEAMS_MESSAGE_URL,
        'https://example.com/people/user@example.com',
        'https://example.com/search?email=user@example.com',
        'www.example.com/people/user@example.com',
    ])('renders a complete URL containing @ as a web link: %s', link => {
        const elements = parseRichText(`See ${link} mail@example.com`)
        expect(elements).toEqual([
            { type: 'text', text: 'See' },
            { type: 'url', link },
            { type: 'email', email: 'mail@example.com' },
        ])
        const html = buildTag(elements[1])
        expect(html).toContain(`href="${link}"`)
        expect(html).not.toContain('mailto:')
        expect(buildTag(elements[2])).toContain('href="mailto:mail@example.com"')
    })

    test('keeps real email addresses containing www as email addresses', () => {
        expect(parseRichText('user@www.example.com')).toEqual([{ type: 'email', email: 'user@www.example.com' }])
        expect(parseRichText('www.user@example.com')).toEqual([{ type: 'email', email: 'www.user@example.com' }])
    })

    test('does not turn a Teams URL inside parentheses into an email address', () => {
        const elements = parseRichText(`(${TEAMS_MESSAGE_URL})`)
        expect(elements.some(element => element.type === 'email')).toBe(false)
        expect(elements.some(element => element.type === 'url')).toBe(true)
    })
})
