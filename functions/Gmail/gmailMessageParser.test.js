const { collectAttachments, normalizeGmailMessage } = require('./gmailMessageParser')

describe('gmailMessageParser attachments', () => {
    test('collects nested attachment metadata', () => {
        const payload = {
            parts: [
                {
                    mimeType: 'multipart/alternative',
                    parts: [
                        {
                            filename: 'invoice.pdf',
                            mimeType: 'application/pdf',
                            body: { attachmentId: 'att-1', size: 1234 },
                        },
                    ],
                },
                {
                    filename: 'logo.png',
                    mimeType: 'image/png',
                    disposition: 'inline',
                    body: { attachmentId: 'att-2', size: 456 },
                },
                {
                    filename: 'embedded.pdf',
                    mimeType: 'application/pdf',
                    body: { data: 'SGVsbG8=', size: 5 },
                },
            ],
        }

        expect(collectAttachments(payload)).toEqual([
            {
                attachmentId: 'att-1',
                fileName: 'invoice.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 1234,
                inline: false,
            },
            {
                attachmentId: 'att-2',
                fileName: 'logo.png',
                mimeType: 'image/png',
                sizeBytes: 456,
                inline: true,
            },
            {
                attachmentId: '',
                fileName: 'embedded.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 5,
                inline: false,
            },
        ])
    })

    test('includes attachments in normalized Gmail messages', () => {
        const normalized = normalizeGmailMessage({
            id: 'message-1',
            payload: {
                headers: [],
                parts: [
                    {
                        filename: 'statement.pdf',
                        mimeType: 'application/pdf',
                        body: { attachmentId: 'att-99', size: 999 },
                    },
                ],
            },
        })

        expect(normalized.attachments).toEqual([
            {
                attachmentId: 'att-99',
                fileName: 'statement.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 999,
                inline: false,
            },
        ])
    })
})
