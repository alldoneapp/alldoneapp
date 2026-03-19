'use strict'

const {
    buildDailyEmailTitle,
    buildEmailCommentText,
    computeWebhookSignature,
    getEmailSafeAllowedTools,
    normalizeEmailAddress,
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

    test('limits email-safe tools to create_task and external_tools', () => {
        expect(
            getEmailSafeAllowedTools(['create_task', 'search', 'external_tools', 'talk_to_assistant', 'update_task'])
        ).toEqual(['create_task', 'external_tools'])
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

    test('prefers a single pdf attachment as actionable', () => {
        const selection = pickActionableAttachment([
            { fileName: 'invoice.pdf', contentType: 'application/pdf' },
            { fileName: 'logo.png', contentType: 'image/png' },
        ])

        expect(selection.status).toBe('ok')
        expect(selection.attachment.fileName).toBe('invoice.pdf')
    })

    test('rejects multiple supported attachments', () => {
        const selection = pickActionableAttachment([
            { fileName: 'invoice.pdf', contentType: 'application/pdf' },
            {
                fileName: 'notes.docx',
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
        ])

        expect(selection.status).toBe('multiple_supported')
        expect(selection.supportedAttachments).toHaveLength(2)
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
