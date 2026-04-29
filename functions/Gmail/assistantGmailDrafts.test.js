jest.mock('./assistantGmailSearch', () => ({
    searchGmailForAssistantRequest: jest.fn(),
    getConnectedGmailAccounts: jest.fn(),
    getGmailClient: jest.fn(),
}))

const {
    buildMimeMessage,
    buildPlainTextMimeMessage,
    buildGmailDraftUrl,
    buildReferencesHeader,
    normalizeAttachmentList,
    normalizeDraftData,
    normalizeRecipientList,
    pickLatestResult,
    selectDefaultAccount,
    selectProjectAccount,
    updateGmailDraftForAssistantRequest,
} = require('./assistantGmailDrafts')
const { getConnectedGmailAccounts, getGmailClient } = require('./assistantGmailSearch')

function toBase64Url(value) {
    return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
    const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding)
    return Buffer.from(padded, 'base64').toString('utf8')
}

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

    test('builds a multipart MIME message when attachments are provided', () => {
        const mimeMessage = buildMimeMessage({
            to: ['alice@example.com'],
            subject: 'Project update',
            body: 'Attached.',
            attachments: [
                {
                    fileName: 'summary.txt',
                    mimeType: 'text/plain',
                    base64: Buffer.from('File contents', 'utf8').toString('base64'),
                },
            ],
        })

        expect(mimeMessage).toContain('Content-Type: multipart/mixed; boundary="')
        expect(mimeMessage).toContain('Content-Type: text/plain; charset="UTF-8"')
        expect(mimeMessage).toContain('Content-Type: text/plain; name="summary.txt"')
        expect(mimeMessage).toContain('Content-Disposition: attachment; filename="summary.txt"')
        expect(mimeMessage).toContain(Buffer.from('File contents', 'utf8').toString('base64'))
    })

    test('normalizes attachment tool payloads for draft MIME generation', () => {
        const attachments = normalizeAttachmentList([
            {
                fileName: 'invoice.pdf',
                fileMimeType: 'application/pdf',
                fileBase64: Buffer.from('pdf bytes', 'utf8').toString('base64'),
            },
        ])

        expect(attachments).toEqual([
            {
                fileName: 'invoice.pdf',
                mimeType: 'application/pdf',
                base64: Buffer.from('pdf bytes', 'utf8').toString('base64'),
                sizeBytes: 9,
                inline: false,
            },
        ])
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

    test('builds a Gmail URL that opens a specific draft message', () => {
        const url = buildGmailDraftUrl('person@example.com', 'message-123')

        expect(url).toBe('https://mail.google.com/mail/u/person%40example.com/#inbox?compose=message-123')
    })

    test('normalizes a Gmail draft payload for editing', () => {
        const normalized = normalizeDraftData({
            id: 'draft-123',
            message: {
                id: 'message-123',
                threadId: 'thread-123',
                payload: {
                    headers: [
                        { name: 'To', value: 'alice@example.com, bob@example.com' },
                        { name: 'Cc', value: 'carol@example.com' },
                        { name: 'Bcc', value: 'dave@example.com' },
                        { name: 'Subject', value: 'Project update' },
                    ],
                    body: {},
                    parts: [
                        {
                            mimeType: 'text/plain',
                            body: {
                                data: Buffer.from('Hello team', 'utf8')
                                    .toString('base64')
                                    .replace(/\+/g, '-')
                                    .replace(/\//g, '_')
                                    .replace(/=+$/g, ''),
                            },
                        },
                    ],
                },
            },
        })

        expect(normalized).toEqual({
            draftId: 'draft-123',
            messageId: 'message-123',
            threadId: 'thread-123',
            to: ['alice@example.com', 'bob@example.com'],
            cc: ['carol@example.com'],
            bcc: ['dave@example.com'],
            subject: 'Project update',
            body: 'Hello team',
        })
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

    test('selects the default account when one is marked', () => {
        const account = selectDefaultAccount([
            { projectId: 'p1', gmailEmail: 'a@example.com', gmailDefault: false },
            { projectId: 'p2', gmailEmail: 'b@example.com', gmailDefault: true },
        ])

        expect(account).toEqual({ projectId: 'p2', gmailEmail: 'b@example.com', gmailDefault: true })
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

describe('assistantGmailDrafts updates', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    function buildGmailClient(existingAttachmentText = 'Existing file') {
        return {
            users: {
                drafts: {
                    get: jest.fn().mockResolvedValue({
                        data: {
                            id: 'draft-123',
                            message: {
                                id: 'message-123',
                                threadId: 'thread-123',
                                payload: {
                                    headers: [
                                        { name: 'To', value: 'alice@example.com' },
                                        { name: 'Subject', value: 'Project update' },
                                    ],
                                    parts: [
                                        {
                                            mimeType: 'text/plain',
                                            body: {
                                                data: toBase64Url('Original body'),
                                            },
                                        },
                                        {
                                            filename: 'existing.txt',
                                            mimeType: 'text/plain',
                                            body: {
                                                data: toBase64Url(existingAttachmentText),
                                                size: existingAttachmentText.length,
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    }),
                    update: jest.fn().mockResolvedValue({
                        data: {
                            id: 'draft-123',
                            message: {
                                id: 'message-456',
                                threadId: 'thread-123',
                            },
                        },
                    }),
                },
                messages: {
                    attachments: {
                        get: jest.fn(),
                    },
                },
            },
        }
    }

    test('preserves existing draft attachments when adding a new attachment', async () => {
        const gmail = buildGmailClient()
        getConnectedGmailAccounts.mockResolvedValue([
            { projectId: 'project-1', gmailEmail: 'person@example.com', gmailDefault: true },
        ])
        getGmailClient.mockResolvedValue(gmail)

        const result = await updateGmailDraftForAssistantRequest({
            userId: 'user-1',
            draftId: 'draft-123',
            body: 'Updated body',
            attachments: [
                {
                    fileName: 'new.txt',
                    mimeType: 'text/plain',
                    base64: Buffer.from('New file', 'utf8').toString('base64'),
                },
            ],
        })

        const raw = gmail.users.drafts.update.mock.calls[0][0].requestBody.message.raw
        const mimeMessage = decodeBase64Url(raw)

        expect(result.success).toBe(true)
        expect(result.attachments.map(attachment => attachment.fileName)).toEqual(['existing.txt', 'new.txt'])
        expect(mimeMessage).toContain('Updated body')
        expect(mimeMessage).toContain('filename="existing.txt"')
        expect(mimeMessage).toContain(Buffer.from('Existing file', 'utf8').toString('base64'))
        expect(mimeMessage).toContain('filename="new.txt"')
        expect(mimeMessage).toContain(Buffer.from('New file', 'utf8').toString('base64'))
    })

    test('can replace existing draft attachments', async () => {
        const gmail = buildGmailClient()
        getConnectedGmailAccounts.mockResolvedValue([
            { projectId: 'project-1', gmailEmail: 'person@example.com', gmailDefault: true },
        ])
        getGmailClient.mockResolvedValue(gmail)

        const result = await updateGmailDraftForAssistantRequest({
            userId: 'user-1',
            draftId: 'draft-123',
            replaceAttachments: true,
            attachments: [
                {
                    fileName: 'replacement.txt',
                    mimeType: 'text/plain',
                    base64: Buffer.from('Replacement file', 'utf8').toString('base64'),
                },
            ],
        })

        const raw = gmail.users.drafts.update.mock.calls[0][0].requestBody.message.raw
        const mimeMessage = decodeBase64Url(raw)

        expect(result.success).toBe(true)
        expect(result.attachments.map(attachment => attachment.fileName)).toEqual(['replacement.txt'])
        expect(mimeMessage).not.toContain('filename="existing.txt"')
        expect(mimeMessage).toContain('filename="replacement.txt"')
    })
})
