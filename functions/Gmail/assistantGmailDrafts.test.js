jest.mock('./assistantGmailSearch', () => ({
    searchGmailForAssistantRequest: jest.fn(),
    getConnectedGmailAccounts: jest.fn(),
    getGmailClient: jest.fn(),
}))

const {
    buildPlainTextMimeMessage,
    buildReferencesHeader,
    normalizeRecipientList,
    pickLatestResult,
    selectProjectAccount,
} = require('./assistantGmailDrafts')

describe('assistantGmailDrafts helpers', () => {
    test('normalizes recipients from string or array input', () => {
        expect(normalizeRecipientList('a@example.com, b@example.com')).toEqual(['a@example.com', 'b@example.com'])
        expect(normalizeRecipientList(['a@example.com', ' ', 'b@example.com'])).toEqual([
            'a@example.com',
            'b@example.com',
        ])
    })

    test('builds a plain text MIME message for a new draft', () => {
        const mimeMessage = buildPlainTextMimeMessage({
            to: ['alice@example.com', 'bob@example.com'],
            cc: 'carol@example.com',
            subject: 'Project update',
            body: 'Hello team,\nStatus update.',
        })

        expect(mimeMessage).toContain('To: alice@example.com, bob@example.com')
        expect(mimeMessage).toContain('Cc: carol@example.com')
        expect(mimeMessage).toContain('Subject: Project update')
        expect(mimeMessage).toContain('Content-Type: text/plain; charset="UTF-8"')
        expect(mimeMessage).toContain('\r\n\r\nHello team,\r\nStatus update.')
    })

    test('builds reply MIME message headers with threading metadata', () => {
        const references = buildReferencesHeader({
            references: '<older@example.com>',
            rfcMessageId: '<latest@example.com>',
        })
        const mimeMessage = buildPlainTextMimeMessage({
            to: ['alice@example.com'],
            subject: 'Re: Project update',
            body: 'Thanks.',
            inReplyTo: '<latest@example.com>',
            references,
        })

        expect(references).toBe('<older@example.com> <latest@example.com>')
        expect(mimeMessage).toContain('In-Reply-To: <latest@example.com>')
        expect(mimeMessage).toContain('References: <older@example.com> <latest@example.com>')
    })

    test('selects the project account for new drafts', () => {
        const account = selectProjectAccount(
            [
                { projectId: 'p1', gmailEmail: 'a@example.com' },
                { projectId: 'p2', gmailEmail: 'b@example.com' },
            ],
            'p2'
        )

        expect(account).toEqual({ projectId: 'p2', gmailEmail: 'b@example.com' })
    })

    test('picks the latest Gmail search result for reply resolution', () => {
        const result = pickLatestResult([
            { messageId: 'm1', internalDate: 1000 },
            { messageId: 'm2', internalDate: 5000 },
            { messageId: 'm3', internalDate: 3000 },
        ])

        expect(result).toEqual({ messageId: 'm2', internalDate: 5000 })
    })
})
