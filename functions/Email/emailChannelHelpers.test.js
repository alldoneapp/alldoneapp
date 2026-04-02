'use strict'

const {
    buildDailyEmailTitle,
    buildEmailCommentText,
    computeWebhookSignature,
    getEmailSafeAllowedTools,
    looksLikeForwardedEmail,
    normalizeEmailAddress,
    parseEmailHeaderAddresses,
    pickActionableAttachment,
    stripHtmlToText,
    trimQuotedReplyText,
    verifyInboundEmailSignature,
} = require('./emailChannelHelpers')
const { normalizeInboundEmailPayload } = require('./emailIncomingHandler')

describe('emailChannelHelpers', () => {
    test('normalizes email addresses', () => {
        expect(normalizeEmailAddress('  User@Example.COM ')).toBe('user@example.com')
    })

    test('parses display names from email header entries', () => {
        expect(parseEmailHeaderAddresses('"Eva-Maria Würz" <Eva-Maria.Wuerz@jtl-software.com>')).toEqual([
            {
                raw: '"Eva-Maria Würz" <Eva-Maria.Wuerz@jtl-software.com>',
                email: 'eva-maria.wuerz@jtl-software.com',
                displayName: 'Eva-Maria Würz',
            },
        ])
    })

    test('keeps commas inside quoted display names when splitting email headers', () => {
        expect(
            parseEmailHeaderAddresses('"Krause, Steffen" <steffen@example.com>, "Eva-Maria Würz" <eva@example.com>')
        ).toEqual([
            {
                raw: '"Krause, Steffen" <steffen@example.com>',
                email: 'steffen@example.com',
                displayName: 'Krause, Steffen',
            },
            {
                raw: '"Eva-Maria Würz" <eva@example.com>',
                email: 'eva@example.com',
                displayName: 'Eva-Maria Würz',
            },
        ])
    })

    test('limits email-safe tools to the approved action-only email set', () => {
        expect(
            getEmailSafeAllowedTools([
                'create_task',
                'create_calendar_event',
                'create_note',
                'update_note',
                'create_gmail_draft',
                'create_gmail_reply_draft',
                'search',
                'external_tools',
                'talk_to_assistant',
                'update_task',
                'search_calendar_events',
            ])
        ).toEqual([
            'create_task',
            'create_calendar_event',
            'create_note',
            'update_note',
            'create_gmail_draft',
            'create_gmail_reply_draft',
            'external_tools',
        ])
    })

    test('builds daily email title in WhatsApp-like style', () => {
        expect(buildDailyEmailTitle('Karsten', '18 Mar 2026')).toBe('Daily email <> Karsten 18 Mar 2026')
    })

    test('builds comment text from subject and body', () => {
        expect(buildEmailCommentText('Invoice March', 'Please process this invoice')).toBe(
            'Subject: Invoice March\n\nPlease process this invoice'
        )
    })

    test('falls back to html body when plain text body is missing', () => {
        expect(buildEmailCommentText('Invoice March', '', '<p>Please process <strong>this</strong> invoice</p>')).toBe(
            'Subject: Invoice March\n\nPlease process this invoice'
        )
    })

    test('strips basic html tags into readable text', () => {
        expect(stripHtmlToText('<div>Hello<br>World</div>')).toBe('Hello\nWorld')
    })

    test('trims quoted reply chains from plain text bodies', () => {
        expect(
            trimQuotedReplyText('Please do this\n\nOn Tue, Mar 19, 2026 at 10:00 AM Anna wrote:\n> older text')
        ).toBe('Please do this')
    })

    test('builds comment text without quoted reply history', () => {
        expect(
            buildEmailCommentText(
                'Re: Test',
                'Newest request\n\nFrom: Anna <anna@alldoneapp.com>\nSent: today\nOlder thread'
            )
        ).toBe('Subject: Re: Test\n\nNewest request')
    })

    test('detects forwarded emails from subject or body markers', () => {
        expect(looksLikeForwardedEmail('Fwd: Invoice', 'anything')).toBe(true)
        expect(looksLikeForwardedEmail('Invoice', '---------- Forwarded message ----------\nFrom: GitLab')).toBe(true)
        expect(looksLikeForwardedEmail('Re: Invoice', 'Newest request\n\nOn Tue, Mar 19 wrote:')).toBe(false)
    })

    test('keeps the full forwarded email body intact', () => {
        const forwardedBody =
            '---------- Forwarded message ----------\nFrom: GitLab <ar@gitlab.com>\nDate: Tue, Mar 10, 2026\n\nPlease handle this invoice'

        expect(buildEmailCommentText('Fwd: Your GitLab invoice', forwardedBody)).toBe(
            'Subject: Fwd: Your GitLab invoice\n\n' + forwardedBody
        )
    })

    test('prefers a single pdf attachment as actionable', () => {
        const selection = pickActionableAttachment([
            { fileName: 'invoice.pdf', contentType: 'application/pdf' },
            { fileName: 'logo.png', contentType: 'image/png' },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('invoice.pdf')
    })

    test('selects the more invoice-like supported attachment by filename', () => {
        const selection = pickActionableAttachment([
            {
                fileName: 'notes.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            {
                fileName: 'invoice-march.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('invoice-march.docx')
        expect(selection.supportedAttachments).toHaveLength(2)
    })

    test('selects the more invoice-like supported attachment by extracted text', () => {
        const selection = pickActionableAttachment([
            {
                fileName: 'document.pdf',
                contentType: 'application/pdf',
                extractedText: 'Invoice number 2026-001\nAmount due 1200 EUR\nIBAN DE12',
            },
            {
                fileName: 'document-copy.pdf',
                contentType: 'application/pdf',
                extractedText: 'General notes from the meeting',
            },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('document.pdf')
    })

    test('breaks equally relevant ties by file type priority, then original order', () => {
        const docxPreferred = pickActionableAttachment([
            {
                fileName: 'invoice.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            { fileName: 'invoice.txt', contentType: 'text/plain' },
        ])

        expect(docxPreferred.attachment.fileName).toBe('invoice.docx')

        const originalOrderPreferred = pickActionableAttachment([
            { fileName: 'invoice-a.pdf', contentType: 'application/pdf' },
            { fileName: 'invoice-b.pdf', contentType: 'application/pdf' },
        ])

        expect(originalOrderPreferred.attachment.fileName).toBe('invoice-a.pdf')
    })

    test('returns none when no supported attachments are present', () => {
        const selection = pickActionableAttachment([
            { fileName: 'logo.png', contentType: 'image/png' },
            { fileName: 'signature.jpg', contentType: 'image/jpeg' },
        ])

        expect(selection).toEqual({
            status: 'none',
            attachment: null,
            supportedAttachments: [],
        })
    })

    test('verifies normalized webhook signatures', () => {
        const payload = { messageId: 'abc', fromEmail: 'user@example.com' }
        const timestamp = '1710000000'
        const secret = 'test-secret'
        const value = computeWebhookSignature(secret, timestamp, payload)

        expect(verifyInboundEmailSignature(secret, { timestamp, value }, payload)).toEqual({ valid: true })
    })

    test('normalizes inbound email payload shape', () => {
        const payload = normalizeInboundEmailPayload(
            {
                providerMessageId: 'msg-1',
                from: 'User@Example.com',
                subject: 'Invoice',
                text: 'Please add this invoice',
                threadHeaders: {
                    inReplyTo: '<message-id>',
                    references: '<message-id>',
                },
                attachments: [
                    {
                        filename: 'invoice.pdf',
                        mimeType: 'application/pdf',
                        base64: 'aGVsbG8=',
                    },
                ],
            },
            {}
        )

        expect(payload.messageId).toBe('msg-1')
        expect(payload.fromEmail).toBe('user@example.com')
        expect(payload.textBody).toBe('Please add this invoice')
        expect(payload.threadHeaders.inReplyTo).toBe('<message-id>')
        expect(payload.attachments).toEqual([
            {
                fileName: 'invoice.pdf',
                contentType: 'application/pdf',
                contentBase64: 'aGVsbG8=',
                sizeBytes: 0,
            },
        ])
    })
})
